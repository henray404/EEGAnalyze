import io
import zipfile

from fastapi.testclient import TestClient

from app.main import app
from tests.test_recoverix import make_descriptor, make_tar, make_bin

client = TestClient(app)

SCAN_URL = "/api/batch/recoverix/scan"


def _session_tar(flashing_item, ch_names=None):
    bin_bytes = make_bin(1000, n_eeg=16)
    xml = make_descriptor(
        sfreq=250, frame_len=1000, trigger_pos=200, ch_names=ch_names,
        trials=[{"flashing_item": flashing_item, "sample_index": 200}],
    )
    return make_tar(bin_bytes, xml)


def _make_two_session_zip():
    tar_left = _session_tar(flashing_item=1)   # 1 = Left
    tar_right = _session_tar(flashing_item=0)  # 0 = Right
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr(
            "ltk-x/22May2026-demo/111/alice/ScenarioA/20260522_103523/rawData1.tar.gz",
            tar_left,
        )
        zf.writestr(
            "ltk-x/22May2026-demo/222/bob/ScenarioB/20260522_094332/rawData1.tar.gz",
            tar_right,
        )
    zbuf.seek(0)
    return zbuf


def test_scan_recoverix_two_sessions():
    resp = client.post(
        SCAN_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_sessions"] == 2
    assert set(data["subjects"]) == {"111", "222"}
    assert set(data["scenarios"]) == {"ScenarioA", "ScenarioB"}
    assert data["tasks"] == ["Left", "Right"]
    assert len(data["channels"]) == 16

    session = next(s for s in data["sessions"] if s["subject"] == "111")
    assert session["subject_name"] == "alice"
    assert session["event"] == "22May2026-demo"
    assert session["scenario"] == "ScenarioA"
    assert session["run_date"] == "2026-05-22"
    assert session["run_time"] == "10:35:23"


def test_scan_recoverix_rejects_non_zip():
    resp = client.post(SCAN_URL, files={"file": ("sess.txt", b"not a zip", "text/plain")})
    assert resp.status_code == 400


def test_scan_recoverix_rejects_zip_without_sessions():
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("data/foo.txt", "bukan recoveriX")
    zbuf.seek(0)
    resp = client.post(SCAN_URL, files={"file": ("empty.zip", zbuf.getvalue(), "application/zip")})
    assert resp.status_code == 422


def test_scan_recoverix_rejects_corrupt_zip():
    resp = client.post(
        SCAN_URL,
        files={"file": ("corrupt.zip", b"this is not a valid zip file content", "application/zip")},
    )
    assert resp.status_code == 422
