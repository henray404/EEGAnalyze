"""
Processing.timefreq -- Time-frequency & trial-epoch analysis.

Belum di-wire ke router manapun (pending integration untuk fitur mendatang).

Modul:
- superlets    : SuperletTFR, time-frequency representation
- gamma_bursts : GammaBurstDetector, deteksi gamma burst (MAD threshold)
- epoching     : EpochEngine, epoching & sliding window per trial
- encoding     : Pipeline encoding gabungan (pakai epoching+superlets+gamma_bursts)
"""

from app.processing.timefreq.superlets import SuperletTFR
from app.processing.timefreq.gamma_bursts import GammaBurstDetector
from app.processing.timefreq.epoching import EpochEngine

__all__ = [
    "SuperletTFR",
    "GammaBurstDetector",
    "EpochEngine",
]