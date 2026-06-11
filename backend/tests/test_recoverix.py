import io
import tarfile
import zipfile

import numpy as np
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
