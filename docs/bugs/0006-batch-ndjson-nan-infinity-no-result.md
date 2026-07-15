# 0006: Batch process gagal "Tidak ada hasil dari server" karena NaN/Infinity di NDJSON

**Tanggal ditemukan:** 2026-06-12
**Status:** resolved
**Komponen:** backend
**Severity:** high

---

## Gejala

Upload ZIP recoveriX asli ke halaman Batch, klik "Proses Batch". Backend log
menunjukkan request sukses:

```
INFO:     127.0.0.1:62853 - "POST /api/batch/process HTTP/1.1" 200 OK
```

Tetapi frontend menampilkan:

```
Error: Tidak ada hasil dari server
```

Tidak ada traceback di backend (request 200 OK). Data sintetik di test suite
lolos tanpa masalah; hanya data EEG asli yang memicu error.

## Cara Reproduksi

1. Jalankan backend + frontend.
2. Upload ZIP recoveriX asli (data hasil rekaman device).
3. Klik "Proses Batch".
4. Hasilnya: backend balas 200 OK, tapi UI bilang "Tidak ada hasil dari server".

## Root Cause

Endpoint streaming NDJSON memakai `json.dumps` stdlib. Untuk float non-finite,
`json.dumps` mengeluarkan token `NaN` / `Infinity` / `-Infinity` yang **bukan
JSON valid** (spec JSON tidak mengenal token tersebut).

Data EEG asli menghasilkan nilai non-finite di sebagian fitur (mis. power
baseline 0 lalu dipakai sebagai pembagi pada ERD, atau variance/relative power
yang menghasilkan NaN). Saat event `{"type":"result", ...}` berisi `NaN`, baris
NDJSON-nya jadi JSON invalid.

Di `frontend_v2/src/api.js` `batchProcessStream`, parser baris memakai:

```js
try { evt = JSON.parse(s); } catch { return; }
```

Baris result yang invalid dilempar diam-diam (`catch { return; }`), sehingga
`result` tetap `null`, dan di akhir:

```js
if (!result) throw new Error('Tidak ada hasil dari server');
```

Karena itu request sukses (200, stream terkirim penuh) tapi UI tidak pernah
menerima hasil. Data sintetik test tidak punya NaN/Inf sehingga tidak terdeteksi.

## Solusi

Sanitize semua payload sebelum `json.dumps` di `batch.py`: ubah float non-finite
jadi `null` secara rekursif. Semua `yield json.dumps(...)` pada generator
streaming (EDF dan recoveriX) diganti `yield _jdump(...)`.

```python
import math

def _sanitize(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(v) for v in o]
    return o

def _jdump(obj):
    return json.dumps(_sanitize(obj))
```

Catatan: `np.float64` adalah subclass `float`, jadi `isinstance(x, float)`
menangkapnya. NaN/Inf dari numpy juga ikut dibersihkan.

## File yang Berubah

- `backend/app/routers/batch.py` — tambah `import math`, helper `_sanitize` /
  `_jdump`, ganti 8 call site `yield json.dumps(...)` -> `yield _jdump(...)`.

## Verifikasi

- `python -m pytest -q` -> 35 passed.
- `_jdump({'a': float('nan'), 'b': float('inf'), 'c': 1.5})` ->
  `{"a": null, "b": null, "c": 1.5}` (valid JSON, parse di browser sukses).
- Manual: proses ZIP recoveriX asli -> event result diterima, tabel fitur/ERD muncul.

## Catatan Tambahan

- Pelajaran: jangan pernah kirim `json.dumps` mentah lewat HTTP untuk data
  numerik float; selalu pertimbangkan NaN/Inf. Alternatif lain: `json.dumps(obj,
  allow_nan=False)` (raise, bukan diam) atau encoder kustom.
- Pattern serupa yang harus diwaspadai: endpoint lain yang serialize hasil
  numpy/pandas (mis. single_file ERD, export). Cek apakah mereka juga rawan.
- Frontend `api.js` menelan error parse diam-diam (`catch { return; }`); ini
  menyembunyikan root cause. Pertimbangkan log warning saat baris gagal di-parse.
