# 0001: Dropzone memasukkan dummy data saat diklik, bukan membuka file picker

**Tanggal ditemukan:** 2026-05-12
**Status:** resolved
**Komponen:** frontend
**Severity:** high

---

## Gejala

Klik pada area dropzone di halaman Single File Analysis dan Batch Analysis langsung menampilkan file dummy tanpa membuka dialog file picker.

Single File: langsung menampilkan `subject_07_als_resting.edf (24.8 MB)`.
Batch: langsung menampilkan `eeg_dataset_v3.zip (486 MB)`.

Tidak ada interaksi dengan file system yang terjadi.

## Cara Reproduksi

1. Buka `frontend/index.html` di browser.
2. Navigasi ke halaman Single File Analysis atau Batch Analysis.
3. Klik area dropzone.
4. Hasilnya: file dummy langsung muncul tanpa file picker terbuka.

## Root Cause

`handleUpload` di kedua file dikodekan dengan data statis dan tidak menerima argumen:

```js
// SingleFile.jsx (sebelum fix)
const handleUpload = () => {
  setFile({ name: 'subject_07_als_resting.edf', size: '24.8 MB', meta: '16 channels · 256 Hz · 8.4 min' });
};

// Batch.jsx (sebelum fix)
const handleUpload = () => {
  setFile({ name: 'eeg_dataset_v3.zip', size: '486 MB', meta: '24 files · ALS/12 · Normal/12' });
};
```

Komponen `Dropzone` memanggil `onFile()` tanpa argumen pada `onClick` dan `onDrop`. Tidak ada `<input type="file">` sama sekali di kedua komponen — hanya placeholder UI tanpa implementasi nyata.

## Solusi

**SingleFile.jsx:**

1. Tambah `useRef` untuk hidden `<input type="file" accept=".edf">`.
2. `onClick` pada dropzone memanggil `inputRef.current.click()`.
3. `onDrop` membaca `e.dataTransfer.files[0]` dan meneruskannya ke `onFile(f)`.
4. `handleUpload(f)` sekarang menerima `File` object, menghitung size dari `f.size`, menyimpan `raw: f` untuk API call nanti.

**Batch.jsx:**

Pola yang sama dengan `accept=".zip"`. Karena dropzone Batch adalah inline JSX, `fileInputRef` dan `handleDrop` ditambahkan langsung di `BatchPage`.

## File yang Berubah

- `frontend/src/SingleFile.jsx:34-62` — komponen `Dropzone`, tambah hidden input + real event handlers
- `frontend/src/SingleFile.jsx:94-96` — `handleUpload` terima `File` object
- `frontend/src/Batch.jsx:72-74` — `handleUpload` terima `File` object, tambah `handleDrop` dan `fileInputRef`
- `frontend/src/Batch.jsx:106-112` — inline dropzone, ganti `onClick` ke `fileInputRef.current.click()`, tambah `onDrop`

## Verifikasi

1. Buka `frontend/index.html` via static server (`python -m http.server 5173`).
2. Klik dropzone di Single File page — dialog file picker OS harus terbuka dengan filter `.edf`.
3. Pilih file `.edf` asli — nama file dan ukuran asli harus tampil.
4. Drag & drop file `.edf` ke dropzone — harus diterima dan ditampilkan.
5. Ulangi untuk Batch page dengan file `.zip`.

## Catatan Tambahan

- `file.raw` menyimpan `File` object asli yang dibutuhkan saat integrasi ke backend (`POST /api/single/process` dan `POST /api/batch/process` via `FormData`).
- Chart setelah "Proses Data" masih menggunakan data generatif (`Math.random()`). Akan diganti saat integrasi backend.
- Backend integrasi belum dilakukan — `handleProcess` masih simulasi progress bar, belum memanggil API.
