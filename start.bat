@echo off
title EEG Analysis Tool v2

:: Cek Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python tidak ditemukan.
    echo Download di: https://python.org/downloads
    pause
    exit /b 1
)

:: Jalankan GUI launcher tanpa jendela console
pythonw launcher.py
