"""
Router batch_recoverix — Proses ZIP berisi banyak sesi recoveriX (multi-pasien
atau multi-skenario), tiap sesi diproses terpisah menjadi fitur regular
(MAV/Variance/STD per kondisi) dan ERD intra-trial per kondisi.
"""

import io
import os
import json
import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor, as_completed

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.processing import recoverix
from app.processing.loader import EEGLoader
from app.processing.features import EEGFeatures
from app.routers.batch import _resolve_subbands, _resolve_features

logger = logging.getLogger(__name__)

router = APIRouter()


# Bytes ZIP dishare ke tiap worker sekali via initializer (bukan dikirim
# per task) supaya tidak di-pickle berulang. Mirror pola di batch.py.
_WORKER_ZIP_BYTES = None


def _init_worker(zip_bytes):
    global _WORKER_ZIP_BYTES
    _WORKER_ZIP_BYTES = zip_bytes


def _process_one_session(payload):
    """Proses satu sesi recoveriX di dalam worker proses terpisah.

    Module-level + argumen picklable supaya jalan di ProcessPoolExecutor pada
    Windows (spawn). Data recoveriX sudah difilter di device, jadi TIDAK ADA
    filter sinyal apapun di sini - langsung extract_dataframe() -> fitur.
    """
    session_dir, tar_names, meta, cfg = payload
    out = {"session_dir": session_dir, "records": [], "erd_records": [], "error": None}

    loader = EEGLoader()
    try:
        zip_buffer = io.BytesIO(_WORKER_ZIP_BYTES)
        loader.load_recoverix_session(zip_buffer, tar_names)

        df = loader.extract_dataframe()
        all_channels = loader.channel_names
        channels = [c for c in all_channels if not cfg["ch_filter"] or c in cfg["ch_filter"]]
        if not channels:
            return out

        feat_df = EEGFeatures.compute_task_features(
            loader, df, channels, ["Left", "Right"],
            subbands=cfg["subbands"], features=cfg["features"],
        )
        for record in feat_df.to_dict(orient="records"):
            out["records"].append({**meta, "session": session_dir, **record})

        for task_name in ["Left", "Right"]:
            erd_df = EEGFeatures.compute_erd_ers_intratrial(
                loader, df, channels, task_name,
                subbands=cfg["subbands"], cue_offset_s=loader.cue_offset_s,
            )
            for rec in erd_df.to_dict(orient="records"):
                out["erd_records"].append({**meta, "session": session_dir, **rec})
    except Exception as e:
        out["error"] = str(e)

    return out


@router.post("/recoverix/scan")
async def scan_recoverix_zip(file: UploadFile = File(...)):
    """Scan ZIP multi-sesi recoveriX: daftar sesi + metadata + channels.

    Return:
      total_sessions, sessions (list metadata per sesi), subjects, scenarios,
      tasks (selalu ["Left", "Right"]), channels.
    """
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File harus berformat .zip")

    zip_bytes = await file.read()
    zip_buffer = io.BytesIO(zip_bytes)

    try:
        sessions_raw = EEGLoader.list_recoverix_sessions_in_zip(zip_buffer)
        if not sessions_raw:
            raise HTTPException(
                status_code=422,
                detail="Tidak ada sesi recoveriX (rawData*.tar.gz) dalam ZIP",
            )

        sessions = []
        subjects, scenarios = set(), set()
        for s in sessions_raw:
            meta = recoverix.parse_session_path(s["session_dir"])
            sessions.append({"session_dir": s["session_dir"], **meta})
            subjects.add(meta["subject"])
            scenarios.add(meta["scenario"])

        zip_buffer.seek(0)
        loader = EEGLoader()
        loader.load_recoverix_session(zip_buffer, sessions_raw[0]["tar_names"])

        return JSONResponse(content={
            "total_sessions": len(sessions),
            "sessions": sessions,
            "subjects": sorted(subjects),
            "scenarios": sorted(scenarios),
            "tasks": ["Left", "Right"],
            "channels": loader.channel_names,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("scan_recoverix_zip failed")
        raise HTTPException(status_code=422, detail=f"Gagal scan ZIP recoveriX: {e}")


@router.post("/recoverix/process")
async def process_recoverix_batch(
    file: UploadFile = File(...),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    features: str = Form("mav,variance,std"),
    filter_subjects: str = Form(""),
    filter_scenarios: str = Form(""),
    filter_channels: str = Form(""),
):
    """Proses semua sesi recoveriX dalam ZIP (atau yang lolos filter).

    NDJSON streaming: progress per sesi selesai, lalu hasil akhir berisi
    `records` (fitur regular per kondisi) dan `erd_records` (ERD intra-trial
    per kondisi).
    """
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File harus berformat .zip")

    zip_bytes = await file.read()
    zip_buffer = io.BytesIO(zip_bytes)

    sessions_raw = EEGLoader.list_recoverix_sessions_in_zip(zip_buffer)
    if not sessions_raw:
        raise HTTPException(
            status_code=422,
            detail="Tidak ada sesi recoveriX (rawData*.tar.gz) dalam ZIP",
        )

    selected_subbands = _resolve_subbands(subbands)
    selected_features = _resolve_features(features)

    subj_filter = [s.strip() for s in filter_subjects.split(",") if s.strip()]
    scen_filter = [s.strip() for s in filter_scenarios.split(",") if s.strip()]
    ch_filter = [c.strip() for c in filter_channels.split(",") if c.strip()]

    cfg = {"subbands": selected_subbands, "features": selected_features, "ch_filter": ch_filter}

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
                                "erd_records": [], "error": str(e),
                            }
                        done += 1
                        emit({"type": "progress", "processed": done, "total": total})
            except Exception as exc:
                logger.warning("Process pool batch recoverix gagal (%s), fallback serial", exc)
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

        rec_all, erd_all, errs = [], [], []
        for res in results:
            if res is None:
                continue
            if res["error"]:
                errs.append({"session": res["session_dir"], "error": res["error"]})
                continue
            rec_all.extend(res["records"])
            erd_all.extend(res["erd_records"])

        if not rec_all and not erd_all:
            yield json.dumps({
                "type": "error",
                "detail": f"Gagal memproses semua sesi recoveriX. Errors: {errs[:3]}",
            }) + "\n"
            return

        yield json.dumps({
            "type": "result",
            "records": rec_all,
            "erd_records": erd_all,
            "total_sessions": len(sessions_raw),
            "processed_sessions": total - len(errs),
            "errors": errs,
        }) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")
