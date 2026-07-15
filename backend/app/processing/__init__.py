"""
Processing package -- backend pemrosesan EEG.

Sub-package (mengikuti alur pipeline di CLAUDE.md: Load -> Filter -> Ekstraksi
Fitur -> Analisis):
- io         : Load EDF/TXT/ZIP, deteksi metadata (loader, recoverix)
- filtering  : Bandpass, notch, ICA, bad channel detection (filters)
- features   : Ekstraksi fitur full-data & chunked + PSD (features, chunking, psd)
- timefreq   : Time-frequency & trial-epoch (superlets, gamma_bursts, epoching,
               encoding) -- belum di-wire ke router manapun
- analysis   : Statistik & lintas-task/lintas-grup (delta, statistics,
               connectivity, comparison) -- belum di-wire ke router manapun
"""

from app.processing.io.loader import EEGLoader
from app.processing.filtering.filters import EEGFilters
from app.processing.features.features import EEGFeatures
from app.processing.features.chunking import ChunkingPipeline
from app.processing.features.psd import PSDAnalyzer
from app.processing.timefreq.epoching import EpochEngine
from app.processing.timefreq.superlets import SuperletTFR
from app.processing.timefreq.gamma_bursts import GammaBurstDetector
from app.processing.analysis.connectivity import ConnectivityAnalyzer
from app.processing.analysis.delta import DeltaCalculator
from app.processing.analysis.statistics import StatisticalTests

__all__ = [
    "EEGLoader",
    "EEGFilters",
    "EEGFeatures",
    "ChunkingPipeline",
    "PSDAnalyzer",
    "EpochEngine",
    "ConnectivityAnalyzer",
    "DeltaCalculator",
    "StatisticalTests",
    "SuperletTFR",
    "GammaBurstDetector",
]