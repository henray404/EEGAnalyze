# 0003: Frontend tidak dapat terhubung ke backend — CORS blocked + Python typing error

**Tanggal ditemukan:** 2026-05-13
**Status:** resolved
**Komponen:** backend
**Severity:** high

---

## Gejala

Frontend menampilkan pesan error:

```
Tidak dapat terhubung ke backend. Pastikan uvicorn berjalan di port 8000.
```

Error muncul pada semua operasi yang memanggil API (upload EDF, scan ZIP, proses batch, export Excel). Backend mungkin sudah berjalan, tetapi browser tetap memblokir request.

## Cara Reproduksi

**Skenario 1 (CORS):**
1. Buka `frontend/index.html` via `file://` (double-click) atau port selain 5173/3000
2. Upload file EDF atau ZIP
3. Error langsung muncul di panel

**Skenario 2 (startup error):**
1. Backend di Python 3.8
2. Jalankan `uvicorn app.main:app`
3. Startup crash dengan `TypeError: 'type' object is not subscriptable`

## Root Cause

**Penyebab 1 — CORS terlalu strict:**

`main.py` hanya mengizinkan dua origin:
```python
allow_origins=["http://localhost:5173", "http://localhost:3000"]
```

Request dari origin lain (file://, VS Code Live Server, port berbeda) langsung diblokir browser sebelum sampai ke server. Browser melaporkan ini sebagai network error, bukan CORS error — sehingga terlihat seperti backend tidak berjalan padahal sebenarnya berjalan.

**Penyebab 2 — Python 3.8 incompatible typing:**

`export.py` menggunakan built-in generics syntax:
```python
records: list[dict[str, Any]]   # Python 3.9+ only
sheets: list[SheetSpec]
```

Pada Python 3.8, ini menyebabkan `TypeError: 'type' object is not subscriptable` saat uvicorn mencoba import modul, sehingga server tidak bisa start sama sekali.

**Penyebab 3 — openpyxl belum terinstall:**

`export.py` mengimport `openpyxl` yang baru ditambahkan ke `requirements.txt`. Jika `pip install -r requirements.txt` belum dijalankan ulang, import error menyebabkan seluruh aplikasi gagal start.

## Solusi

**Fix 1 — CORS:**

```python
# main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,   # harus False jika allow_origins="*"
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Fix 2 — Python typing compatibility:**

```python
# export.py
from typing import Any, List, Dict

class SheetSpec(BaseModel):
    name: str
    records: List[Dict[str, Any]]

class ExcelRequest(BaseModel):
    sheets: List[SheetSpec]
    filename: str = "batch_results"
```

**Fix 3 — Install openpyxl:**

```powershell
cd backend
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## File yang Berubah

- `backend/app/main.py` — CORS `allow_origins` dari list spesifik ke `["*"]`, `allow_credentials=False`
- `backend/app/routers/export.py` — typing dari `list[dict]` ke `List[Dict]`
- `backend/requirements.txt` — tambah `openpyxl==3.1.2`

## Verifikasi

1. Jalankan `uvicorn app.main:app --reload --port 8000` dari folder `backend/`
2. Buka `http://localhost:8000/health` di browser — harus return `{"status": "ok"}`
3. Buka frontend dari manapun (file://, live server, port berapapun)
4. Upload EDF — tidak ada error koneksi

## Catatan Tambahan

- `allow_credentials=False` wajib jika `allow_origins=["*"]`. FastAPI raise error jika keduanya diset sekaligus.
- Untuk production, ganti kembali `allow_origins` ke daftar domain spesifik.
- Python minimum yang disarankan adalah 3.10 karena MNE mensyaratkannya.
