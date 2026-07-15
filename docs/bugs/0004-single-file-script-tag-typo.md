# 0004: Halaman Single File tidak bisa dibuka karena typo tag `<script>` di index.html

**Tanggal ditemukan:** 2026-05-17
**Status:** resolved
**Komponen:** frontend
**Severity:** high

---

## Gejala

Saat klik nav "Single File" pada `frontend_v2`, halaman kosong / tidak ada
yang dirender. Klik navigasi ke halaman lain (Overview, Batch, Machine
Learning) bekerja normal.

Tidak ada error overlay yang jelas — hanya area konten kosong. Console
browser memunculkan `ReferenceError: SingleFilePage is not defined` saat
React mencoba render `<SingleFilePage />`.

## Cara Reproduksi

1. Jalankan backend dan frontend static server seperti biasa
   (`uvicorn app.main:app --port 8000` dan `python -m http.server 5173`
   di `frontend_v2/`).
2. Buka `http://localhost:5173`.
3. Klik tab "Single File" di navbar.
4. Hasil: layout navbar masih tampil, tapi konten halaman kosong.

## Root Cause

`frontend_v2/index.html:31` punya typo pada tag pembuka:

```html
<s  cript type="text/babel" src="src/pages/single-file.jsx"></script>
```

Ada dua spasi antara `s` dan `cript`. Browser tidak mengenali `<s  cript>`
sebagai tag `<script>` — diperlakukan sebagai elemen kustom yang
tidak diketahui dan diabaikan. Akibatnya `src/pages/single-file.jsx`
**tidak pernah dimuat** oleh Babel standalone, dan `window.SingleFilePage`
tidak pernah didefinisikan.

Saat `app.jsx` mencoba render `<SingleFilePage />` (lewat global
`window.SingleFilePage`), React melempar `ReferenceError`. Halaman lain
(`OverviewPage`, `BatchPage`, `MLPage`) tidak terdampak karena script
tag-nya ditulis dengan benar.

Kemungkinan typo masuk saat sesi rewrite besar terhadap `index.html` di
fase reorganisasi `frontend_v2/`. Parser sintaks (Babel, Node) tidak
menangkapnya karena file `.jsx`-nya sendiri valid; bug murni di lapisan
HTML script-tag.

## Solusi

Hapus spasi ekstra di nama tag.

```diff
- <s  cript type="text/babel" src="src/pages/single-file.jsx"></script>
+ <script type="text/babel" src="src/pages/single-file.jsx"></script>
```

## File yang Berubah

- `frontend_v2/index.html:31`

## Verifikasi

1. Reload `http://localhost:5173`.
2. Klik tab "Single File" di navbar — halaman harus render lengkap
   (upload card, channel chips, pre-processing panel, plot tabs).
3. Buka DevTools Network — pastikan `src/pages/single-file.jsx`
   dimuat (status 200, MIME `text/jsx`).
4. Buka DevTools Console — tidak ada `ReferenceError: SingleFilePage`.

## Catatan Tambahan

- HTML parser sangat permisif; tag tidak dikenal akan dilewati diam-diam
  tanpa error. Browser hanya mengeksekusi tag yang dikenali (`<script>`,
  `<style>`, dll). Setiap typo pada nama tag = tag mati.
- Pelajaran: setiap kali menulis ulang `index.html`, validasi dengan
  membuka file di browser dan memastikan setiap script-tag muncul di
  DevTools > Sources / Network. Atau jalankan `grep -c '<script' index.html`
  vs jumlah baris script yang diharapkan.
- Pattern serupa yang harus diwaspadai: typo serupa di tag-tag inline
  lain (`<style>`, `<link>`, `<meta>`). Editor tanpa HTML linter tidak
  akan menangkap ini.
