# 0008: Subband Delta selalu NaN karena bandpass (b,a) tidak stabil di freq rendah

**Tanggal ditemukan:** 2026-06-12
**Status:** resolved
**Komponen:** backend
**Severity:** medium

---

## Gejala

Di hasil batch (dan single file), kolom fitur untuk subband **Delta** selalu
kosong (`-` / NaN), sedangkan Theta/Alpha/Beta normal. Pada data recoveriX
asli: 32 dari 128 record NaN, tepat semua record Delta (16 channel x 2 task).

User mengira data tidak mengandung Delta. Padahal recoveriX merekam HP 0.5 Hz,
jadi konten Delta (0.5-4 Hz) ada.

## Cara Reproduksi

1. Proses batch ZIP recoveriX asli dengan subband Delta aktif.
2. Lihat kolom mav/variance/std untuk subband Delta.
3. Hasilnya: semua NaN/`-`.

## Root Cause

`_bandpass_array` di `features.py` membentuk filter Butterworth lewat transfer
function `(b, a)`:

```python
b, a = butter(order, [low_n, high_n], btype="band")  # order=5
return filtfilt(b, a, data)
```

Untuk Delta (0.5-4 Hz) pada sfreq 250: `nyq=125`, `low_n=0.004`,
`high_n=0.032`. Butterworth order-5 bandpass dengan frekuensi normalized
sangat kecil menghasilkan koefisien `(b, a)` yang ill-conditioned (akar
polinomial sangat dekat unit circle). `filtfilt` lalu menghasilkan NaN.

Subband lain (Theta 0.032-0.064, Alpha, Beta) freq normalized lebih besar,
sehingga stabil.

## Solusi

Pakai second-order sections (SOS) + `sosfiltfilt`, yang jauh lebih stabil
secara numerik untuk filter order tinggi / freq rendah:

```python
from scipy.signal import butter, sosfiltfilt

sos = butter(order, [low_n, high_n], btype="band", output="sos")
min_len = 3 * (2 * len(sos) + 1)
if len(data) < min_len:
    return np.zeros_like(data)
return sosfiltfilt(sos, data)
```

## File yang Berubah

- `backend/app/processing/features.py` — `_bandpass_array` ganti (b,a)/filtfilt
  -> SOS/sosfiltfilt; import `filtfilt` dihapus, `sosfiltfilt` ditambah.

## Verifikasi

- `python -m pytest -q` -> 35 passed.
- Data recoveriX asli: NaN mav 0/128 (sebelumnya 32/128). Delta mav ~1.2e-8
  (nilai valid).

## Catatan Tambahan

- Best practice: untuk IIR + filtfilt selalu pakai `output="sos"` +
  `sosfiltfilt`, terutama band rendah relatif terhadap nyquist.
- Pattern serupa untuk diaudit: filter lain yang masih pakai `(b,a)` +
  `filtfilt` (cek `filters.py` / pipeline bandpass utama).
- Menutup catatan terbuka di bug 0007 (Delta NaN). Bug 0007 (deteksi kolom
  fitur cuma cek records[0]) tetap valid sebagai pertahanan robust.
