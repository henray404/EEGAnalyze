"""
Processing package â€” backend pemrosesan EEG.

Modul:
- loader     : Load EDF, ZIP, deteksi metadata
- filters    : Bandpass, notch, ICA, bad channel detection
- features   : Ekstraksi fitur (time-domain + frequency-domain)
- psd        : Analisis Power Spectral Density (Welch / Multitaper)
- epoching   : Epoching & Sliding Windows
- connectivity: Konektivitas fungsional (PLI / wPLI)
- delta      : Delta antar task
- statistics : Uji statistik (Mann-Whitney, t-test, Cohen's d, FDR)
"""

from app.processing.loader import EEGLoader
from app.processing.filters import EEGFilters
from app.processing.features import EEGFeatures
from app.processing.psd import PSDAnalyzer
from app.processing.epoching import EpochEngine
from app.processing.connectivity import ConnectivityAnalyzer
from app.processing.delta import DeltaCalculator
from app.processing.statistics import StatisticalTests
from app.processing.superlets import SuperletTFR
from app.processing.gamma_bursts import GammaBurstDetector

__all__ = [
    "EEGLoader",
    "EEGFilters",
    "EEGFeatures",
    "PSDAnalyzer",
    "EpochEngine",
    "ConnectivityAnalyzer",
    "DeltaCalculator",
    "StatisticalTests",
    "SuperletTFR",
    "GammaBurstDetector",
]



