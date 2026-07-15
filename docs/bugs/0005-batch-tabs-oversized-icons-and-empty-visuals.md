# 0005: Batch tabs menampilkan ikon oversize dan visual kosong meski data ada

**Tanggal ditemukan:** 2026-05-17
**Status:** resolved
**Komponen:** frontend
**Severity:** medium

---

## Gejala

Di halaman Batch (`frontend_v2`):

- Ikon pada File List, Delta Chart, dan Scatter tampil sangat besar.
- Scatter tab sering menampilkan state kosong walau hasil batch sudah ada.
- Heatmap menampilkan "Belum ada data heatmap" meski proses batch selesai.
- Delta chart tampak seperti tidak memplot bar (nilai menempel di baseline).

## Cara Reproduksi

1. Jalankan frontend_v2, buka halaman Batch.
2. Upload ZIP dataset lalu jalankan proses batch sampai selesai.
3. Buka tab `File List`, `Delta Chart`, `Scatter`, `Heatmap`.
4. Hasil: ikon membesar, beberapa tab visual kosong atau terlihat seperti tidak terplot.

## Root Cause

1. **Ikon oversize:** komponen `Icon.*` hanya punya `viewBox` tanpa ukuran default. Di konteks tertentu (mis. `.row`) tidak ada CSS ukuran ikon, sehingga browser memberi ukuran default SVG (`300x150`).
2. **Scatter kosong:** state `subband` diinisialisasi sebelum data tersedia dan tidak disinkronkan lagi ketika daftar subband dari hasil batch berubah, sehingga filter subband aktif bisa tidak valid.
3. **Heatmap kosong:** heatmap hanya memakai channel/subband dari filter kiri. Jika nama/seleksi tidak overlap dengan record hasil, tab masuk empty state meski data tersedia.
4. **Delta chart tampak kosong:** skala sumbu-Y dipaksa minimal `0.01`, sedangkan nilai fitur berada di orde mikro (`e-6`), sehingga tinggi bar menjadi nyaris nol.

## Solusi

- Tambah ukuran default ikon untuk konteks `.row` agar SVG inline tidak membesar.
- Sinkronkan state subband scatter ke subband yang benar-benar tersedia di hasil.
- Tambah fallback pemilihan channel/subband heatmap dari data hasil jika seleksi aktif tidak overlap.
- Ubah skala Y delta chart menjadi adaptif terhadap nilai aktual data (tanpa floor `0.01`).

```diff
+ .row > svg { width: 16px; height: 16px; flex: 0 0 16px; display: block; }

- const [subband, setSubband] = useStateBT(subbandsAvail[0] || 'Alpha');
+ const [subband, setSubband] = useStateBT('');
+ useEffectBT(() => { ...sync to available subbands... }, [subbandsAvail, subband]);

- const cols = selectedSubbandsOnly;
- const rows = selectedChannelsOnly;
+ const cols = selectedOverlapOrFallbackToRecordSubbands;
+ const rows = selectedOverlapOrFallbackToRecordChannels;

- const maxV = Math.max(...allVals, 0.01);
+ const axisMax = Math.max(...allVals.map(Math.abs), Number.EPSILON) * 1.05;
```

## File yang Berubah

- `frontend_v2/src/pages/batch-tabs.jsx`
- `frontend_v2/styles/main.css`

## Verifikasi

1. Proses batch hingga selesai.
2. Pastikan ikon di File List / Delta / Scatter tampil normal (tidak raksasa).
3. Pastikan Scatter menampilkan titik jika data ada.
4. Pastikan Heatmap tetap muncul selama ada record yang punya channel/subband valid.
5. Pastikan bar Delta terlihat proporsional untuk nilai kecil (`e-6`).

## Catatan Tambahan

- Untuk komponen SVG global tanpa width/height, selalu sediakan sizing rule pada konteks pemakaian.
- Visual analytics sebaiknya punya fallback otomatis ke domain data aktual agar tidak mudah masuk empty state palsu.
