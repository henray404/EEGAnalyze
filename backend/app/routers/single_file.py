"""
Router single_file — Endpoint untuk analisis 1 file EDF / TXT.

Endpoint:
  POST /upload           — load file, return metadata
  POST /process          — full pipeline -> features (Full Data atau Chunk mode)
  POST /plot/raw         — Plotly JSON multi-channel signal plot
  POST /plot/filtered    — Plotly JSON setelah bandpass/notch/CAR
  POST /plot/subband     — Plotly JSON satu plot per subband (single channel)
  POST /plot/ica         — Plotly JSON komponen ICA
"""

import json
import logging
import math
import numpy as np
import plotly.graph_objects as go
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional

from app.processing.loader import EEGLoader
from app.processing.filters import EEGFilters
from app.processing.features import EEGFeatures
from app.processing.chunking import ChunkingPipeline
from app.config import DEFAULT_SUBBANDS

logger = logging.getLogger(__name__)
router = APIRouter()


_SUBBAND_MAP = {
    "delta": "Delta", "theta": "Theta", "mu": "Mu",
    "alpha": "Alpha", "low_beta": "Low_Beta",
    "beta": "Beta", "high_beta": "High_Beta", "gamma": "Gamma",
}

_ACCENT_COLORS = [
    "#5B65DC", "#7B83E5", "#4A53C0", "#8E96EE",
    "#3A45A8", "#A1A7F2", "#5B65DC", "#7B83E5",
]


def _to_bool(s) -> bool:
    return str(s).lower() == "true"


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


def _parse_csv_list(s: str) -> list:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def _is_txt(filename: str) -> bool:
    return filename.lower().endswith(".txt")


def _is_edf(filename: str) -> bool:
    return filename.lower().endswith(".edf")


def _sanitize_records(records: list) -> list:
    """Ganti NaN/inf dengan None agar JSON serialization tidak gagal."""
    for r in records:
        for k, v in r.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                r[k] = None
    return records


def _is_zip(filename: str) -> bool:
    return filename.lower().endswith(".zip")


def _load_uploaded_file(loader: EEGLoader, upload: UploadFile):
    fname = upload.filename or ""
    if _is_edf(fname):
        return loader.load_edf(upload.file)
    if _is_txt(fname):
        return loader.load_openbci_txt(upload.file)
    if _is_zip(fname):
        return loader.load_recoverix_zip(upload.file)
    raise HTTPException(
        status_code=400,
        detail="File harus berformat .edf, .txt (OpenBCI), atau .zip (recoveriX)",
    )


def _apply_filters(
    loader: EEGLoader,
    bp_low: float, bp_high: float, bp_order: int,
    use_notch: bool, notch_freq: float,
    use_car: bool, use_amplitude: bool,
    use_ica: bool, ica_method: str, ica_n: Optional[int],
):
    if use_car:
        EEGFilters.apply_car(loader)
    if use_amplitude:
        EEGFilters.apply_amplitude_filter(loader)
    if use_notch:
        EEGFilters.apply_notch(loader, freq=notch_freq)
    EEGFilters.apply_bandpass(
        loader, low_freq=bp_low, high_freq=bp_high, order=bp_order,
    )
    if use_ica:
        EEGFilters.apply_ica(loader, n_components=ica_n, method=ica_method)


def _annotations_in_window(
    loader: EEGLoader, t_start: float, t_end: float,
    allowed_occ_keys: set = None,
    filter_active: bool = False,
) -> list:
    """Return annotations overlapping [t_start, t_end] as list of dicts.

    allowed_occ_keys: set berisi "task|occurrence" (occurrence 1-based per
        nama task, urutan sama seperti EEGLoader.get_task_occurrences).
        Dipakai untuk seleksi occurrence spesifik, bukan sekadar nama task.
    filter_active: False -> abaikan allowed_occ_keys, tampilkan semua
        annotation di window. True dengan allowed_occ_keys kosong -> tidak
        ada annotation yang ditampilkan (user sudah "Hapus Semua").
    """
    if loader.raw is None:
        return []
    keys = allowed_occ_keys or set()
    out = []
    counter = {}
    for a in loader.raw.annotations:
        desc = str(a["description"])
        if desc == "Thinking and Acting":
            desc = "Think_Acting"
        counter[desc] = counter.get(desc, 0) + 1
        onset = float(a["onset"])
        dur = float(a["duration"])
        end = onset + dur
        if end < t_start or onset > t_end:
            continue
        if filter_active and f"{desc}|{counter[desc]}" not in keys:
            continue
        out.append({
            "onset": onset,
            "duration": dur,
            "description": desc,
        })
    return out


def _annotation_shapes(anns: list, color: str = "#5B65DC") -> tuple:
    """Build Plotly layout shapes + annotation labels from EDF annotations."""
    shapes = []
    text_anns = []
    for a in anns:
        onset = a["onset"]
        dur = a["duration"]
        shapes.append(dict(
            type="line",
            xref="x", yref="paper",
            x0=onset, x1=onset, y0=0, y1=1,
            line=dict(color=color, width=1.2, dash="dot"),
        ))
        if dur > 0:
            shapes.append(dict(
                type="rect",
                xref="x", yref="paper",
                x0=onset, x1=onset + dur, y0=0, y1=1,
                fillcolor=color, opacity=0.06,
                line=dict(width=0),
                layer="below",
            ))
        text_anns.append(dict(
            x=onset, y=1.02, xref="x", yref="paper",
            text=a["description"],
            showarrow=False,
            font=dict(size=10, color=color, family="Inter, sans-serif"),
            bgcolor="rgba(238,239,253,0.85)",
            bordercolor=color, borderwidth=1, borderpad=3,
            xanchor="left", yanchor="bottom",
        ))
    return shapes, text_anns


def _signal_to_plotly_fig(
    times: np.ndarray, data: np.ndarray, ch_names: list, title: str = "EEG Signal",
    annotations: list = None,
) -> dict:
    fig = go.Figure()
    n_ch = len(ch_names)
    if n_ch == 0 or data.size == 0:
        fig.update_layout(title=title)
        return json.loads(fig.to_json())

    # Spread dihitung dari median std PER CHANNEL (bukan std global data yang
    # sudah di-flatten). Std global ikut kena selisih baseline antar channel
    # (mis. channel OpenBCI mentah yang belum di-referensi bisa punya mean
    # ratusan ribu uV berbeda-beda per channel) sehingga jauh lebih besar
    # daripada variasi sinyal sesungguhnya -> fluktuasi asli tiap channel jadi
    # kelihatan flat karena skala sumbu-y ketarik oleh selisih baseline itu,
    # bukan oleh amplitudo sinyal. Median (bukan mean) dipakai supaya satu
    # channel yang rusak/railed tidak ikut menarik skala channel lain.
    per_ch_std = np.std(data, axis=1)
    spread = float(np.median(per_ch_std) * 6 + 1e-6)
    means = np.mean(data, axis=1, keepdims=True)
    centered = data - means
    for idx, ch in enumerate(ch_names):
        offset = -idx * spread
        fig.add_trace(go.Scatter(
            x=times.tolist(),
            y=(centered[idx] + offset).tolist(),
            mode="lines",
            name=ch,
            line=dict(width=1.4, color=_ACCENT_COLORS[idx % len(_ACCENT_COLORS)]),
            hovertemplate=f"<b>{ch}</b><br>t=%{{x:.3f}}s<br>%{{y:.3f}}<extra></extra>",
        ))

    shapes, text_anns = _annotation_shapes(annotations or [])

    fig.update_layout(
        title=title,
        xaxis_title="time (s)",
        yaxis_title="amplitude (uV, offset per channel)",
        plot_bgcolor="white",
        paper_bgcolor="white",
        font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
        margin=dict(l=60, r=20, t=60, b=40),
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=-0.22, x=0),
        xaxis=dict(
            showgrid=True, gridcolor="#E8E9F8",
            gridwidth=1, griddash="dash",
        ),
        yaxis=dict(
            showgrid=True, gridcolor="#E8E9F8",
            gridwidth=1, griddash="dash",
            zeroline=False, showticklabels=False,
        ),
        shapes=shapes,
        annotations=text_anns,
    )
    return json.loads(fig.to_json())


def _slice_times(loader: EEGLoader, t_start: float, t_dur: float, channels: list):
    sfreq = loader.sfreq
    n_total = loader.raw.n_times
    i0 = max(0, int(t_start * sfreq))
    i1 = min(n_total, int((t_start + t_dur) * sfreq))
    if i1 <= i0:
        raise HTTPException(status_code=400, detail="Rentang waktu tidak valid")

    ch_idx = [loader.raw.ch_names.index(c) for c in channels if c in loader.raw.ch_names]
    if not ch_idx:
        raise HTTPException(status_code=400, detail="Tidak ada channel valid")

    data = loader.raw.get_data(picks=ch_idx, start=i0, stop=i1)
    data_uv = data * 1e6
    times = np.arange(i0, i1) / sfreq
    used_names = [loader.raw.ch_names[i] for i in ch_idx]
    return times, data_uv, used_names


# ============================================================== #
#  POST /upload                                                   #
# ============================================================== #

@router.post("/upload")
def upload_single_file(file: UploadFile = File(...)):
    loader = EEGLoader()
    try:
        info = _load_uploaded_file(loader, file)
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Gagal load file: {e}")

    info["tasks"] = loader.get_task_list()
    info["occurrences"] = [
        {**o, "label": f'{o["task"]} #{o["occurrence"]}'}
        for o in loader.get_task_occurrences()
    ]
    info["filename"] = file.filename
    if _is_edf(file.filename or ""):
        info["format"] = "EDF"
    elif _is_zip(file.filename or ""):
        info["format"] = "recoveriX"
    else:
        info["format"] = "TXT"
    return JSONResponse(content=info)


# ============================================================== #
#  POST /process                                                  #
# ============================================================== #

@router.post("/process")
def process_single_file(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    use_notch: str = Form("false"),
    notch_freq: float = Form(50.0),
    use_car: str = Form("false"),
    use_amplitude: str = Form("false"),
    use_ica: str = Form("false"),
    ica_method: str = Form("fastica"),
    ica_n: Optional[int] = Form(None),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    features: str = Form("mav,variance,std"),
    include_frequency: str = Form("true"),
    psd_method: str = Form("welch"),
    psd_fmin: float = Form(0.0),
    psd_fmax: float = Form(49.5),
    chunk_mode: str = Form("false"),
    chunk_duration: float = Form(0.5),
    channels_filter: str = Form(""),
    filter_tasks: str = Form(""),
    selection_mode: str = Form("task"),
    selected: str = Form(""),
    selection_active: str = Form("false"),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)

        _apply_filters(
            loader,
            bp_low, bp_high, bp_order,
            _to_bool(use_notch), notch_freq,
            _to_bool(use_car), _to_bool(use_amplitude),
            _to_bool(use_ica), ica_method, ica_n,
        )

        df = loader.extract_dataframe()
        all_tasks = loader.get_task_list()

        sel_active = _to_bool(selection_active)
        sel_mode = (selection_mode or "task").strip().lower()
        sel_items = _parse_csv_list(selected)
        # File tanpa annotation sama sekali (mis. TXT OpenBCI, EDF tanpa marker)
        # -> tidak ada yang bisa dipilih; diproses sebagai seluruh file.
        whole_file = not all_tasks
        # Seleksi eksplisit: kosong = proses nothing (bukan fallback ke semua).
        # Hanya wajib kalau memang ADA task untuk dipilih.
        if sel_active and not sel_items and not whole_file:
            raise HTTPException(
                status_code=400,
                detail="Pilih minimal 1 task/occurrence untuk diproses.",
            )

        if whole_file:
            tasks = []  # tidak ada task; dihandle branch whole-file di bawah
        elif sel_mode == "occurrence":
            tasks = all_tasks  # path occurrence filter sendiri via selected_occ
        elif sel_active:
            tasks = [t for t in all_tasks if t in sel_items]
            if not tasks:
                raise HTTPException(
                    status_code=400,
                    detail="Task terpilih tidak ditemukan di file.",
                )
        else:
            # Kompat lama: filter_tasks (kosong = semua task).
            tasks_filter = _parse_csv_list(filter_tasks)
            tasks = (
                [t for t in all_tasks if t in tasks_filter]
                if tasks_filter else all_tasks
            )

        all_channels = loader.channel_names
        ch_filter = _parse_csv_list(channels_filter)
        channels = [c for c in all_channels if not ch_filter or c in ch_filter]
        if not channels:
            channels = all_channels

        selected_subbands = _resolve_subbands(subbands)
        selected_features = _resolve_features(features)

        if whole_file:
            # Tidak ada task/annotation: proses seluruh sinyal sebagai 1 segmen.
            if _to_bool(chunk_mode):
                feat_df = ChunkingPipeline.compute_chunked_subband_features(
                    df, channels, loader.sfreq,
                    chunk_duration=chunk_duration,
                    subbands=selected_subbands,
                    features=selected_features,
                    parallel=True,
                )
                mode = "chunk"
            else:
                feat_df = EEGFeatures.compute_subband_features(
                    df, channels, loader.sfreq,
                    selected_subbands, selected_features,
                    include_frequency=_to_bool(include_frequency),
                    psd_method=psd_method, psd_fmin=psd_fmin, psd_fmax=psd_fmax,
                )
                mode = "full"
            if not feat_df.empty:
                feat_df.insert(0, "task", "(seluruh file)")
        elif sel_mode == "occurrence":
            # Full-data per occurrence (chunk belum didukung untuk occurrence).
            selected_occ = set()
            occ_tasks = set()
            for item in sel_items:
                if "|" not in item:
                    continue
                t, o = item.rsplit("|", 1)
                try:
                    selected_occ.add((t, int(o)))
                    occ_tasks.add(t)
                except ValueError:
                    continue
            if not selected_occ:
                raise HTTPException(
                    status_code=400,
                    detail="Format occurrence tidak valid (harus 'task|nomor').",
                )
            feat_df = EEGFeatures.compute_occurrence_features(
                loader, df, channels, list(occ_tasks),
                subbands=selected_subbands,
                features=selected_features,
                include_frequency=_to_bool(include_frequency),
                psd_method=psd_method,
                psd_fmin=psd_fmin,
                psd_fmax=psd_fmax,
                selected_occ=selected_occ,
            )
            mode = "occurrence"
        elif _to_bool(chunk_mode):
            feat_df = ChunkingPipeline.compute_task_chunked_features(
                loader, df, channels, tasks,
                chunk_duration=chunk_duration,
                subbands=selected_subbands,
                features=selected_features,
                parallel=True,
            )
            mode = "chunk"
        else:
            feat_df = EEGFeatures.compute_task_features(
                loader, df, channels, tasks,
                subbands=selected_subbands,
                features=selected_features,
                include_frequency=_to_bool(include_frequency),
                psd_method=psd_method,
                psd_fmin=psd_fmin,
                psd_fmax=psd_fmax,
            )
            mode = "full"

        records = _sanitize_records(feat_df.to_dict(orient="records")) if not feat_df.empty else []
        return JSONResponse(content={
            "mode": mode,
            "tasks": tasks,
            "channels": channels,
            "sfreq": loader.sfreq,
            "n_records": len(records),
            "features": records,
            "processing_log": loader.get_processing_log(),
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("process_single_file failed")
        raise HTTPException(status_code=422, detail=str(e))


# ============================================================== #
#  POST /erd                                                      #
# ============================================================== #

@router.post("/erd")
def compute_erd_single(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    use_notch: str = Form("false"),
    notch_freq: float = Form(50.0),
    use_car: str = Form("false"),
    use_amplitude: str = Form("false"),
    use_ica: str = Form("false"),
    ica_method: str = Form("fastica"),
    ica_n: Optional[int] = Form(None),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    channels_filter: str = Form(""),
    baseline_task: str = Form(""),
    target_task: str = Form(""),
    chunk_mode: str = Form("false"),
    chunk_duration: float = Form(0.5),
    intra_trial: str = Form("false"),
):
    is_intra_trial = _to_bool(intra_trial)
    if not target_task:
        raise HTTPException(status_code=400, detail="target_task wajib diisi")
    if not is_intra_trial and not baseline_task:
        raise HTTPException(status_code=400, detail="baseline_task dan target_task wajib diisi")

    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        _apply_filters(
            loader,
            bp_low, bp_high, bp_order,
            _to_bool(use_notch), notch_freq,
            _to_bool(use_car), _to_bool(use_amplitude),
            _to_bool(use_ica), ica_method, ica_n,
        )

        df = loader.extract_dataframe()
        all_channels = loader.channel_names
        ch_filter = _parse_csv_list(channels_filter)
        channels = [c for c in all_channels if not ch_filter or c in ch_filter] or all_channels

        selected_subbands = _resolve_subbands(subbands)

        if is_intra_trial:
            # cue_offset_s bisa 0.0 valid (trigger di sampel 0); cek None.
            if loader.cue_offset_s is None:
                raise HTTPException(
                    status_code=400,
                    detail="Mode intra-trial cuma berlaku untuk file recoveriX (.zip).",
                )
            erd_df = EEGFeatures.compute_erd_ers_intratrial(
                loader, df, channels, target_task,
                subbands=selected_subbands,
                cue_offset_s=loader.cue_offset_s,
            )
            erd_mode = "intra_trial"
        elif _to_bool(chunk_mode):
            erd_df = EEGFeatures.compute_erd_ers_paired_chunked(
                loader, df, channels, target_task,
                subbands=selected_subbands,
                baseline_task=baseline_task,
                chunk_duration=chunk_duration,
            )
            erd_mode = "chunk"
        else:
            erd_df = EEGFeatures.compute_erd_ers_paired(
                loader, df, channels, target_task,
                subbands=selected_subbands,
                baseline_task=baseline_task,
            )
            erd_mode = "full"

        records = _sanitize_records(erd_df.to_dict(orient="records")) if not erd_df.empty else []
        return JSONResponse(content={
            "baseline_task": baseline_task if not is_intra_trial else "pre-cue",
            "target_task": target_task,
            "erd_mode": erd_mode,
            "chunk_duration": chunk_duration if erd_mode == "chunk" else None,
            "erd_records": records,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("compute_erd_single failed")
        raise HTTPException(status_code=422, detail=str(e))


# ============================================================== #
#  POST /plot/raw                                                 #
# ============================================================== #

@router.post("/plot/raw")
def plot_raw(
    file: UploadFile = File(...),
    channels: str = Form(""),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    annotation_filter: str = Form(""),
    annotation_filter_active: str = Form("false"),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        ch_list = _parse_csv_list(channels) or loader.channel_names[:8]
        times, data, used = _slice_times(loader, t_start, t_dur, ch_list)
        allowed = set(_parse_csv_list(annotation_filter))
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed, _to_bool(annotation_filter_active))
        fig = _signal_to_plotly_fig(times, data, used, title="Raw EEG Signal", annotations=anns)
        return JSONResponse(content={"figure": fig, "channels": used, "annotations": anns})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("plot_raw failed")
        raise HTTPException(status_code=422, detail=str(e))


# ============================================================== #
#  POST /plot/filtered                                            #
# ============================================================== #

@router.post("/plot/filtered")
def plot_filtered(
    file: UploadFile = File(...),
    channels: str = Form(""),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    use_notch: str = Form("false"),
    notch_freq: float = Form(50.0),
    use_car: str = Form("false"),
    use_amplitude: str = Form("false"),
    annotation_filter: str = Form(""),
    annotation_filter_active: str = Form("false"),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        if _to_bool(use_car):
            EEGFilters.apply_car(loader)
        if _to_bool(use_amplitude):
            EEGFilters.apply_amplitude_filter(loader)
        if _to_bool(use_notch):
            EEGFilters.apply_notch(loader, freq=notch_freq)
        EEGFilters.apply_bandpass(
            loader, low_freq=bp_low, high_freq=bp_high, order=bp_order,
        )
        ch_list = _parse_csv_list(channels) or loader.channel_names[:8]
        times, data, used = _slice_times(loader, t_start, t_dur, ch_list)
        title = f"Filtered Signal . Bandpass {bp_low}-{bp_high} Hz"
        if _to_bool(use_notch):
            title += f" . Notch {notch_freq:g} Hz"
        allowed = set(_parse_csv_list(annotation_filter))
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed, _to_bool(annotation_filter_active))
        fig = _signal_to_plotly_fig(times, data, used, title=title, annotations=anns)
        return JSONResponse(content={"figure": fig, "channels": used, "annotations": anns})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("plot_filtered failed")
        raise HTTPException(status_code=422, detail=str(e))


# ============================================================== #
#  POST /plot/subband                                             #
# ============================================================== #

@router.post("/plot/subband")
def plot_subband(
    file: UploadFile = File(...),
    channel: str = Form(...),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    annotation_filter: str = Form(""),
    annotation_filter_active: str = Form("false"),
):
    from plotly.subplots import make_subplots
    from scipy.signal import butter, filtfilt

    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        if channel not in loader.raw.ch_names:
            raise HTTPException(
                status_code=400,
                detail=f"Channel '{channel}' tidak ditemukan",
            )

        selected_subbands = _resolve_subbands(subbands)
        if not selected_subbands:
            raise HTTPException(status_code=400, detail="Tidak ada subband valid")

        sfreq = loader.sfreq
        n_total = loader.raw.n_times
        i0 = max(0, int(t_start * sfreq))
        i1 = min(n_total, int((t_start + t_dur) * sfreq))
        if i1 <= i0:
            raise HTTPException(status_code=400, detail="Rentang waktu tidak valid")

        ch_idx = loader.raw.ch_names.index(channel)
        signal = loader.raw.get_data(picks=[ch_idx], start=i0, stop=i1)[0] * 1e6
        times = np.arange(i0, i1) / sfreq

        names = list(selected_subbands.keys())
        rows = len(names)
        fig = make_subplots(
            rows=rows, cols=1, shared_xaxes=True,
            subplot_titles=[
                f"{n} ({selected_subbands[n][0]}-{selected_subbands[n][1]} Hz)"
                for n in names
            ],
            vertical_spacing=0.05,
        )

        for r, name in enumerate(names, start=1):
            low, high = selected_subbands[name]
            nyq = 0.5 * sfreq
            b, a = butter(5, [max(low / nyq, 0.001), min(high / nyq, 0.999)], btype="band")
            filtered = filtfilt(b, a, signal)
            color = _ACCENT_COLORS[(r - 1) % len(_ACCENT_COLORS)]
            fig.add_trace(
                go.Scatter(
                    x=times.tolist(),
                    y=filtered.tolist(),
                    mode="lines",
                    name=name,
                    line=dict(width=1.5, color=color),
                    fill="tozeroy",
                    fillcolor="rgba(91,101,220,0.12)",
                ),
                row=r, col=1,
            )

        allowed = set(_parse_csv_list(annotation_filter))
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed, _to_bool(annotation_filter_active))
        shapes = []
        text_anns = []
        for r_idx in range(1, rows + 1):
            xref = "x" if r_idx == 1 else f"x{r_idx}"
            yref = "y domain" if r_idx == 1 else f"y{r_idx} domain"
            for a in anns:
                onset = a["onset"]
                dur = a["duration"]
                shapes.append(dict(
                    type="line", xref=xref, yref=yref,
                    x0=onset, x1=onset, y0=0, y1=1,
                    line=dict(color="#5B65DC", width=1.0, dash="dot"),
                ))
                if dur > 0:
                    shapes.append(dict(
                        type="rect", xref=xref, yref=yref,
                        x0=onset, x1=onset + dur, y0=0, y1=1,
                        fillcolor="#5B65DC", opacity=0.05,
                        line=dict(width=0), layer="below",
                    ))
        # Text labels only on top subplot
        for a in anns:
            text_anns.append(dict(
                x=a["onset"], y=1.04, xref="x", yref="paper",
                text=a["description"], showarrow=False,
                font=dict(size=10, color="#5B65DC", family="Inter, sans-serif"),
                bgcolor="rgba(238,239,253,0.85)",
                bordercolor="#5B65DC", borderwidth=1, borderpad=3,
                xanchor="left", yanchor="bottom",
            ))

        height = max(160 * rows, 360)
        existing_anns = list(fig.layout.annotations) if fig.layout.annotations else []
        fig.update_layout(
            height=height,
            title_text=f"Subband Decomposition . Channel {channel}",
            plot_bgcolor="white",
            paper_bgcolor="white",
            font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
            margin=dict(l=50, r=20, t=80, b=40),
            showlegend=False,
            shapes=shapes,
            annotations=existing_anns + text_anns,
        )
        for r in range(1, rows + 1):
            fig.update_xaxes(
                showgrid=True, gridcolor="#E8E9F8", griddash="dash",
                row=r, col=1,
            )
            fig.update_yaxes(
                showgrid=True, gridcolor="#E8E9F8", griddash="dash",
                row=r, col=1, title_text="uV",
            )
        fig.update_xaxes(title_text="time (s)", row=rows, col=1)

        return JSONResponse(content={
            "figure": json.loads(fig.to_json()),
            "channel": channel,
            "subbands": names,
            "annotations": anns,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("plot_subband failed")
        raise HTTPException(status_code=422, detail=str(e))


# ============================================================== #
#  POST /plot/ica                                                 #
# ============================================================== #

@router.post("/plot/ica")
def plot_ica(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    ica_method: str = Form("fastica"),
    ica_n: Optional[int] = Form(None),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    annotation_filter: str = Form(""),
    annotation_filter_active: str = Form("false"),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        EEGFilters.apply_bandpass(
            loader, low_freq=bp_low, high_freq=bp_high, order=bp_order,
        )
        try:
            EEGFilters.apply_ica(loader, n_components=ica_n, method=ica_method)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"ICA gagal: {e}")

        sfreq = loader.sfreq
        start_idx = int(t_start * sfreq)
        end_idx = min(start_idx + int(t_dur * sfreq), loader.raw.n_times)
        data = loader.raw.get_data(start=start_idx, stop=end_idx) * 1e6
        times = (np.arange(data.shape[1]) / sfreq + t_start).tolist()

        allowed = set(_parse_csv_list(annotation_filter))
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed, _to_bool(annotation_filter_active))
        shapes, text_anns = _annotation_shapes(anns)

        fig = go.Figure()
        n_ch = data.shape[0]
        # Sama seperti _signal_to_plotly_fig: spread dari median std PER
        # COMPONENT + data di-mean-center dulu, supaya satu IC dengan
        # magnitude jauh lebih besar (mis. artifact) tidak menekan skala
        # sumbu-y sehingga IC lain kelihatan flat.
        per_ic_std = np.std(data, axis=1)
        spread = float(np.median(per_ic_std) * 6 + 1e-6)
        means = np.mean(data, axis=1, keepdims=True)
        centered = data - means
        for i in range(n_ch):
            fig.add_trace(go.Scatter(
                x=times,
                y=(centered[i] - i * spread).tolist(),
                mode="lines",
                name=f"IC {i+1}",
                line=dict(width=1.2, color=_ACCENT_COLORS[i % len(_ACCENT_COLORS)]),
            ))
        fig.update_layout(
            title=f"ICA Components ({ica_method})",
            plot_bgcolor="white", paper_bgcolor="white",
            font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
            margin=dict(l=60, r=20, t=40, b=40),
            xaxis_title="time (s)",
            xaxis=dict(showgrid=True, gridcolor="#E8E9F8", griddash="dash"),
            yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
            showlegend=False,
            shapes=shapes,
            annotations=text_anns,
        )
        return JSONResponse(content={
            "figure": json.loads(fig.to_json()),
            "n_components": n_ch,
            "annotations": anns,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("plot_ica failed")
        raise HTTPException(status_code=422, detail=str(e))
