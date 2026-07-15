# processing/io

Tahap **Load** di pipeline EEG (lihat `CLAUDE.md`).

## Isi

- `loader.py` -- `EEGLoader`. Load file EDF (MNE), TXT (OpenBCI), atau ZIP
  (recoveriX). Deteksi metadata: kategori ALS/Normal, subject, waktu rekam,
  scenario, daftar task/occurrence dari annotation.
- `recoverix.py` -- Parsing format device recoveriX (dipanggil `loader.py`
  saat load file `.zip`; bukan modul batch-specific meski namanya mirip).

## Dipakai oleh

`routers/single_file.py` dan `routers/batch.py` -- keduanya load file lewat
`EEGLoader`, tidak ada jalur load yang eksklusif ke salah satu.

## Kalau nambah format file baru

Tambah method `load_xxx()` di `EEGLoader`, daftarkan deteksi ekstensi di
`routers/_shared.py` atau langsung di router (`_is_edf`/`_is_txt`/`_is_zip`).