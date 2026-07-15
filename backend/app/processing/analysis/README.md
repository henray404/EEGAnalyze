# processing/analysis

Analisis statistik & lintas-task/lintas-grup (ALS vs Normal).

**Belum di-wire ke router manapun** -- sama seperti `timefreq/`, ini
kemungkinan port dari `web/` (Streamlit) yang belum diintegrasi ke endpoint
FastAPI manapun.

## Isi

- `delta.py` -- `DeltaCalculator`. Hitung delta fitur antar task (Task A -
  Task B).
- `statistics.py` -- `StatisticalTests`. Mann-Whitney U, t-test, Cohen's d,
  koreksi FDR.
- `connectivity.py` -- `ConnectivityAnalyzer`. Konektivitas fungsional
  (PLI / wPLI) antar channel.
- `comparison.py` -- Fungsi-fungsi perbandingan chain sequence antar subjek
  (`compare_all_pairs`, `find_consecutive_matches`, dkk). Tidak ada class,
  murni module-level function.

## Dipakai oleh

Tidak ada router saat ini.