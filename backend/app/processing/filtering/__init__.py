"""
Processing.filtering -- Bandpass, notch, ICA, bad channel detection.

Modul:
- filters : EEGFilters, semua operasi filtering pada raw MNE object
"""

from app.processing.filtering.filters import EEGFilters

__all__ = [
    "EEGFilters",
]