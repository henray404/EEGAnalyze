#!/bin/bash
cd "$(dirname "$0")"

# Cek Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python tidak ditemukan."
    if command -v brew &> /dev/null; then
        echo "Menginstall via Homebrew..."
        brew install python@3.12
    else
        echo "Install Homebrew dulu: https://brew.sh"
        exit 1
    fi
fi

# Jalankan GUI launcher
python3 launcher.py
