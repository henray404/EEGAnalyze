# 0012: Tempfile .edf bocor tiap request (tidak pernah dibersihkan)

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** backend
**Severity:** critical

---

## Gejala

Setiap upload/process/erd/plot menulis file `.edf` ke direktori temp OS dan tidak pernah menghapusnya. Untuk deploy publik, disk terisi terus sampai penuh dan service crash.

## Cara Reproduksi

1. Kirim beberapa request ke `/single/upload` atau `/single/process` (atau proses batch ZIP).
2. Cek direktori temp OS: file `tmp*.edf` menumpuk, tidak berkurang.

## Root Cause

`EEGLoader.load_edf`/`load_edf_from_zip` menulis byte upload ke `NamedTemporaryFile(delete=False)` dan menyimpan path di `self._tmp_path`. `_cleanup_tmp()` hanya dipanggil di AWAL load berikutnya pada instance loader yang sama. Tapi tiap router bikin `EEGLoader()` baru per request dan tidak pernah memanggil cleanup, serta tidak ada destructor -> tempfile bocor permanen.

## Solusi

Tambah `__del__` di `EEGLoader` yang memanggil `_cleanup_tmp()`. Tiap loader adalah variabel lokal per-request, jadi di-GC saat handler selesai -> tempfile dibersihkan.

```python
def __del__(self):
    try:
        self._cleanup_tmp()
    except Exception:
        pass
```

## File yang Berubah

- `backend/app/processing/loader.py:46-55` (`__del__`)

## Verifikasi

Manual: proses beberapa file, pantau folder temp OS — jumlah `tmp*.edf` tidak tumbuh setelah GC.

## Catatan Tambahan

- `__del__` tidak deterministik (bergantung GC). Kalau butuh jaminan langsung (throughput tinggi / worker long-lived), tambahkan `try/finally: loader._cleanup_tmp()` eksplisit di tiap handler router atau jadikan `EEGLoader` context manager. Ditandai `ponytail:` di kode.
- Ditemukan lewat QA audit 2026-07-01 (agent routers).
