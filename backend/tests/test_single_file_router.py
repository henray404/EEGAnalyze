import io
import zipfile

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from tests._ndjson import ndjson_result
from tests.test_recoverix import make_descriptor, make_bin, make_tar, make_bin_split

client = TestClient(app)

UPLOAD_URL = "/api/single/upload"
ERD_URL = "/api/single/erd"
PROCESS_URL = "/api/single/process"


def test_upload_recoverix_zip():
    xml = make_descriptor(trials=[{"flashing_item": 0, "sample_index": 600},
                                  {"flashing_item": 1, "sample_index": 2600}])
    tar = make_tar(make_bin(3000), xml)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("sess/rawData1.tar.gz", tar)
    zbuf.seek(0)

    resp = client.post(
        UPLOAD_URL,
        files={"file": ("sess.zip", zbuf.getvalue(), "application/zip")},
    )
    assert resp.status_code == 200, resp.text
    data = ndjson_result(resp)
    assert data["format"] == "recoveriX"
    assert data["n_channels"] == 16
    assert set(data["tasks"]) == {"Left", "Right"}


def _recoverix_zip_bytes():
    sfreq = 250
    pre_n, post_n = 500, 1500
    bin_bytes = make_bin_split(pre_n, post_n, pre_amp=1.0, post_amp=0.2, sfreq=sfreq)
    xml = make_descriptor(
        sfreq=sfreq, frame_len=pre_n + post_n, trigger_pos=pre_n,
        trials=[{"flashing_item": 1, "sample_index": pre_n}],  # 1 = Left
    )
    tar = make_tar(bin_bytes, xml)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("sess/rawData1.tar.gz", tar)
    return zbuf.getvalue()


def test_erd_intra_trial_recoverix():
    resp = client.post(
        ERD_URL,
        files={"file": ("sess.zip", _recoverix_zip_bytes(), "application/zip")},
        data={
            "target_task": "Left",
            "intra_trial": "true",
            "use_notch": "false",
            "subbands": "alpha",
            "channels_filter": "C0",
        },
    )
    assert resp.status_code == 200, resp.text
    data = ndjson_result(resp)
    assert data["erd_mode"] == "intra_trial"
    assert data["baseline_task"] == "pre-cue"
    assert len(data["erd_records"]) == 1
    rec = data["erd_records"][0]
    assert rec["channel"] == "C0"
    assert rec["subband"] == "Alpha"
    assert rec["erd_ers_pct"] < -50


def test_erd_intra_trial_requires_target_task():
    resp = client.post(
        ERD_URL,
        files={"file": ("sess.zip", _recoverix_zip_bytes(), "application/zip")},
        data={"intra_trial": "true"},
    )
    assert resp.status_code == 400


def _make_openbci_txt_bytes(n_samples=375, seed=7):
    """File TXT OpenBCI sintetis: 2 channel, tanpa marker (whole-file mode)."""
    rng = np.random.RandomState(seed)
    ch2 = rng.uniform(-50, 50, n_samples)
    ch3 = rng.uniform(-50, 50, n_samples)
    lines = [
        "%OpenBCI Raw EXG Data",
        "Sample Index, EXG Channel 2, EXG Channel 3",
    ]
    lines += [f"{i}, {ch2[i]:.3f}, {ch3[i]:.3f}" for i in range(n_samples)]
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_process_chunk_mode_returns_encoding_records():
    """chunk_mode=true harus lanjut ke chain encoding (sama seperti batch)."""
    resp = client.post(
        PROCESS_URL,
        files={"file": ("session.txt", _make_openbci_txt_bytes(), "text/plain")},
        data={
            "subbands": "alpha",
            "features": "mav,variance,std",
            "chunk_mode": "true",
            "chunk_duration": "0.5",
        },
    )
    assert resp.status_code == 200, resp.text
    data = ndjson_result(resp)
    assert data["mode"] == "chunk"
    assert data["n_records"] > 0
    assert len(data["encoding_records"]) > 0
    rec = data["encoding_records"][0]
    assert "chain_mav_sequence" in rec
    assert "chain_mav_ratio" in rec


def test_process_full_mode_has_empty_encoding_records():
    """Mode full (bukan chunk) tidak menghasilkan encoding_records."""
    resp = client.post(
        PROCESS_URL,
        files={"file": ("session.txt", _make_openbci_txt_bytes(), "text/plain")},
        data={"subbands": "alpha", "features": "mav,variance,std"},
    )
    assert resp.status_code == 200, resp.text
    data = ndjson_result(resp)
    assert data["mode"] == "full"
    assert data["encoding_records"] == []
