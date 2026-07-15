# processing/timefreq

Time-frequency & trial-epoch analysis.

**Belum di-wire ke router manapun** -- kode ini ada (kemungkinan port dari
`web/` versi Streamlit lama) tapi belum ada endpoint FastAPI yang
memanggilnya. Cek `web/` (Streamlit) dulu kalau mau aktifkan salah satu fitur
di sini, sebelum menulis ulang dari nol.

## Isi

- `superlets.py` -- `SuperletTFR`. Time-frequency representation via
  superlet transform.
- `gamma_bursts.py` -- `GammaBurstDetector`. Deteksi gamma burst dengan MAD
  threshold.
- `epoching.py` -- `EpochEngine`. Epoching & sliding window per trial
  (lazy-import `EEGFeatures` di dalam method, bukan di top-level).
- `encoding.py` -- Pipeline yang menggabungkan `epoching` + `superlets` +
  `gamma_bursts` + `loader` jadi satu alur encoding.

## Dipakai oleh

Tidak ada router saat ini. `encoding.py` adalah satu-satunya konsumen
internal `epoching`/`superlets`/`gamma_bursts` di dalam sub-package ini.