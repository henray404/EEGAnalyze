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
    }
    return [
        mapping[f.strip().lower()]
        for f in feats_str.split(",")
        if f.strip().lower() in mapping
    ] or ["mav", "variance", "std"]


def _parse_csv_list(s: str) -> list:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def _is_txt(filename: str) -> bool:
    return filename.lower().endswith(".txt")


def _is_edf(filename: str) -> bool:
    return filename.lower().endswith(".edf")


def _load_uploaded_file(loader: EEGLoader, upload: UploadFile):
    fname = upload.filename or ""
    if _is_edf(fname):
        return loader.load_edf(upload.file)
    if _is_txt(fname):
        return loader.load_openbci_txt(upload.file)
    raise HTTPException(
        status_code=400,
        detail="File harus berformat .edf atau .txt (OpenBCI)",
    )


def _apply_filters(
    loader: EEGLoader,
    bp_low: float, bp_high: float, bp_order: int,
    use_notch: bool, notch_freq: float,
    use_car: bool, use_amplitude: bool, detect_bad: bool,
    use_ica: bool, ica_method: str, ica_n: Optional[int],
):
    if detect_bad:
        bad_chs = EEGFilters.detect_bad_channels(loader.raw)
        if bad_chs:
            loader.raw.info["bads"] = bad_chs
            loader.raw.interpolate_bads(reset_bads=True, verbose=False)
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
    allowed: list = None,
) -> list:
    """Return annotations overlapping [t_start, t_end] as list of dicts.

    allowed: optional list of descriptions to keep. None or empty -> keep all.
    """
    if loader.raw is None:
        return []
    allow_set = set(allowed) if allowed else None
    out = []
    for a in loader.raw.annotations:
        onset = float(a["onset"])
        dur = float(a["duration"])
        end = onset + dur
        if end < t_start or onset > t_end:
            continue
        desc = str(a["description"])
        if allow_set is not None and desc not in allow_set:
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

    spread = float(np.std(data) * 6 + 1e-6)
    for idx, ch in enumerate(ch_names):
        offset = -idx * spread
        fig.add_trace(go.Scatter(
            x=times.tolist(),
            y=(data[idx] + offset).tolist(),
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
async def upload_single_file(file: UploadFile = File(...)):
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
    info["filename"] = file.filename
    info["format"] = "EDF" if _is_edf(file.filename or "") else "TXT"
    return JSONResponse(content=info)


# ============================================================== #
#  POST /process                                                  #
# ============================================================== #

@router.post("/process")
async def process_single_file(
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
    chunk_mode: str = Form("false"),
    chunk_duration: float = Form(0.5),
    channels_filter: str = Form(""),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)

        _apply_filters(
            loader,
            bp_low, bp_high, bp_order,
            _to_bool(use_notch), notch_freq,
            _to_bool(use_car), _to_bool(use_amplitude), _to_bool(detect_bad),
            _to_bool(use_ica), ica_method, ica_n,
        )

        df = loader.extract_dataframe()
        tasks = loader.get_task_list()
        all_channels = loader.channel_names
        ch_filter = _parse_csv_list(channels_filter)
        channels = [c for c in all_channels if not ch_filter or c in ch_filter]
        if not channels:
            channels = all_channels

        selected_subbands = _resolve_subbands(subbands)
        selected_features = _resolve_features(features)

        if _to_bool(chunk_mode):
            feat_df = ChunkingPipeline.compute_task_chunked_features(
                loader, df, channels, tasks,
                chunk_duration=chunk_duration,
                subbands=selected_subbands,
                features=selected_features,
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

        records = feat_df.to_dict(orient="records") if not feat_df.empty else []
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
#  POST /plot/raw                                                 #
# ============================================================== #

@router.post("/plot/raw")
async def plot_raw(
    file: UploadFile = File(...),
    channels: str = Form(""),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    annotation_filter: str = Form(""),
):
    loader = EEGLoader()
    try:
        _load_uploaded_file(loader, file)
        ch_list = _parse_csv_list(channels) or loader.channel_names[:8]
        times, data, used = _slice_times(loader, t_start, t_dur, ch_list)
        allowed = _parse_csv_list(annotation_filter)
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed)
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
async def plot_filtered(
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
        allowed = _parse_csv_list(annotation_filter)
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed)
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
async def plot_subband(
    file: UploadFile = File(...),
    channel: str = Form(...),
    t_start: float = Form(0.0),
    t_dur: float = Form(5.0),
    subbands: str = Form("delta,theta,alpha,beta,gamma"),
    annotation_filter: str = Form(""),
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

        allowed = _parse_csv_list(annotation_filter)
        anns = _annotations_in_window(loader, t_start, t_start + t_dur, allowed)
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
async def plot_ica(
    file: UploadFile = File(...),
    bp_low: float = Form(0.5),
    bp_high: float = Form(49.0),
    bp_order: int = Form(5),
    ica_method: str = Form("fastica"),
    ica_n: Optional[int] = Form(None),
    t_dur: float = Form(5.0),
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
        n_take = min(int(t_dur * sfreq), loader.raw.n_times)
        data = loader.raw.get_data(start=0, stop=n_take) * 1e6
        times = np.arange(n_take) / sfreq

        fig = go.Figure()
        n_ch = data.shape[0]
        spread = float(np.std(data) * 6 + 1e-6)
        for i in range(n_ch):
            fig.add_trace(go.Scatter(
                x=times.tolist(),
                y=(data[i] - i * spread).tolist(),
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
        )
        return JSONResponse(content={
            "figure": json.loads(fig.to_json()),
            "n_components": n_ch,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("plot_ica failed")
        raise HTTPException(status_code=422, detail=str(e))
