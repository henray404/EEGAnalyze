# Real-time Loading + Progress Log (semua endpoint)

## Context
Loading di web ini campur: batch udah real (NDJSON stream, bar file N/M), tapi
**ML training bar-nya PALSU** (`ml-stages-3-5.jsx:214` pakai `Math.random()` ticker
ke 92%), **single-file /process statis** ("Memproses fitur..." tanpa progres),
dan upload/plot cuma spinner. User minta SEMUA loading real-time + log teks
streaming + progress bar nyata.

Pola bagus udah ada: `batch.py` stream NDJSON event `{type:progress|result|error}`,
di-consume `api.js:103 batchProcessStream`. Tinggal generalize + tambah `{type:log}`.

## Arsitektur (infra shared, biar per-endpoint murah)

### Backend — `app/routers/_shared.py`
- Pindahkan `_sanitize` / `_jdump` dari `batch.py` ke `_shared.py` (dipakai bersama).
- `ProgressEmitter`: object dgn `.log(msg, level)`, `.progress(done,total,msg)`, `.step(msg)`.
  Push event ke asyncio.Queue via `loop.call_soon_threadsafe` (thread-safe).
- `ndjson_job(job)`: jalankan `job(emit)` (fungsi sync CPU-heavy) di threadpool,
  stream event log/progress selama jalan, `{type:result, ...payload}` di akhir,
  `{type:error, detail, status}` kalau gagal (HTTPException.detail lolos).
  Return `StreamingResponse` media `application/x-ndjson`.

### Frontend
- `api.js`: generalize jadi `streamJob(path, fields, {onLog, onProgress}, method)`.
  Parse event `log|progress|result|error`. `batchProcessStream` jadi thin wrapper.
  Tambah `streamJobJson` buat body JSON (ML train).
- Komponen baru `frontend_v2/src/components/progress-log.jsx` -> `window.ProgressLog`:
  panel log lines (auto-scroll) + progress bar nyata + persen. Register di `index.html`.

## Wiring per domain
1. **ML train** (`ml.py /train`): loop `for spec in req.models` udah ada -> emit
   per model (`Train SVM...`, `SVM: acc 0.82`). Bar = model i/N. Hapus fake ticker
   di `ml-stages-3-5.jsx`, pakai `<ProgressLog>`.
2. **Single-file /process** (`single_file.py`): baca bytes dulu (`await file.read()`),
   job stage log (load/filter/extract) + loop per-task buat sub-progress fitur.
   `single-file.jsx` handleProcess pakai streamJob + ProgressLog.
3. **Batch** (`batch.py`): tambah `{type:log}` di event_generator (per file selesai
   -> log nama file). `batch.jsx` tampilkan ProgressLog (bar udah ada).
4. **Quick** (single upload/plot/erd, ml upload/predict, batch scan): bungkus
   `ndjson_job`, 2-3 log line per stage. Frontend consume streamJob, spinner+log kecil.

## Files
- `backend/app/routers/_shared.py` (infra), `batch.py`, `single_file.py`, `ml.py`
- `frontend_v2/src/api.js`, `index.html`, `src/components/progress-log.jsx` (baru)
- `frontend_v2/src/pages/single-file.jsx`, `batch.jsx`, `ml-stages-3-5.jsx`

## Verifikasi
Jalanin backend (`uvicorn app.main:app --reload`) + buka frontend. Test tiap alur:
ML train (bar gerak per model, log muncul), single-file ekstrak fitur (log stage
+ per task), batch (log per file), upload/plot (log stage). Cek DevTools Network:
response `application/x-ndjson` streaming, bukan 1 JSON di akhir.
