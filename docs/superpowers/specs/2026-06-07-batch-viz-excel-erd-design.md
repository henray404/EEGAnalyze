# Design: Subband Plot Restrict, Excel Format + Encode, Batch ERD/Feature Chunk Chart

**Tanggal:** 2026-06-07
**Status:** Draft (menunggu review user)

Empat perubahan independen. Dikerjakan hati-hati agar tidak konflik dengan
fitur existing. Bug chunk 0.33 sudah dinyatakan aman oleh user, tidak masuk
scope.

---

## 1. Subband Plot: batasi pilihan ke channel + subband terpilih

**Masalah:** `SubbandTab` di `frontend_v2/src/pages/single-file.jsx` (~line 895)
menampilkan dropdown channel dari `allChannels` (SEMUA channel file). User mau
hanya channel + subband yang sudah dipilih di analisa utama yang muncul.

**Perubahan (frontend-only):**
- Sumber dropdown channel: `allChannels` -> `selectedChannels`.
- Opsi subband: hanya subband yang dipilih user (state subband terpilih), bukan
  semua subband.
- Fallback: jika `selectedChannels` kosong, pakai `allChannels` (hindari
  dropdown kosong). Jika subband terpilih kosong, pakai semua subband.
- Backend `/api/single/plot/subband` TIDAK berubah (tetap terima `channel`
  tunggal + list subband).

**Tidak mengubah:** model pemilihan tetap 1 channel di-plot (dropdown), bukan
multi-channel. Hanya isi opsi yang dibatasi.

---

## 2 + 3. Excel: format 6 desimal, chunk/encoded integer, raw + encode satu tabel

**File:** `backend/app/routers/export.py`, `backend/app/routers/batch.py`.

### 2a. Number format (export.py `_write_sheet`)
Ganti aturan format saat ini (`0.000000E+00` scientific untuk semua non-meta
numerik) menjadi berbasis tipe nilai:
- `bool` -> biarkan (tampil TRUE/FALSE).
- `int` -> `number_format = "0"` (integer polos: chunk, window_idx, *_encoded,
  chunk_from, chunk_to).
- `float` -> `number_format = "0.000000"` (6 desimal fixed), nilai di-`round(v, 6)`.
- kolom meta (string) -> tanpa format.

Hapus penggunaan `_META_COLS` untuk menentukan scientific; cukup dispatch by
type. `_META_COLS` boleh tetap ada hanya untuk skip alignment/format kosmetik
jika perlu, tapi logic angka murni by-type.

Edge case diketahui: nilai feature float yang kebetulan bulat (mis. `0.0`) bisa
ter-serialize jadi `int` lewat JSON round-trip dan terformat `"0"`. Dampak
kosmetik kecil, diterima.

### 2b. Encode digabung ke records chunk (batch.py `_process_one_file`)
Saat ini encode hanya diemit sebagai `encoding_records` ringkasan terpisah
(`summarize_chain_encoding`). Untuk excel "raw + encode satu tabel":

- Di `_process_one_file`, mode chunk: setelah `feat_df` dibuat dan sebelum
  `to_dict`, hitung kolom encoded per feature dan tempelkan ke `feat_df`.
- Logika encode reuse dari `ChunkingPipeline.compute_chain_encoding`
  (`chunking.py:337`): `encoded[i] = 1 if val[i] > val[i-1] else 0`, per grup
  `(task, channel, subband)`, urut by `chunk`.
- Tambah kolom `{feat}_encoded` (int) di tiap baris chunk. Chunk pertama tiap
  grup tidak punya pendahulu -> nilai `None`/kosong (NaN), tampil blank di excel.
- Hasil: tiap record chunk = `{meta, filename, task, channel, subband, chunk,
  mav, mav_encoded, variance, variance_encoded, std, std_encoded, ...}`.

Implementasi: helper baru di `ChunkingPipeline`, mis.
`attach_chunk_encoding(feat_df, features)` yang mengembalikan `feat_df` dengan
kolom `{feat}_encoded`. Dipakai di batch sebelum membentuk records.

**Tidak mengubah:** `encoding_records` ringkasan tetap ada (EncodingTab
existing tetap jalan). Kolom encoded baru hanya tambahan di `records`.

### 3a. Frontend export
`recordsToScenarioSheets` / export call di `batch.jsx` + `api.js` tidak perlu
logika baru: records sudah membawa kolom encoded, ikut ter-export otomatis.
Verifikasi urutan kolom (raw lalu encoded bersebelahan) ditentukan urutan key
di dict record backend -> susun `{feat}` diikuti `{feat}_encoded`.

---

## 4. Tab batch baru: chart chunk per kondisi (Feature / ERD%) dengan toggle

**Tujuan:** Untuk 1 ID, channel tertentu, subband tertentu, bandingkan nilai
antar chunk pada 2 kondisi (default Resting vs Thinking). Bar chart, X = chunk
index, 2 seri (per kondisi/task). Punya toggle mode:

- **Mode Feature** (frontend-only): Y = nilai feature chunk (MAV/Variance/STD)
  terpilih. Data dari `records` (chunk mode) yang sudah ada -> filter by ID +
  channel + subband + feature, group jadi 2 seri by `task`. Tidak perlu backend.
- **Mode ERD%** (perlu backend): Y = `erd_ers_pct` per chunk untuk masing-masing
  task sebagai target vs 1 baseline.

### 4a. Backend untuk Mode ERD% (jalur terpisah, anti-konflik)
ERD existing (`erd_records`, `erd_target_task` tunggal, BatchErdTab) TIDAK
disentuh. Tambah jalur baru opsional:

- Config form baru di `batch.py /process`: `erd_compare_enabled` (bool),
  `erd_compare_baseline` (str, default "Resting"), `erd_compare_tasks` (csv,
  default "Resting,Thinking").
- Di `_process_one_file`, jika `erd_compare_enabled` dan mode chunk: untuk tiap
  task di `erd_compare_tasks`, panggil `compute_erd_ers_paired_chunked(loader,
  df, channels, task, subbands, baseline_task=erd_compare_baseline,
  chunk_duration)`. Kumpulkan ke `out["erd_compare"]` dengan `{meta, filename,
  ...row}` (row punya task, channel, subband, chunk, erd_ers_pct).
- Aggregasi di `event_generator`: tambah `erd_compare_records` di payload result.
- `out` dict tambah key `"erd_compare": []`.

### 4b. Frontend (`batch.jsx` + `api.js`)
- `api.js batchProcessStream` opts: tambahkan field config baru ke form data.
- Tab baru, mis. `chunk-compare` / "Chunk Kondisi", ditambah ke daftar tab
  (sekitar line 540-551) dan render switch.
- Komponen `ChunkCompareTab`:
  - Toggle mode: Feature | ERD%.
  - Selector: ID (subject/scenario/filename), channel (single), subband
    (single), feature (single, hanya relevan mode Feature), 2 task/kondisi
    (default Resting, Thinking).
  - Mode Feature: ambil dari `records`, filter, plot.
  - Mode ERD%: ambil dari `erd_compare_records` (perlu `erd_compare_enabled`
    diaktifkan saat process). Jika kosong, tampilkan hint aktifkan opsi.
  - Plotly grouped bar: X = chunk index, 2 trace (warna palette: accent
    `#5B65DC` + secondary), legend per kondisi.
- Tambah toggle UI "Aktifkan ERD Compare" di panel config supaya backend
  menghitung `erd_compare_records` (default off, hemat compute).

---

## Urutan implementasi (dependency)
1. (FE) Subband plot restrict — isolated, paling kecil.
2. (BE) export.py number format + by-type.
3. (BE) ChunkingPipeline.attach_chunk_encoding + wire di batch.py records.
4. (BE) erd_compare path di batch.py.
5. (FE) ChunkCompareTab + api.js config + config toggle.

Item 1-2 tidak saling tergantung. 3 sebelum verifikasi excel. 4 sebelum 5
(mode ERD%). Mode Feature (5) tidak tergantung 4.

## Risiko / catatan konflik
- File `chunking.py`, `batch.py`, `single_file.py`, `api.js`, `batch.jsx`,
  `single-file.jsx` punya perubahan uncommitted existing (git status M).
  Implementasi harus baca state terkini tiap file sebelum edit, hindari
  menimpa perubahan yang belum di-commit.
- ERD compare jangan mengubah signature/behaviour ERD existing.
- Encode chunk pertama = blank, pastikan tidak bikin NaN error di excel writer
  (openpyxl terima None).

## Testing
- Backend belum ada test framework (per CLAUDE.md). Verifikasi manual:
  jalankan batch chunk mode, cek records punya `{feat}_encoded`, download excel
  cek 6 desimal + chunk integer + kolom encoded bersebelahan.
- ERD compare: aktifkan, cek `erd_compare_records` muncul, chart 2 seri.
- Subband plot: pilih subset channel+subband, buka SubbandTab, cek dropdown.
- Catat sesi debugging (jika ada) ke `docs/bugs/` per aturan CLAUDE.md.
