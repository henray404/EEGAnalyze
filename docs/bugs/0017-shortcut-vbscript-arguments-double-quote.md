# 0017: Shortcut .lnk gagal dibuat -- VBScript compilation error di Arguments

**Tanggal ditemukan:** 2026-07-15
**Status:** resolved
**Komponen:** infra
**Severity:** medium

---

## Gejala

`install.create_windows_shortcuts()` (dipanggil saat instalasi selesai untuk membuat shortcut Start Menu + Desktop yang mengarah ke `launcher.py`) gagal dengan:

```
subprocess.CalledProcessError: Command '['cscript', '//nologo', '...tmpXXXX.vbs']' returned non-zero exit status 1.
```

Stderr asli (baru terlihat setelah `capture_output` dibongkar manual untuk debug, karena `create_windows_shortcut()` tidak meneruskan stderr ke caller):

```
...test.vbs(5, 21) Microsoft VBScript compilation error: Expected end of statement
```

## Cara Reproduksi

1. Panggil `install.windows_shortcut_vbscript(target, shortcut_path, description, arguments=f'"{some_path}"', working_dir=dest)`.
2. Jalankan hasilnya lewat `cscript //nologo`.
3. Baris 5 (`oLink.Arguments = ...`) gagal compile.

## Root Cause

`create_windows_shortcuts()` membangun `arguments` sudah dalam bentuk terkuotasi (`f'"{launcher_script}"'`) supaya path dengan spasi tetap jadi satu argumen saat `CreateProcess` mem-parsing command line target. Tapi `windows_shortcut_vbscript()` lalu membungkusnya lagi dengan kutip tanpa escaping:

```python
lines.append(f'oLink.Arguments = "{arguments}"')
```

Hasilnya empat karakter kutip berurutan tanpa escape (`""C:\...\launcher.py""`), yang bukan sintaks VBScript valid. VBScript butuh kutip literal di dalam string literal di-escape dengan menggandakannya (`""` merepresentasikan satu `"`), bukan sekadar digabung mentah.

Bug ini laten sejak `windows_shortcut_vbscript()`/`create_windows_shortcut()` diperluas menerima parameter `arguments`/`working_dir` (untuk mengarahkan shortcut ke `launcher.py` alih-alih `start.bat`), dan baru ketahuan saat verifikasi end-to-end (generate `.lnk` asli + baca properti via COM) dilakukan -- sebelumnya tidak ada test yang benar-benar menjalankan `cscript` dengan `arguments` terisi.

## Solusi

Escape kutip ganda di `arguments` sebelum interpolasi ke VBScript string literal:

```diff
     if arguments:
-        lines.append(f'oLink.Arguments = "{arguments}"')
+        escaped_args = arguments.replace(chr(34), chr(34) * 2)
+        lines.append(f'oLink.Arguments = "{escaped_args}"')
```

## File yang Berubah

- `install.py` -- `windows_shortcut_vbscript()`: escape kutip di `arguments`; docstring diperbarui.
- `tests/test_install.py` -- tambah `test_windows_shortcut_vbscript_escapes_quoted_arguments`.

## Verifikasi

1. `py -3 -m pytest tests/test_install.py tests/test_launcher.py -q` -- 42 test lolos.
2. Verifikasi manual end-to-end: panggil `install.create_windows_shortcuts()` di scratch dir, lalu baca `.lnk` yang dihasilkan lewat `WScript.Shell` COM (`win32com.client`) -- `TargetPath`, `Arguments` (`"...\launcher.py"` dengan kutip literal utuh, bukan rusak), `WorkingDirectory`, dan `Description` semuanya benar.

## Catatan Tambahan

- Pola serupa berisiko di tempat lain: setiap kali string yang sudah "pre-formatted" (mengandung kutip, backslash, atau karakter spesial lain) diteruskan ke generator kode/script lain (VBScript, shell, SQL), harus di-escape ulang sesuai aturan bahasa target -- jangan asumsikan nilainya "aman" hanya karena berasal dari kode sendiri.
- `create_windows_shortcut()` menelan stderr `cscript` lewat `capture_output=True` tanpa meneruskannya ke exception message -- untuk debugging berikutnya, pertimbangkan menyertakan `result.stderr` di pesan error alih-alih hanya mengandalkan `check=True`'s generic `CalledProcessError`.