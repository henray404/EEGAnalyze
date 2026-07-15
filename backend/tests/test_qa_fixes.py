"""Self-check untuk fix QA 2026-07-01 (H1 occurrence, C3/M2 chunking bandpass).

Jalankan: dari backend/ -> `python -m tests.test_qa_fixes` atau `pytest`.
Tanpa framework wajib; assert murni.
"""
import numpy as np

from app.processing.io.loader import EEGLoader
from app.processing.features.chunking import _bandpass_array, _MIN_CHUNK_SAMPLES


def _make_loader_with_adjacent_occurrences():
    """RawArray sintetis: dua occurrence 'Thinking' berdampingan (2s & 3s)."""
    import mne
    sfreq = 100.0
    n_ch, n_t = 2, 400  # 4 detik
    data = np.random.RandomState(0).randn(n_ch, n_t) * 1e-6
    info = mne.create_info(["Cz", "Fz"], sfreq, ["eeg", "eeg"])
    raw = mne.io.RawArray(data, info, verbose=False)
    raw.set_annotations(mne.Annotations(
        onset=[1.0, 2.0], duration=[1.0, 1.0],
        description=["Thinking", "Thinking"],
    ))
    ld = EEGLoader()
    ld.raw = raw
    ld.sfreq = sfreq
    ld.channel_names = raw.ch_names
    return ld


def test_adjacent_same_task_occurrences_not_merged():
    ld = _make_loader_with_adjacent_occurrences()
    df = ld.extract_dataframe()

    occs = [o for o in ld.get_task_occurrences() if o["task"] == "Thinking"]
    assert len(occs) == 2, f"harus 2 occurrence, dapat {len(occs)}"

    seg1 = ld.extract_occurrence_segment(df, "Thinking", 1)
    seg2 = ld.extract_occurrence_segment(df, "Thinking", 2)

    assert not seg1.empty and not seg2.empty, "kedua segment harus ada"
    # Occurrence berdampingan TIDAK boleh menyatu -> tiap ~100 sampel, terpisah.
    assert seg1["time"].max() < 2.0, "seg1 harus sebelum 2.0s"
    assert seg2["time"].min() >= 2.0, "seg2 harus mulai >= 2.0s"
    assert len(seg1) == 100 and len(seg2) == 100, (
        f"tiap occurrence 1s @100Hz = 100 sampel, dapat "
        f"{len(seg1)}/{len(seg2)}"
    )


def test_occurrence_selection_filters_to_one():
    """selected_occ hanya proses occurrence terpilih (fitur 'Thinking pertama')."""
    from app.processing.features.features import EEGFeatures
    import mne
    sfreq = 100.0
    data = np.random.RandomState(2).randn(2, 400) * 1e-6
    info = mne.create_info(["Cz", "Fz"], sfreq, ["eeg", "eeg"])
    raw = mne.io.RawArray(data, info, verbose=False)
    raw.set_annotations(mne.Annotations(
        onset=[0.5, 1.5, 2.5], duration=[0.6, 0.6, 0.6],
        description=["Thinking", "Thinking", "Resting"],
    ))
    ld = EEGLoader()
    ld.raw = raw
    ld.sfreq = sfreq
    ld.channel_names = raw.ch_names
    df = ld.extract_dataframe()

    out = EEGFeatures.compute_occurrence_features(
        ld, df, ld.channel_names, ["Thinking"],
        selected_occ={("Thinking", 1)},
    )
    assert not out.empty, "harus ada hasil untuk Thinking #1"
    got = set(zip(out["task"], out["occurrence"]))
    assert got == {("Thinking", 1)}, f"harus cuma Thinking#1, dapat {got}"


def test_bandpass_short_signal_returns_zeros_no_crash():
    short = np.random.randn(_MIN_CHUNK_SAMPLES // 2)
    out = _bandpass_array(short, 100.0, 0.5, 4.0)  # Delta
    assert out.shape == short.shape
    assert np.all(out == 0.0), "sinyal terlalu pendek harus di-nol-kan"


def test_bandpass_delta_no_nan_on_valid_length():
    sig = np.random.RandomState(1).randn(400)
    out = _bandpass_array(sig, 100.0, 0.5, 4.0)  # Delta band, rawan NaN (b,a)
    assert np.all(np.isfinite(out)), "SOS Delta tidak boleh NaN/inf"


if __name__ == "__main__":
    test_adjacent_same_task_occurrences_not_merged()
    test_occurrence_selection_filters_to_one()
    test_bandpass_short_signal_returns_zeros_no_crash()
    test_bandpass_delta_no_nan_on_valid_length()
    print("OK: semua self-check QA fix lolos")
