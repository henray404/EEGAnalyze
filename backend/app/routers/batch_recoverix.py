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
