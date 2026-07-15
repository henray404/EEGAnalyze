"""
Processing.io -- Load file EEG (EDF/TXT/ZIP) dan deteksi metadata.

Modul:
- loader     : EEGLoader, load EDF/TXT/ZIP, deteksi kategori/subject/scenario
- recoverix  : Parsing format device recoveriX (dipakai loader untuk .zip)
"""

from app.processing.io.loader import EEGLoader

__all__ = [
    "EEGLoader",
]