import io
import os
import json
import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor, as_completed
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from typing import Optional

from app.processing import recoverix
from app.processing.loader import EEGLoader
from app.processing.filters import EEGFilters
from app.processing.features import EEGFeatures
from app.processing.chunking import ChunkingPipeline
from app.config import DEFAULT_SUBBANDS

RECOVERIX_TASKS = ["Left", "Right"]

logger = logging.getLogger(__name__)

router = APIRouter()


# ------------------------------------------------------------------ #
#  Parallel batch processing (process pool, satu proses per file)     #
# ------------------------------------------------------------------ #

# Bytes ZIP dishare ke tiap worker sekali via initializer (bukan dikirim
# per task) supaya tidak di-pickle berulang.
_WORKER_ZIP_BYTES = None


def _init_worker(zip_bytes):
    global _WORKER_ZIP_BYTES
    _WORKER_ZIP_BYTES = zip_bytes


def _process_one_file(payload):
    """Proses satu file EDF penuh di dalam worker proses terpisah.

    Module-level + argumen picklable supaya jalan di ProcessPoolExecutor
    pada Windows (spawn). Mengembalikan dict berisi records, encoding,
    erd, dan error (kalau ada).
    """
    edf_path, meta, cfg = payload
    out = {"filename": edf_path, "records": [], "encoding": [],
           "erd": [], "erd_compare": [], "error": None}

    loader = EEGLoader()
    try:
        zip_buffer = io.BytesIO(_WORKER_ZIP_BYTES)
        loader.load_edf_from_zip(zip_buffer, edf_path)

        if cfg["detect_bad"]:
            bad_chs = EEGFilters.detect_bad_channels(loader.raw)
            if bad_chs:
                loader.raw.info["bads"] = bad_chs
                loader.raw.interpolate_bads(reset_bads=True, verbose=False)

        if cfg["use_car"]:
            EEGFilters.apply_car(loader)
        if cfg["use_amplitude"]:
            EEGFilters.apply_amplitude_filter(loader)
        if cfg["use_notch"]:
            EEGFilters.apply_notch(loader, freq=cfg["notch_freq"])

        EEGFilters.apply_bandpass(
            loader, low_freq=cfg["bp_low"], high_freq=cfg["bp_high"],
            order=cfg["bp_order"],
        )

        if cfg["use_ica"]:
            EEGFilters.apply_ica(
                loader, n_components=cfg["ica_n"], method=cfg["ica_method"],
            )

        df = loader.extract_dataframe()
        all_tasks = loader.get_task_list()
        all_channels = loader.channel_names

        tasks = [t for t in all_tasks
                 if not cfg["tasks_filter"] or t in cfg["tasks_filter"]]
        channels = [c for c in all_channels
                    if not cfg["ch_filter"] or c in cfg["ch_filter"]]

        if not tasks or not channels:
            return out

        if cfg["chunk_mode"]:
            # parallel=False: parallelisasi sudah di level file (pool ini).
            feat_df = ChunkingPipeline.compute_task_chunked_features(
                loader, df, channels, tasks,
                chunk_duration=cfg["chunk_duration"],
                subbands=cfg["subbands"],
                features=cfg["features"],
            )
        else:
            feat_df = EEGFeatures.compute_task_features(
                loader, df, channels, tasks,
                subbands=cfg["subbands"],
                features=cfg["features"],
                include_frequency=cfg["include_frequency"],
                psd_method=cfg["psd_method"],
                psd_fmin=cfg["psd_fmin"],
                psd_fmax=cfg["psd_fmax"],
            )

        if feat_df.empty:
            return out

        if cfg["chunk_mode"]:
            feat_df = ChunkingPipeline.attach_chunk_encoding(feat_df)

        for record in feat_df.to_dict(orient="records"):
            out["records"].append({**meta, "filename": edf_path, **record})

        if cfg["chunk_mode"]:
            try:
                chain_df = ChunkingPipeline.compute_chain_encoding(feat_df)
                if not chain_df.empty:
                    summary_df = ChunkingPipeline.summarize_chain_encoding(chain_df)
                    for rec in summary_df.to_dict(orient="records"):
                        out["encoding"].append(
                            {**meta, "filename": edf_path, **rec})
            except Exception:
                pass

        if cfg["erd_enabled"] and cfg["erd_baseline_task"] and cfg["erd_target_task"]:
            try:
                if cfg["chunk_mode"]:
                    erd_df = EEGFeatures.compute_erd_ers_paired_chunked(
                        loader, df, channels, cfg["erd_target_task"],
                        subbands=cfg["subbands"],
                        baseline_task=cfg["erd_baseline_task"],
                        chunk_duration=cfg["chunk_duration"],
                    )
                else:
                    erd_df = EEGFeatures.compute_erd_ers_paired(
                        loader, df, channels, cfg["erd_target_task"],
                        subbands=cfg["subbands"],
                        baseline_task=cfg["erd_baseline_task"],
                    )
                if not erd_df.empty:
                    for rec in erd_df.to_dict(orient="records"):
                        out["erd"].append(
                            {**meta, "filename": edf_path, **rec})
            except Exception:
                pass

        if (cfg.get("erd_compare_enabled") and cfg["chunk_mode"]
                and cfg.get("erd_compare_tasks")):
            try:
                for tname in cfg["erd_compare_tasks"]:
                    erd_c_df = EEGFeatures.compute_erd_ers_paired_chunked(
                        loader, df, channels, tname,
                        subbands=cfg["subbands"],
                        baseline_task=cfg["erd_compare_baseline"],
                        chunk_duration=cfg["chunk_duration"],
                    )
                    if not erd_c_df.empty:
                        for rec in erd_c_df.to_dict(orient="records"):
                            out["erd_compare"].append(
                                {**meta, "filename": edf_path, **rec})
            except Exception:
                pass

    except Exception as e:
        out["error"] = str(e)

    return out


def _process_one_session(payload):
    """Proses satu sesi recoveriX di dalam worker proses terpisah.

    Data recoveriX sudah difilter di device, jadi semua filter sinyal OFF
    secara default. User boleh mengaktifkan filter (cfg flags) lewat UI.
    ERD dihitung sesuai metode terpilih: 'intratrial' (cue-based per
    Left/Right) dan/atau 'paired' (baseline task vs target task).
    """
    session_dir, tar_names, meta, cfg = payload
    out = {"session_dir": session_dir, "records": [], "erd_records": [],
           "erd_paired_records": [], "error": None}

    loader = EEGLoader()
    try:
        zip_buffer = io.BytesIO(_WORKER_ZIP_BYTES)
        loader.load_recoverix_session(zip_buffer, tar_names)

        # Filter sinyal opsional (default semua OFF untuk recoveriX).
        if cfg["detect_bad"]:
            bad_chs = EEGFilters.detect_bad_channels(loader.raw)
            if bad_chs:
                loader.raw.info["bads"] = bad_chs
                loader.raw.interpolate_bads(reset_bads=True, verbose=False)
        if cfg["use_car"]:
            EEGFilters.apply_car(loader)
        if cfg["use_amplitude"]:
            EEGFilters.apply_amplitude_filter(loader)
        if cfg["use_notch"]:
            EEGFilters.apply_notch(loader, freq=cfg["notch_freq"])
        if cfg["use_bandpass"]:
            EEGFilters.apply_bandpass(
                loader, low_freq=cfg["bp_low"], high_freq=cfg["bp_high"],
                order=cfg["bp_order"],
            )
        if cfg["use_ica"]:
            EEGFilters.apply_ica(
                loader, n_components=cfg["ica_n"], method=cfg["ica_method"],
            )

        df = loader.extract_dataframe()
        all_channels = loader.channel_names
        channels = [c for c in all_channels
                    if not cfg["ch_filter"] or c in cfg["ch_filter"]]
        if not channels:
            return out

        feat_df = EEGFeatures.compute_task_features(
            loader, df, channels, RECOVERIX_TASKS,
            subbands=cfg["subbands"], features=cfg["features"],
        )
        for record in feat_df.to_dict(orient="records"):
            out["records"].append({**meta, "session": session_dir, **record})

        methods = cfg["recoverix_erd_methods"]

        if "intratrial" in methods:
            for task_name in RECOVERIX_TASKS:
                erd_df = EEGFeatures.compute_erd_ers_intratrial(
                    loader, df, channels, task_name,
                    subbands=cfg["subbands"], cue_offset_s=loader.cue_offset_s,
                )
                for rec in erd_df.to_dict(orient="records"):
                    out["erd_records"].append(
                        {**meta, "session": session_dir, **rec})

        if ("paired" in methods and cfg["erd_baseline_task"]
                and cfg["erd_target_task"]):
            erd_df = EEGFeatures.compute_erd_ers_paired(
                loader, df, channels, cfg["erd_target_task"],
                subbands=cfg["subbands"], baseline_task=cfg["erd_baseline_task"],
            )
            for rec in erd_df.to_dict(orient="records"):
                out["erd_paired_records"].append(
                    {**meta, "session": session_dir, **rec})
    except Exception as e:
        out["error"] = str(e)

    return out


@router.post("/scan")
async def scan_zip(file: UploadFile = File(...)):
    """Scan ZIP: extract metadata dari SEMUA file tanpa full processing.

    - category, subject, scenario: dari folder path structure (cepat, tanpa load EDF)
    - tasks, channels: load satu EDF representatif per kategori (lebih akurat)

    Return:
      total_files, files, categories, subjects, scenarios, tasks, channels
    """
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File harus berformat .zip")

    zip_bytes = await file.read()
    zip_buffer = io.BytesIO(zip_bytes)

    try:
        edf_files = EEGLoader.list_edf_in_zip(zip_buffer)
    except Exception:
        raise HTTPException(status_code=422, detail="ZIP rusak atau tidak valid")

    if not edf_files:
        # Bukan ZIP EDF: coba deteksi sesi recoveriX.
        zip_buffer.seek(0)
        return _scan_recoverix_zip(zip_buffer)

    # --- Pass 1: ekstrak metadata dari folder path (tanpa load EDF) ---
    categories, subjects, scenarios = set(), set(), set()
    meta_by_file: dict = {}

    for edf_path in edf_files:
        meta = EEGLoader.detect_category(edf_path)
        meta_by_file[edf_path] = meta
        categories.add(meta["category"])
        subjects.add(meta["subject"])
        if meta["scenario"]:
            scenarios.add(meta["scenario"])

    # --- Pass 2: load satu EDF per kategori untuk channels + tasks ---
    # Pilih satu representatif per kategori agar tasks & channels konsisten
    representative: dict = {}  # category -> edf_path
    for edf_path, meta in meta_by_file.items():
        cat = meta["category"]
        if cat not in representative:
            representative[cat] = edf_path

    all_tasks: set = set()
    channels: list = []

    for cat, edf_path in representative.items():
        try:
            zip_buffer.seek(0)
            loader = EEGLoader()
            loader.load_edf_from_zip(zip_buffer, edf_path)
            all_tasks.update(loader.get_task_list())
            if not channels:
                channels = loader.channel_names
        except Exception:
            continue

    return JSONResponse(content={
        "data_type": "edf",
        "total_files": len(edf_files),
        "files": edf_files,
        "categories": sorted(categories),
        "subjects": sorted(subjects),
        "scenarios": sorted(scenarios),
        "tasks": sorted(all_tasks),
        "channels": channels,
    })


def _scan_recoverix_zip(zip_buffer):
    """Scan ZIP multi-sesi recoveriX: daftar sesi + metadata + channels.

    Dipanggil oleh /scan saat ZIP tidak berisi EDF. Return data_type
    'recoverix' supaya frontend menyesuaikan UI.
    """
    sessions_raw = EEGLoader.list_recoverix_sessions_in_zip(zip_buffer)
    if not sessions_raw:
        raise HTTPException(
            status_code=422,
            detail="ZIP tidak berisi file EDF maupun sesi recoveriX (rawData*.tar.gz)",
        )

    sessions, subjects, scenarios = [], set(), set()
    for s in sessions_raw:
        meta = recoverix.parse_session_path(s["session_dir"])
        sessions.append({"session_dir": s["session_dir"], **meta})
        subjects.add(meta["subject"])
        scenarios.add(meta["scenario"])

    channels = []
    for s in sessions_raw:
        try:
            zip_buffer.seek(0)
            loader = EEGLoader()
            loader.load_recoverix_session(zip_buffer, s["tar_names"])
            channels = loader.channel_names
            break
        except Exception:
            continue

    return JSONResponse(content={
        "data_type": "recoverix",
        "total_sessions": len(sessions),
        "sessions": sessions,
        "subjects": sorted(subjects),
        "scenarios": sorted(scenarios),
        "tasks": list(RECOVERIX_TASKS),
        "channels": channels,
    })


_SUBBAND_MAP = {
    "delta": "Delta", "theta": "Theta", "mu": "Mu",
    "alpha": "Alpha", "low_beta": "Low_Beta",
    "beta": "Beta", "high_beta": "High_Beta", "gamma": "Gamma",
}


def _resolve_subbands(ids_str: str) -> dict:
    ids = [s.strip().lower() for s in ids_str.split(",") if s.strip()]
    return {
        _SUBBAND_MAP[i]: DEFAULT_SUBBANDS[_SUBBAND_MAP[i]]
        for i in ids
        if i in _SUBBAND_MAP and _SUBBAND_MAP[i] in DEFAULT_SUBBANDS
    } or dict(DEFAULT_SUBBANDS)


def _resolve_features(feats_str: str) -> list:
    mapping = {
        "mav": "mav", "variance": "variance", "std": "std",
        "band_power": "band_power", "relative_power": "relative_power",
        "peak_frequency": "peak_frequency",
        "psd": "band_power", "erd": "band_power", "ers": "relative_power",
    }
    seen, result = set(), []
    for f in feats_str.split(","):
        key = f.strip().lower()
        if key in mapping and mapping[key] not in seen:
            seen.add(mapping[key])
            result.append(mapping[key])
    return result or ["mav", "variance", "std"]


def _process_recoverix_batch(zip_bytes, sessions_raw, cfg, subj_filter, scen_filter):
    """Stream NDJSON proses semua sesi recoveriX (yang lolos filter).

    Mirror pola pool/stream EDF di /process, tetapi worker per-sesi dan
    hasil berisi `records`, `erd_records` (intra-trial), `erd_paired_records`.
    """
    payloads = []
    for s in sessions_raw:
        meta = recoverix.parse_session_path(s["session_dir"])
        if subj_filter and meta["subject"] not in subj_filter:
            continue
        if scen_filter and meta["scenario"] not in scen_filter:
            continue
        payloads.append((s["session_dir"], s["tar_names"], meta, cfg))

    total = len(payloads)

    async def event_generator():
        if total == 0:
            yield json.dumps({
                "type": "error",
                "detail": "Tidak ada sesi recoveriX yang cocok dengan filter",
            }) + "\n"
            return

        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        results = [None] * total

        def _run():
            def emit(item):
                loop.call_soon_threadsafe(queue.put_nowait, item)
            try:
                workers = max(1, min(os.cpu_count() or 1, total))
                with ProcessPoolExecutor(
                    max_workers=workers,
                    initializer=_init_worker,
                    initargs=(zip_bytes,),
                ) as ex:
                    fut_idx = {
                        ex.submit(_process_one_session, payloads[i]): i
                        for i in range(total)
                    }
                    done = 0
                    for fut in as_completed(fut_idx):
                        i = fut_idx[fut]
                        try:
                            results[i] = fut.result()
                        except Exception as e:
                            results[i] = {
                                "session_dir": payloads[i][0], "records": [],
                                "erd_records": [], "erd_paired_records": [],
                                "error": str(e),
                            }
                        done += 1
                        emit({"type": "progress", "processed": done, "total": total})
            except Exception as exc:
                logger.warning(
                    "Process pool batch recoverix gagal (%s), fallback serial", exc)
                _init_worker(zip_bytes)
                done = 0
                for i in range(total):
                    if results[i] is None:
                        results[i] = _process_one_session(payloads[i])
                    done += 1
                    emit({"type": "progress", "processed": done, "total": total})
            finally:
                emit({"type": "_done"})

        loop.run_in_executor(None, _run)

        while True:
            item = await queue.get()
            if item.get("type") == "_done":
                break
            yield json.dumps(item) + "\n"

        rec_all, erd_all, erd_paired_all, errs = [], [], [], []
        for res in results:
            if res is None:
                continue
            if res["error"]:
                errs.append({"session": res["session_dir"], "error": res["error"]})
                continue
            rec_all.extend(res["records"])
            erd_all.extend(res["erd_records"])
            erd_paired_all.extend(res.get("erd_paired_records", []))

        if not rec_all and not erd_all and not erd_paired_all:
            yield json.dumps({
                "type": "error",
                "detail": f"Gagal memproses semua sesi recoveriX. Errors: {errs[:3]}",
            }) + "\n"
            return

        yield json.dumps({
            "type": "result",
            "data_type": "recoverix",
            "records": rec_all,
            "erd_records": erd_all,
            "erd_paired_records": erd_paired_all,
            "total_sessions": len(sessions_raw),
            "processed_sessions": total - len(errs),
            "errors": errs,
        }) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/process")
async def process_batch(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    use_bandpass: str = Form("true"),
    use_notch: str = Form("false"),
    notch_freq: float = Form(50.0),
    use_car: str = Form("false"),
    use_amplitude: str = Form("false"),
    detect_bad: str = Form("false"),
    use_ica: str = Form("false"),
    ica_method: str = Form("fastica"),
    ica_n: Optional[int] = Form(None),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    features: str = Form("mav,variance,std"),
    include_frequency: str = Form("true"),
    psd_method: str = Form("welch"),
    psd_fmin: float = Form(0.0),
    psd_fmax: float = Form(49.5),
    filter_categories: str = Form(""),
    filter_subjects: str = Form(""),
    filter_scenarios: str = Form(""),
    filter_tasks: str = Form(""),
    filter_channels: str = Form(""),
    recoverix_erd_methods: str = Form("intratrial,paired"),
    chunk_mode: str = Form("false"),
    chunk_duration: float = Form(0.5),
    erd_enabled: str = Form("false"),
    erd_baseline_task: str = Form(""),
    erd_target_task: str = Form(""),
    erd_compare_enabled: str = Form("false"),
    erd_compare_baseline: str = Form("Resting"),
    erd_compare_tasks: str = Form("Resting,Thinking"),
):
    """Upload ZIP berisi file EDF + config, proses semua, return features per record.

    chunk_mode=true → setiap task segment di-chunk dengan durasi `chunk_duration`
    detik, fitur dihitung per chunk (lewat ChunkingPipeline).
    """
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File harus berformat .zip")

    def to_bool(s: str) -> bool:
        return str(s).lower() == "true"

    zip_bytes = await file.read()
    zip_buffer = io.BytesIO(zip_bytes)

    edf_files = EEGLoader.list_edf_in_zip(zip_buffer)

    selected_subbands = _resolve_subbands(subbands)
    selected_features = _resolve_features(features)

    cats_filter  = [c.strip() for c in filter_categories.split(",") if c.strip()]
    subj_filter  = [s.strip() for s in filter_subjects.split(",") if s.strip()]
    scen_filter  = [s.strip() for s in filter_scenarios.split(",") if s.strip()]
    tasks_filter = [t.strip() for t in filter_tasks.split(",") if t.strip()]
    ch_filter    = [c.strip() for c in filter_channels.split(",") if c.strip()]

    # Bukan ZIP EDF: alihkan ke pipeline recoveriX (filter opsional + ERD).
    if not edf_files:
        zip_buffer.seek(0)
        sessions_raw = EEGLoader.list_recoverix_sessions_in_zip(zip_buffer)
        if not sessions_raw:
            raise HTTPException(
                status_code=422,
                detail="ZIP tidak berisi file EDF maupun sesi recoveriX (rawData*.tar.gz)",
            )
        rcfg = {
            "bp_low": bp_low, "bp_high": bp_high, "bp_order": bp_order,
            "use_bandpass": to_bool(use_bandpass),
            "use_notch": to_bool(use_notch), "notch_freq": notch_freq,
            "use_car": to_bool(use_car), "use_amplitude": to_bool(use_amplitude),
            "detect_bad": to_bool(detect_bad),
            "use_ica": to_bool(use_ica), "ica_method": ica_method, "ica_n": ica_n,
            "subbands": selected_subbands, "features": selected_features,
            "ch_filter": ch_filter,
            "recoverix_erd_methods": [
                m.strip().lower() for m in recoverix_erd_methods.split(",") if m.strip()
            ],
            "erd_baseline_task": erd_baseline_task,
            "erd_target_task": erd_target_task,
        }
        return _process_recoverix_batch(
            zip_bytes, sessions_raw, rcfg, subj_filter, scen_filter)

    # Config dipaketkan sekali (picklable) lalu dipakai semua worker.
    cfg = {
        "bp_low": bp_low, "bp_high": bp_high, "bp_order": bp_order,
        "use_notch": to_bool(use_notch), "notch_freq": notch_freq,
        "use_car": to_bool(use_car), "use_amplitude": to_bool(use_amplitude),
        "detect_bad": to_bool(detect_bad),
        "use_ica": to_bool(use_ica), "ica_method": ica_method, "ica_n": ica_n,
        "subbands": selected_subbands, "features": selected_features,
        "include_frequency": to_bool(include_frequency),
        "psd_method": psd_method, "psd_fmin": psd_fmin, "psd_fmax": psd_fmax,
        "tasks_filter": tasks_filter, "ch_filter": ch_filter,
        "chunk_mode": to_bool(chunk_mode), "chunk_duration": chunk_duration,
        "erd_enabled": to_bool(erd_enabled),
        "erd_baseline_task": erd_baseline_task,
        "erd_target_task": erd_target_task,
        "erd_compare_enabled": to_bool(erd_compare_enabled),
        "erd_compare_baseline": erd_compare_baseline,
        "erd_compare_tasks": [t.strip() for t in erd_compare_tasks.split(",") if t.strip()],
    }

    # Build payload hanya untuk file yang lolos filter kategori + scenario.
    payloads = []
    for edf_path in edf_files:
        meta = EEGLoader.detect_category(edf_path)
        if cats_filter and meta["category"] not in cats_filter:
            continue
        if scen_filter and meta.get("scenario") not in scen_filter:
            continue
        payloads.append((edf_path, meta, cfg))

    total = len(payloads)
    chunk_mode_b = to_bool(chunk_mode)

    async def event_generator():
        """Yield NDJSON: event progress per file selesai, lalu event result.

        Tiap baris satu JSON object:
          {"type":"progress","processed":n,"total":N}
          {"type":"result", ...payload lengkap...}
          {"type":"error","detail":"..."}
        """
        if total == 0:
            yield json.dumps({
                "type": "error",
                "detail": "Tidak ada file EDF yang cocok dengan filter",
            }) + "\n"
            return

        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        results = [None] * total

        def _run():
            # Jalan di thread terpisah: drive process pool, push progress
            # ke queue lewat loop.call_soon_threadsafe (thread-safe).
            def emit(item):
                loop.call_soon_threadsafe(queue.put_nowait, item)
            try:
                workers = max(1, min(os.cpu_count() or 1, total))
                with ProcessPoolExecutor(
                    max_workers=workers,
                    initializer=_init_worker,
                    initargs=(zip_bytes,),
                ) as ex:
                    fut_idx = {
                        ex.submit(_process_one_file, payloads[i]): i
                        for i in range(total)
                    }
                    done = 0
                    for fut in as_completed(fut_idx):
                        i = fut_idx[fut]
                        try:
                            results[i] = fut.result()
                        except Exception as e:
                            results[i] = {
                                "filename": payloads[i][0], "records": [],
                                "encoding": [], "erd": [], "erd_compare": [],
                                "error": str(e),
                            }
                        done += 1
                        emit({"type": "progress",
                              "processed": done, "total": total})
            except Exception as exc:
                logger.warning(
                    "Process pool batch gagal (%s), fallback serial", exc)
                # Fallback serial supaya tetap dapat hasil.
                _init_worker(zip_bytes)
                done = 0
                for i in range(total):
                    if results[i] is None:
                        results[i] = _process_one_file(payloads[i])
                    done += 1
                    emit({"type": "progress",
                          "processed": done, "total": total})
            finally:
                emit({"type": "_done"})

        loop.run_in_executor(None, _run)

        while True:
            item = await queue.get()
            if item.get("type") == "_done":
                break
            yield json.dumps(item) + "\n"

        # Agregasi hasil sesuai urutan file asli (deterministik).
        rec_all, enc_all, erd_all, erd_cmp_all, errs = [], [], [], [], []
        for res in results:
            if res is None:
                continue
            if res["error"]:
                errs.append({"file": res["filename"], "error": res["error"]})
                continue
            rec_all.extend(res["records"])
            enc_all.extend(res["encoding"])
            erd_all.extend(res["erd"])
            erd_cmp_all.extend(res.get("erd_compare", []))

        if not rec_all:
            yield json.dumps({
                "type": "error",
                "detail": f"Gagal memproses semua file EDF. Errors: {errs[:3]}",
            }) + "\n"
            return

        yield json.dumps({
            "type": "result",
            "data_type": "edf",
            "records": rec_all,
            "encoding_records": enc_all,
            "erd_records": erd_all,
            "erd_compare_records": erd_cmp_all,
            "total_files": len(edf_files),
            "processed_files": len(set(r["filename"] for r in rec_all)),
            "errors": errs,
            "mode": "chunk" if chunk_mode_b else "full",
            "chunk_duration": chunk_duration if chunk_mode_b else None,
        }) + "\n"

    return StreamingResponse(
        event_generator(), media_type="application/x-ndjson")
