# 0016: Plot Raw/Filtered/ICA kelihatan flat total setelah lonjakan di awal

**Tanggal ditemukan:** 2026-07-02
**Status:** resolved
**Komponen:** backend
**Severity:** medium

---

## Gejala

User melaporkan: saat load data dari `Data EEG Telematika 2023` (sesi OpenBCI TXT), plot sinyal (Raw Signal / Filtered / ICA Components) cuma menampilkan lonjakan besar di awal rekaman, sisanya kelihatan flat total meskipun secara fisik channel itu punya variasi sinyal yang wajar.

## Cara Reproduksi

1. Upload salah satu file TXT OpenBCI dari `Data EEG Telematika 2023/Bima/OpenBCISession_2023-10-16_14-17-57_ABDURR/OpenBCI-RAW-2023-10-16_14-20-04.txt`.
2. Buka tab Raw Signal / Filtered / ICA Components, plot beberapa channel sekaligus.
3. Hasilnya: cuma ada satu lonjakan besar di awal window, channel lain (T3, T4, T5, T6, O1) kelihatan seperti garis lurus meskipun datanya sebetulnya bervariasi ratusan-ribuan uV.

## Root Cause

`_signal_to_plotly_fig` (dipakai `/plot/raw` dan `/plot/filtered`) dan kode inline serupa di `/plot/ica` menghitung skala offset stacking antar-channel dengan:

```python
spread = float(np.std(data) * 6 + 1e-6)
```

`np.std(data)` dihitung dari array 2D (n_channel x n_time) yang di-flatten jadi satu array besar — artinya std ini bukan cuma menangkap variasi waktu tiap channel, tapi juga ikut menangkap SELISIH BASELINE/MEAN antar channel. Data OpenBCI TXT mentah (belum di-referensi) punya mean sangat berbeda antar channel (contoh terverifikasi dari file di atas: T3 mean -12129, T4 -6915, O1 -28444, O2 +187476 — O2 kebetulan channel yang railed/rusak secara hardware).

Terverifikasi dengan angka nyata dari file tsb:
- std global (flatten semua channel): **74,329 uV**
- rata-rata std per-channel (variasi asli tiap channel): **626 uV**
- rasio: **~119x lebih besar**

Karena `spread` dipakai sebagai skala offset vertikal antar channel dan channel juga TIDAK di-mean-center sebelum di-plot (langsung pakai `data[idx] + offset`, bukan `(data[idx]-mean) + offset`), sumbu-y jadi terpaksa mengakomodasi rentang total ratusan ribu uV padahal fluktuasi asli tiap channel cuma ratusan uV. Efeknya: fluktuasi asli jadi kelihatan flat karena skalanya kepencet oleh selisih baseline antar channel, bukan oleh amplitudo sinyal itu sendiri.

Root cause murni bug scaling di kode plotting, bukan masalah data (meskipun ditemukan juga masalah data terpisah, lihat Catatan Tambahan).

## Solusi

Ubah `_signal_to_plotly_fig` dan `plot_ica`:
1. Mean-center tiap channel dulu (`data - data.mean(axis=1, keepdims=True)`) sebelum di-offset-stack, supaya selisih baseline antar channel tidak ikut menentukan posisi/skala.
2. Hitung `spread` dari **median std per-channel** (`np.median(np.std(data, axis=1))`), bukan std dari array yang sudah di-flatten. Median (bukan mean) dipilih supaya satu channel yang rusak/railed (varians ekstrem) tidak ikut menarik skala channel lain.

```diff
- spread = float(np.std(data) * 6 + 1e-6)
+ per_ch_std = np.std(data, axis=1)
+ spread = float(np.median(per_ch_std) * 6 + 1e-6)
+ means = np.mean(data, axis=1, keepdims=True)
+ centered = data - means
  for idx, ch in enumerate(ch_names):
      offset = -idx * spread
      fig.add_trace(go.Scatter(
          x=times.tolist(),
-         y=(data[idx] + offset).tolist(),
+         y=(centered[idx] + offset).tolist(),
```

Perubahan sama diterapkan ke `plot_ica` (variabel component, bukan channel).

`plot_subband` TIDAK terdampak bug ini karena tiap subband dirender di subplot row terpisah dengan y-axis independen (autoscale per-row), bukan offset-stacking dalam satu axis.

## File yang Berubah

- `backend/app/routers/single_file.py` — fungsi `_signal_to_plotly_fig` (dipakai `plot_raw`, `plot_filtered`) dan endpoint `plot_ica`.

## Verifikasi

Dites langsung ke endpoint `/api/single/plot/raw` pakai file asli di atas. Sebelum fix: semua trace channel T3-O1 datar (variasi tenggelam di skala offset). Setelah fix, range per trace balik ke nilai yang match perhitungan manual dari file mentah:

```
T3: range=12985.6   T4: range=7963.1   T5: range=14090.2
T6: range=17913.8   O1: range=29373.4
```

Command verifikasi manual (Python, request multipart langsung ke endpoint) ada di riwayat sesi debugging, bisa direplikasi dengan file TXT OpenBCI mana pun yang channel-nya punya baseline berbeda-beda.

## Catatan Tambahan

- **Temuan data terpisah (bukan bug software):** channel O2 (EXG Channel 7, dipetakan dari `OPENBCI_CHANNEL_MAP` di `backend/app/config.py`) railed/konstan (cuma toggle antara 0 dan nilai full-scale ~187500 uV) di SEMUA 6 sesi yang dicek pada tanggal rekaman 2023-10-16 folder `Bima`. Ini indikasi kuat electrode/lead O2 lepas atau rusak untuk keseluruhan hari rekaman itu, bukan masalah per-subjek. User sebaiknya exclude channel O2 dari analisis untuk sesi-sesi tersebut, atau cek ulang wiring hardware kalau mau collect data baru.
- Pattern serupa (skala/offset dihitung dari data ter-flatten lintas channel, bukan per-channel) perlu diwaspadai di visualisasi multi-channel lain kalau ditambah di masa depan — selalu mean-center + pakai statistik robust per-channel/per-unit sebelum menghitung skala bersama.
