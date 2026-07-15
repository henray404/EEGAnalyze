# 0009: relative_power mode chunk hampir selalu ~1 (pembagi salah)

**Tanggal ditemukan:** 2026-06-21
**Status:** resolved
**Komponen:** backend
**Severity:** high

---

## Gejala

Di batch analysis mode chunk (default), kolom `relative_power` untuk semua
subband bernilai mendekati 1.0. Tidak mencerminkan porsi power subband
terhadap total power. Mode Full (single-file) tidak kena masalah ini.

Ditemukan saat menjawab pertanyaan dosen "PSD-nya pakai formula yang mana",
ketika menelusuri ada dua jalur perhitungan PSD yang berbeda di kode.

## Cara Reproduksi

1. Batch analysis, mode ekstraksi `chunk` (default), pilih fitur
   `relative_power`.
2. Lihat hasil per chunk per subband.
3. Hasilnya: relative_power tiap subband ~1.0; jumlah lintas subband jauh
   melebihi 1 (mestinya <= 1).

## Root Cause

Di `chunking.py`, fitur frequency-domain dihitung dari sinyal yang SUDAH
di-bandpass ke subband:

```python
filtered = _bandpass_array(chunk_signal, sfreq, low, high)  # sinyal -> subband saja
relative_power = compute_relative_power(filtered, sfreq, low, high)
```

`compute_relative_power` (`features.py`) menghitung
`band_power / total_power` dengan `total_power = sum(|FFT(filtered)|^2)`.
Karena `filtered` cuma berisi energi di [low, high], maka `total_power`
praktis sama dengan `band_power`, sehingga rasio selalu ~1.

Akar lebih dalam: ada DUA formula PSD di codebase yang dipakai tergantung
mode:
- Mode Full: `PSDAnalyzer.compute_band_power_from_psd` (Welch + integral
  trapezoid, total = integral seluruh 0-49.5 Hz). Benar.
- Mode Chunk: `EEGFeatures.compute_band_power/relative/peak` (periodogram
  FFT atas sinyal yang sudah disaring per subband). relative_power rusak,
  dan band_power = mean (bukan integral) sehingga skalanya beda dari mode
  Full.

## Solusi

Hitung ke-3 fitur frekuensi per chunk SEKALI via Welch PSD atas chunk
MENTAH (bukan per-subband filtered), pakai
`PSDAnalyzer.compute_band_power_from_psd` yang sama dengan mode Full. Ini
sekaligus menyeragamkan formula kedua mode. Fitur time-domain
(mav/variance/std) tetap dari sinyal subband-filtered.

```diff
-    for sb_name, (low, high) in subband_items:
-        filtered = _bandpass_array(chunk_signal, sfreq, low, high)
-        ...
-        row[feat] = _compute_feature(feat, filtered, sfreq, low, high)
+    if want_freq:
+        psds, freqs = PSDAnalyzer.compute_psd_array(
+            chunk_signal, sfreq, method="welch", fmin=0.0, fmax=sfreq/2.0)
+        bp_df = PSDAnalyzer.compute_band_power_from_psd(
+            psds, freqs, ["_"], subbands_dict)
+        ...derive band_power/relative_power/peak_frequency per subband...
+    # time-domain tetap dari sinyal subband-filtered
```

`_compute_feature` diganti `_compute_time_feature` (time-domain saja).
Import `EEGFeatures` dihapus (tak lagi dipakai), import `PSDAnalyzer`
ditambah.

## File yang Berubah

- `backend/app/processing/chunking.py:46` (import PSDAnalyzer, hapus EEGFeatures)
- `backend/app/processing/chunking.py:_chunk_unit_rows` (PSD Welch per chunk)
- `backend/app/processing/chunking.py:_compute_time_feature` (eks `_compute_feature`)

## Verifikasi

Self-check sinyal sintetik (alpha 10Hz kuat, beta 20Hz lemah, 4s @256Hz,
chunk 0.5s):

```
subband  band_power  relative_power  peak_frequency
  Alpha    3.746075        0.809186            10.0
   Beta    0.128559        0.027770            20.0
sum relative_power chunk0 = 0.9171   (sebelumnya ~5)
```

relative_power Alpha > Beta, jumlah lintas subband < 1, peak_freq Alpha =
10 Hz. Import router (`batch`, `single_file`) OK.

## Catatan Tambahan

- Konsekuensi: angka `band_power` dan `relative_power` hasil chunk lama
  BERUBAH (sebelumnya periodogram mean / rasio rusak; sekarang Welch
  integral / rasio benar). mav/variance/std tetap.
- Jumlah relative_power lintas subband < 1 itu wajar: subband tidak menutup
  seluruh 0-Nyquist (ada celah 49-128 Hz), jadi sisa power tak masuk band
  mana pun.
- Pattern diwaspadai: jangan hitung relative power dari sinyal yang sudah
  difilter ke band target; pembagi (total power) harus dari sinyal penuh.
- `EEGFeatures.compute_band_power/relative_power/peak_frequency` (FFT) masih
  dipakai di jalur ERD/delta. Pertimbangkan menyeragamkan ke Welch juga jika
  konsistensi lintas-fitur diperlukan.
