import io
import tarfile
import zipfile

import numpy as np
import pandas as pd
import pytest

from app.processing import recoverix


# ----- helper pembuat data sintetik ----- #

def make_descriptor(sfreq=250, frame_len=2000, trigger_pos=500,
                    ch_names=None, trials=None):
    if ch_names is None:
        ch_names = [f"C{i}" for i in range(16)]
    layout = " ".join(ch_names)
    trial_xml = ""
    for t in (trials or []):
        trial_xml += (
            f'<Trial FlashingItem="{t["flashing_item"]}" TargetItem="0" '
            f'IsArtifact="{t.get("is_artifact", False)}" '
            f'IsValid="{t.get("is_valid", True)}" '
            f'sampleIndex="{t["sample_index"]}" />'
        )
    return (
        '<Experiment><Info/>'
        f'<FrameDefinition><SampleRate>{sfreq}</SampleRate>'
        f'<FrameLengthInSamples>{frame_len}</FrameLengthInSamples>'
        f'<TriggerPositionInSamples>{trigger_pos}</TriggerPositionInSamples>'
        f'<Layout>{layout}</Layout></FrameDefinition>'
        f'<Data>{trial_xml}</Data></Experiment>'
    ).encode("utf-8")


def make_bin(n_samples, n_eeg=16):
    n_cols = n_eeg + 1
    mat = np.zeros((n_samples, n_cols), dtype="<f4")
    for c in range(n_eeg):
        mat[:, c] = (c + 1) * 1000.0
    mat[:, n_eeg] = 1.0  # flag
    return mat.tobytes()


def make_tar(bin_bytes, xml_bytes):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, data in [("rawData.bin", bin_bytes),
                           ("rawDataDescriptor.xml", xml_bytes)]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


# ----- parse_descriptor ----- #

def test_parse_descriptor_basic():
    trials = [{"flashing_item": 0, "sample_index": 600},
              {"flashing_item": 1, "sample_index": 2600, "is_valid": False}]
    d = recoverix.parse_descriptor(make_descriptor(trials=trials))
    assert d["sfreq"] == 250
    assert d["frame_len"] == 2000
    assert d["trigger_pos"] == 500
    assert len(d["ch_names"]) == 16
    assert d["ch_names"][0] == "C0"
    assert len(d["trials"]) == 2
    assert d["trials"][0]["flashing_item"] == 0
    assert d["trials"][0]["sample_index"] == 600
    assert d["trials"][1]["is_valid"] is False


# ----- read_rawdata_bin ----- #

def test_read_rawdata_bin_shape_and_drops_flag():
    b = make_bin(100, n_eeg=16)
    eeg = recoverix.read_rawdata_bin(b, n_cols=17, n_eeg=16)
    assert eeg.shape == (16, 100)
    assert np.allclose(eeg[0], 1000.0)
    assert np.allclose(eeg[15], 16000.0)


def test_read_rawdata_bin_rejects_bad_size():
    bad = np.zeros(17 * 5 + 3, dtype="<f4").tobytes()
    with pytest.raises(ValueError):
        recoverix.read_rawdata_bin(bad, n_cols=17, n_eeg=16)


# ----- find_rawdata_tars + read_block_from_tar ----- #

def test_find_rawdata_tars_sorted():
    names = ["sess/rawData3.tar.gz", "sess/rawData1.tar.gz",
             "sess/results.bin", "sess/rawData2.tar.gz", "sess/result.pdf"]
    out = recoverix.find_rawdata_tars(names)
    assert out == ["sess/rawData1.tar.gz", "sess/rawData2.tar.gz",
                   "sess/rawData3.tar.gz"]


def test_read_block_from_tar():
    xml = make_descriptor(trials=[{"flashing_item": 1, "sample_index": 600}])
    tar = make_tar(make_bin(100), xml)
    bin_bytes, desc = recoverix.read_block_from_tar(tar)
    assert len(bin_bytes) == 100 * 17 * 4
    assert desc["trials"][0]["flashing_item"] == 1


# ----- load_session ----- #

def test_load_session_concat_and_offset():
    d1 = recoverix.parse_descriptor(make_descriptor(
        trials=[{"flashing_item": 0, "sample_index": 600}]))
    d2 = recoverix.parse_descriptor(make_descriptor(
        trials=[{"flashing_item": 1, "sample_index": 700}]))
    s = recoverix.load_session([(make_bin(1000), d1), (make_bin(500), d2)])
    assert s["data"].shape == (16, 1500)
    assert s["sfreq"] == 250
    assert len(s["trials"]) == 2
    assert s["trials"][0]["sample_index"] == 600
    assert s["trials"][1]["sample_index"] == 1700  # digeser +1000
    assert s["meta"]["n_blocks"] == 2
    assert s["meta"]["trigger_pos"] == 500
    assert s["meta"]["frame_len"] == 2000


def test_load_session_rejects_mismatch_layout():
    d1 = recoverix.parse_descriptor(make_descriptor(
        ch_names=[f"A{i}" for i in range(16)]))
    d2 = recoverix.parse_descriptor(make_descriptor(
        ch_names=[f"B{i}" for i in range(16)]))
    with pytest.raises(ValueError):
        recoverix.load_session([(make_bin(100), d1), (make_bin(100), d2)])


def test_load_session_empty_rejected():
    with pytest.raises(ValueError):
        recoverix.load_session([])


# ----- EEGLoader.load_recoverix_zip (integrasi) ----- #

def _make_session_zip():
    xml1 = make_descriptor(trials=[{"flashing_item": 0, "sample_index": 600}])
    xml2 = make_descriptor(trials=[{"flashing_item": 1, "sample_index": 700}])
    tar1 = make_tar(make_bin(3000), xml1)
    tar2 = make_tar(make_bin(2000), xml2)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("sess/rawData1.tar.gz", tar1)
        zf.writestr("sess/rawData2.tar.gz", tar2)
    zbuf.seek(0)
    return zbuf


def test_load_recoverix_zip_builds_raw():
    from app.processing.loader import EEGLoader
    loader = EEGLoader()
    info = loader.load_recoverix_zip(_make_session_zip())

    assert info["n_channels"] == 16
    assert info["sfreq"] == 250
    assert loader.get_task_list() == ["Left", "Right"]

    df = loader.extract_dataframe()
    assert "marker" in df.columns
    markers = set(df["marker"].unique())
    assert "Left" in markers
    assert "Right" in markers
    assert "none" in markers


def test_load_recoverix_zip_rejects_non_recoverix():
    from app.processing.loader import EEGLoader
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("data/foo.txt", "bukan recoveriX")
    zbuf.seek(0)
    loader = EEGLoader()
    with pytest.raises(RuntimeError):
        loader.load_recoverix_zip(zbuf)


def test_load_recoverix_zip_sets_cue_offset():
    from app.processing.loader import EEGLoader
    loader = EEGLoader()
    loader.load_recoverix_zip(_make_session_zip())
    assert loader.cue_offset_s == 500 / 250  # trigger_pos / sfreq


def test_eegloader_default_cue_offset_is_none():
    from app.processing.loader import EEGLoader
    assert EEGLoader().cue_offset_s is None


# ----- compute_erd_ers_intratrial ----- #

def make_bin_split(pre_samples, post_samples, pre_amp, post_amp,
                   n_eeg=16, freq=10, sfreq=250):
    """Bin sintetik: sinyal sinus freq Hz, amplitudo pre_amp lalu post_amp."""
    n_samples = pre_samples + post_samples
    n_cols = n_eeg + 1
    t = np.arange(n_samples) / sfreq
    amp = np.where(np.arange(n_samples) < pre_samples, pre_amp, post_amp)
    sig = (amp * np.sin(2 * np.pi * freq * t)).astype("<f4")
    mat = np.zeros((n_samples, n_cols), dtype="<f4")
    for c in range(n_eeg):
        mat[:, c] = sig
    mat[:, n_eeg] = 1.0
    return mat.tobytes()


def test_compute_erd_ers_intratrial_basic():
    from app.processing.loader import EEGLoader
    from app.processing.features import EEGFeatures

    sfreq = 250
    pre_n, post_n = 500, 1500  # 2s pre-cue, 6s post-cue
    bin_bytes = make_bin_split(pre_n, post_n, pre_amp=1.0, post_amp=0.2, sfreq=sfreq)
    xml = make_descriptor(
        sfreq=sfreq, frame_len=pre_n + post_n, trigger_pos=pre_n,
        trials=[{"flashing_item": 1, "sample_index": pre_n}],  # 1 = Left
    )
    tar = make_tar(bin_bytes, xml)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("sess/rawData1.tar.gz", tar)
    zbuf.seek(0)

    loader = EEGLoader()
    loader.load_recoverix_zip(zbuf)
    df = loader.extract_dataframe()

    erd_df = EEGFeatures.compute_erd_ers_intratrial(
        loader, df, ["C0"], "Left",
        subbands={"alpha": (8, 13)},
        cue_offset_s=loader.cue_offset_s,
    )
    assert not erd_df.empty
    row = erd_df.iloc[0]
    assert row["task"] == "Left"
    assert row["channel"] == "C0"
    assert row["subband"] == "alpha"
    assert row["baseline_power"] > row["task_power"]
    assert row["erd_ers_pct"] < -50  # ERD jelas (post lebih kecil dari pre)


def test_compute_erd_ers_intratrial_no_cue_offset():
    from app.processing.features import EEGFeatures
    result = EEGFeatures.compute_erd_ers_intratrial(
        None, pd.DataFrame(), ["C0"], "Left", cue_offset_s=None,
    )
    assert result.empty


# ----- find_recoverix_sessions ----- #

def test_find_recoverix_sessions_groups_by_dir():
    names = [
        "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523/rawData2.tar.gz",
        "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523/rawData1.tar.gz",
        "ltk-x/22May2026-demo/54664/yiwan/ScenarioB/20260522_094332/rawData1.tar.gz",
        "ltk-x/22May2026-demo/54664/yiwan/ScenarioB/20260522_094332/rawData2.tar.gz",
        "ltk-x/22May2026-demo/results.bin",
    ]
    sessions = recoverix.find_recoverix_sessions(names)
    assert len(sessions) == 2

    sess0 = sessions[0]
    assert sess0["session_dir"] == "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523"
    assert sess0["tar_names"] == [
        "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523/rawData1.tar.gz",
        "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523/rawData2.tar.gz",
    ]

    sess1 = sessions[1]
    assert sess1["session_dir"] == "ltk-x/22May2026-demo/54664/yiwan/ScenarioB/20260522_094332"
    assert sess1["tar_names"] == [
        "ltk-x/22May2026-demo/54664/yiwan/ScenarioB/20260522_094332/rawData1.tar.gz",
        "ltk-x/22May2026-demo/54664/yiwan/ScenarioB/20260522_094332/rawData2.tar.gz",
    ]


def test_find_recoverix_sessions_empty_when_no_tars():
    assert recoverix.find_recoverix_sessions(["a/results.bin", "a/notes.txt"]) == []


# ----- parse_session_path ----- #

def test_parse_session_path_basic():
    session_dir = "ltk-x/22May2026-demo/47822/yani/ScenarioA/20260522_103523"
    meta = recoverix.parse_session_path(session_dir)
    assert meta == {
        "event": "22May2026-demo",
        "subject": "47822",
        "subject_name": "yani",
        "scenario": "ScenarioA",
        "run": "20260522_103523",
        "run_date": "2026-05-22",
        "run_time": "10:35:23",
    }


def test_parse_session_path_too_short_returns_unknown():
    meta = recoverix.parse_session_path("onlyonefolder")
    assert meta == {
        "event": "unknown",
        "subject": "unknown",
        "subject_name": "unknown",
        "scenario": "unknown",
        "run": "unknown",
        "run_date": "unknown",
        "run_time": "unknown",
    }


def test_parse_session_path_unknown_run_format():
    session_dir = "ltk-x/22May2026-demo/47822/yani/ScenarioA/BadRunName"
    meta = recoverix.parse_session_path(session_dir)
    assert meta["event"] == "22May2026-demo"
    assert meta["subject"] == "47822"
    assert meta["subject_name"] == "yani"
    assert meta["scenario"] == "ScenarioA"
    assert meta["run"] == "BadRunName"
    assert meta["run_date"] == "unknown"
    assert meta["run_time"] == "unknown"


# ----- load_recoverix_session + list_recoverix_sessions_in_zip ----- #

def _make_multi_session_zip():
    """ZIP berisi 2 sesi recoveriX dengan layout channel berbeda (A vs B)."""
    xml_a = make_descriptor(
        ch_names=[f"A{i}" for i in range(16)],
        trials=[{"flashing_item": 0, "sample_index": 600}],
    )
    xml_b = make_descriptor(
        ch_names=[f"B{i}" for i in range(16)],
        trials=[{"flashing_item": 1, "sample_index": 700}],
    )
    tar_a = make_tar(make_bin(1000, n_eeg=16), xml_a)
    tar_b = make_tar(make_bin(1000, n_eeg=16), xml_b)

    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("sessA/rawData1.tar.gz", tar_a)
        zf.writestr("sessB/rawData1.tar.gz", tar_b)
    zbuf.seek(0)
    return zbuf


def test_list_recoverix_sessions_in_zip():
    from app.processing.loader import EEGLoader
    sessions = EEGLoader.list_recoverix_sessions_in_zip(_make_multi_session_zip())
    assert len(sessions) == 2
    assert sessions[0]["session_dir"] == "sessA"
    assert sessions[0]["tar_names"] == ["sessA/rawData1.tar.gz"]
    assert sessions[1]["session_dir"] == "sessB"
    assert sessions[1]["tar_names"] == ["sessB/rawData1.tar.gz"]


def test_load_recoverix_session_isolates_sessions():
    from app.processing.loader import EEGLoader
    zbuf = _make_multi_session_zip()
    sessions = EEGLoader.list_recoverix_sessions_in_zip(zbuf)

    loader_a = EEGLoader()
    loader_a.load_recoverix_session(zbuf, sessions[0]["tar_names"])
    assert loader_a.channel_names[0] == "A0"
    assert loader_a.get_task_list() == ["Right"]  # flashing_item 0 = Right

    loader_b = EEGLoader()
    loader_b.load_recoverix_session(zbuf, sessions[1]["tar_names"])
    assert loader_b.channel_names[0] == "B0"
    assert loader_b.get_task_list() == ["Left"]  # flashing_item 1 = Left
