import io
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional

from app.processing.loader import EEGLoader
from app.processing.filters import EEGFilters
from app.processing.features import EEGFeatures
from app.processing.chunking import ChunkingPipeline
from app.config import DEFAULT_SUBBANDS

router = APIRouter()


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

    edf_files = EEGLoader.list_edf_in_zip(zip_buffer)
    if not edf_files:
        raise HTTPException(status_code=422, detail="Tidak ada file EDF dalam ZIP")

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
        "total_files": len(edf_files),
        "files": edf_files,
        "categories": sorted(categories),
        "subjects": sorted(subjects),
        "scenarios": sorted(scenarios),
        "tasks": sorted(all_tasks),
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
    }
    return [
        mapping[f.strip().lower()]
        for f in feats_str.split(",")
        if f.strip().lower() in mapping
    ] or ["mav", "variance", "std"]


@router.post("/process")
async def process_batch(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
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
    filter_tasks: str = Form(""),
    filter_channels: str = Form(""),
    chunk_mode: str = Form("false"),
    chunk_duration: float = Form(0.5),
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
    if not edf_files:
        raise HTTPException(status_code=422, detail="Tidak ada file EDF dalam ZIP")

    selected_subbands = _resolve_subbands(subbands)
    selected_features = _resolve_features(features)

    cats_filter  = [c.strip() for c in filter_categories.split(",") if c.strip()]
    tasks_filter = [t.strip() for t in filter_tasks.split(",") if t.strip()]
    ch_filter    = [c.strip() for c in filter_channels.split(",") if c.strip()]

    all_records = []
    errors = []

    for edf_path in edf_files:
        meta = EEGLoader.detect_category(edf_path)

        # Skip file jika kategorinya tidak dipilih user
        if cats_filter and meta["category"] not in cats_filter:
            continue

        loader = EEGLoader()
        try:
            zip_buffer.seek(0)
            loader.load_edf_from_zip(zip_buffer, edf_path)

            if to_bool(detect_bad):
                bad_chs = EEGFilters.detect_bad_channels(loader.raw)
                if bad_chs:
                    loader.raw.info["bads"] = bad_chs
                    loader.raw.interpolate_bads(reset_bads=True, verbose=False)

            if to_bool(use_car):
                EEGFilters.apply_car(loader)
            if to_bool(use_amplitude):
                EEGFilters.apply_amplitude_filter(loader)
            if to_bool(use_notch):
                EEGFilters.apply_notch(loader, freq=notch_freq)

            EEGFilters.apply_bandpass(
                loader, low_freq=bp_low, high_freq=bp_high, order=bp_order
            )

            if to_bool(use_ica):
                EEGFilters.apply_ica(loader, n_components=ica_n, method=ica_method)

            df = loader.extract_dataframe()
            all_tasks = loader.get_task_list()
            all_channels = loader.channel_names

            # Apply task + channel filters
            tasks    = [t for t in all_tasks    if not tasks_filter or t in tasks_filter]
            channels = [c for c in all_channels if not ch_filter    or c in ch_filter]

            if not tasks or not channels:
                continue

            if to_bool(chunk_mode):
                feat_df = ChunkingPipeline.compute_task_chunked_features(
                    loader, df, channels, tasks,
                    chunk_duration=chunk_duration,
                    subbands=selected_subbands,
                    features=selected_features,
                )
            else:
                feat_df = EEGFeatures.compute_task_features(
                    loader, df, channels, tasks,
                    subbands=selected_subbands,
                    features=selected_features,
                    include_frequency=to_bool(include_frequency),
                    psd_method=psd_method,
                    psd_fmin=psd_fmin,
                    psd_fmax=psd_fmax,
                )

            if feat_df.empty:
                continue

            for record in feat_df.to_dict(orient="records"):
                all_records.append({**meta, "filename": edf_path, **record})

        except Exception as e:
            errors.append({"file": edf_path, "error": str(e)})
            continue

    if not all_records:
        raise HTTPException(
            status_code=422,
            detail=f"Gagal memproses semua file EDF. Errors: {errors[:3]}",
        )

    return JSONResponse(content={
        "records": all_records,
        "total_files": len(edf_files),
        "processed_files": len(set(r["filename"] for r in all_records)),
        "errors": errors,
        "mode": "chunk" if to_bool(chunk_mode) else "full",
        "chunk_duration": chunk_duration if to_bool(chunk_mode) else None,
    })
