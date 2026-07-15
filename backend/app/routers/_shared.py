"""
Helper bersama antar router (single_file, batch, ml).

Sebelumnya di-copy-paste identik di kedua router; disatukan di sini supaya
perubahan mapping subband/fitur tidak perlu diedit dua tempat.

Berisi juga infra streaming NDJSON (ProgressEmitter + ndjson_job) supaya semua
endpoint bisa kirim log + progres real-time ke frontend, bukan cuma balikin 1
JSON di akhir.
"""

import asyncio
import json
import logging
import math

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.config import DEFAULT_SUBBANDS

logger = logging.getLogger(__name__)

_SUBBAND_MAP = {
    "delta": "Delta", "theta": "Theta", "mu": "Mu",
    "alpha": "Alpha", "low_beta": "Low_Beta",
    "beta": "Beta", "high_beta": "High_Beta", "gamma": "Gamma",
}


def to_bool(s) -> bool:
    return str(s).lower() == "true"


def parse_csv_list(s: str) -> list:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def resolve_subbands(ids_str: str) -> dict:
    ids = [s.strip().lower() for s in ids_str.split(",") if s.strip()]
    return {
        _SUBBAND_MAP[i]: DEFAULT_SUBBANDS[_SUBBAND_MAP[i]]
        for i in ids
        if i in _SUBBAND_MAP and _SUBBAND_MAP[i] in DEFAULT_SUBBANDS
    } or dict(DEFAULT_SUBBANDS)


def resolve_features(feats_str: str) -> list:
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


def resolve_nth_occurrence(loader, tasks, occurrence_index: int) -> set:
    """Resolve occurrence ke-N (1-based) tiap task jadi set (task, occ_num).

    Dipakai batch processing supaya semua file diproses dengan aturan yang
    sama ("occurrence pertama tiap task", "occurrence kedua", dst) meski
    posisi/onset occurrence beda-beda per file. Task yang jumlah
    occurrence-nya kurang dari occurrence_index dilewati (tidak ikut
    diproses untuk file itu).
    """
    by_task: dict = {}
    for occ in loader.get_task_occurrences():
        by_task.setdefault(occ["task"], []).append(occ["occurrence"])

    selected = set()
    for t in tasks:
        occs = sorted(by_task.get(t, []))
        if occurrence_index >= 1 and len(occs) >= occurrence_index:
            selected.add((t, occs[occurrence_index - 1]))
    return selected


# ================================================================== #
#  Streaming NDJSON: progres + log real-time                          #
# ================================================================== #

def _sanitize(o):
    """Ubah NaN/Infinity (float non-finite) jadi None secara rekursif.

    json.dumps stdlib emit token `NaN`/`Infinity` yang BUKAN JSON valid,
    sehingga JSON.parse di browser gagal dan event kebuang diam-diam. Data EEG
    asli bisa hasilkan NaN/Inf (mis. power 0 -> pembagian), jadi semua payload
    dibersihkan dulu.
    """
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(v) for v in o]
    return o


def _jdump(obj) -> str:
    """Serialize ke JSON aman (NaN/Inf -> null), satu baris NDJSON."""
    return json.dumps(_sanitize(obj))


class ProgressEmitter:
    """Emit event log/progress dari job sync ke stream NDJSON.

    Dibuat oleh ndjson_job dan dilempar ke fungsi job. Job memanggil
    .log()/.progress()/.step() dari thread worker; event dikirim thread-safe
    ke event loop lewat call_soon_threadsafe. Kalau dipakai tanpa loop (mis.
    fallback serial atau unit test), event cuma di-log dan diabaikan.
    """

    def __init__(self, loop=None, queue=None):
        self._loop = loop
        self._queue = queue
        self._done = 0
        self._total = 0

    def _emit(self, item):
        if self._loop is None or self._queue is None:
            return
        self._loop.call_soon_threadsafe(self._queue.put_nowait, item)

    def log(self, message, level="info"):
        """Kirim satu baris log teks ke panel progres frontend."""
        self._emit({"type": "log", "level": level, "message": str(message)})

    def progress(self, done=None, total=None, message=None):
        """Set/kirim progres numerik (bar). message opsional -> juga jadi log."""
        if total is not None:
            self._total = total
        if done is not None:
            self._done = done
        evt = {"type": "progress", "processed": self._done, "total": self._total}
        if message is not None:
            evt["message"] = str(message)
        self._emit(evt)

    def step(self, message=None):
        """Naikkan progres 1 langkah, opsional dengan pesan log."""
        self._done += 1
        self.progress(message=message)


def ndjson_job(job):
    """Bungkus fungsi job sync CPU-heavy jadi StreamingResponse NDJSON.

    job(emit) dijalankan di threadpool (biar tidak blok event loop). Selama
    jalan, job kirim event lewat `emit` (ProgressEmitter). Di akhir:
      - sukses -> {"type":"result", ...payload}   (payload = return value job, dict)
      - HTTPException di dalam job -> {"type":"error","detail":..,"status":..}
      - Exception lain -> {"type":"error","detail":str(e)}
    Frontend (api.js streamJob) yang parse event-event ini.
    """
    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        emit = ProgressEmitter(loop, queue)
        holder = {}

        def _run():
            try:
                holder["result"] = job(emit)
            except HTTPException as e:
                holder["http"] = e
            except Exception as e:  # noqa: BLE001 - dilaporkan ke client
                logger.exception("ndjson_job gagal")
                holder["error"] = str(e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "_done"})

        loop.run_in_executor(None, _run)

        while True:
            item = await queue.get()
            if item.get("type") == "_done":
                break
            yield _jdump(item) + "\n"

        if "http" in holder:
            he = holder["http"]
            yield _jdump({"type": "error", "detail": he.detail, "status": he.status_code}) + "\n"
        elif "error" in holder:
            yield _jdump({"type": "error", "detail": holder["error"]}) + "\n"
        else:
            payload = holder.get("result") or {}
            yield _jdump({"type": "result", **payload}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")
