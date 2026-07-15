# 0007: Tab batch (Chart/Tabel/Heatmap/Scatter) bilang "tidak ada fitur" padahal ada

**Tanggal ditemukan:** 2026-06-12
**Status:** resolved
**Komponen:** frontend
**Severity:** medium

---

## Gejala

Setelah proses batch recoveriX sukses (record muncul di Data Table), tab
Chart/Tabel/Heatmap/Scatter menampilkan:

```
Belum ada fitur
Tidak ada kolom fitur numerik atau subband di hasil batch.
```

## Cara Reproduksi

1. Upload ZIP recoveriX asli (folder `ltk-...`), proses batch.
2. Buka tab Chart (atau Tabel/Heatmap/Scatter).
3. Hasilnya: pesan "Belum ada fitur" meski record fitur ada.

## Root Cause

`_detectFeatureCols` di `batch-tabs.jsx` hanya memeriksa `records[0]`:

```js
const first = records[0];
return Object.keys(first).filter(k => !exclude.has(k) && typeof first[k] === 'number');
```

Data recoveriX asli menghasilkan NaN untuk seluruh subband Delta (filter
bandpass 0.5-4 Hz gagal di segmen motor imagery; 32/128 record NaN). Backend
men-sanitize NaN jadi `null` (lihat bug 0006). Record pertama kebetulan
`Left / FC3 / Delta` dengan `mav = null`. Karena `typeof null !== 'number'`,
tidak ada kolom fitur terdeteksi -> `featureCols.length === 0` -> tab kosong,
walau record Theta/Alpha/Beta punya nilai numerik valid.

## Solusi

Scan beberapa record (sampai 200), bukan cuma `records[0]`, dan abaikan NaN.
Tambah meta recoveriX ke daftar exclude (session, event, run, run_date, dst).

```js
const sampleN = Math.min(records.length, 200);
const cols = []; const seen = new Set();
for (let i = 0; i < sampleN; i++) {
  const rec = records[i]; if (!rec) continue;
  for (const k of Object.keys(rec)) {
    if (seen.has(k) || exclude.has(k)) continue;
    const v = rec[k];
    if (typeof v === 'number' && !Number.isNaN(v)) { seen.add(k); cols.push(k); }
  }
}
return cols;
```

## File yang Berubah

- `frontend_v2/src/pages/batch-tabs.jsx` — `_detectFeatureCols` scan multi-record + exclude meta recoveriX.

## Verifikasi

- Proses ulang ZIP recoveriX asli -> tab Chart/Tabel/Heatmap/Scatter render
  (mav/variance/std terdeteksi dari subband non-Delta).

## Catatan Tambahan

- Akar lebih dalam yang BELUM diperbaiki: subband **Delta** menghasilkan NaN
  pada data recoveriX (32/128 record). Kemungkinan filter IIR 0.5-4 Hz tidak
  stabil di segmen pendek. Perlu diselidiki terpisah (cek
  `EEGFeatures.compute_subband_features` / filter subband). Untuk sekarang
  kolom Delta tampil kosong ('-'), subband lain normal.
- Terkait bug 0006 (NaN/Infinity di NDJSON). Dua bug ini muncul dari data EEG
  asli yang menghasilkan NaN; data sintetik test tidak mengeksposnya.
