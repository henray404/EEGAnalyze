import io
import json
import zipfile

from fastapi.testclient import TestClient

from app.main import app
from tests.test_recoverix import make_descriptor, make_tar, make_bin

client = TestClient(app)

SCAN_URL = "/api/batch/scan"
PROCESS_URL = "/api/batch/process"


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
    assert data["data_type"] == "recoverix"
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


def test_process_recoverix_two_sessions():
    resp = client.post(
        PROCESS_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
        data={"subbands": "alpha", "features": "mav"},
    )
    assert resp.status_code == 200, resp.text

    lines = [l for l in resp.text.strip().split("\n") if l]
    events = [json.loads(l) for l in lines]
    result = events[-1]

    assert result["type"] == "result"
    assert result["data_type"] == "recoverix"
    assert result["total_sessions"] == 2
    assert result["processed_sessions"] == 2
    assert result["errors"] == []
    assert len(result["records"]) > 0
    assert len(result["erd_records"]) > 0

    rec = result["records"][0]
    for key in ("subject", "subject_name", "scenario", "event", "run_date", "run_time", "session", "task", "channel", "subband", "mav"):
        assert key in rec, f"missing key {key} in record: {rec}"

    erd = result["erd_records"][0]
    assert erd["task"] in ("Left", "Right")
    assert erd["subband"] == "Alpha"
    for key in ("subject", "subject_name", "scenario", "session", "channel", "baseline_power", "task_power", "erd_ers_pct"):
        assert key in erd, f"missing key {key} in erd record: {erd}"


def test_process_recoverix_filter_channels():
    resp = client.post(
        PROCESS_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
        data={"subbands": "alpha", "features": "mav", "filter_channels": "C0"},
    )
    assert resp.status_code == 200, resp.text
    lines = [l for l in resp.text.strip().split("\n") if l]
    result = json.loads(lines[-1])
    assert result["type"] == "result"
    assert all(r["channel"] == "C0" for r in result["records"])


def test_process_recoverix_no_match_returns_error_event():
    resp = client.post(
        PROCESS_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
        data={"filter_subjects": "doesnotexist"},
    )
    assert resp.status_code == 200, resp.text
    lines = [l for l in resp.text.strip().split("\n") if l]
    result = json.loads(lines[-1])
    assert result["type"] == "error"


def test_process_recoverix_paired_erd():
    resp = client.post(
        PROCESS_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
        data={
            "subbands": "alpha", "features": "mav",
            "recoverix_erd_methods": "paired",
            "erd_baseline_task": "Left", "erd_target_task": "Right",
        },
    )
    assert resp.status_code == 200, resp.text
    lines = [l for l in resp.text.strip().split("\n") if l]
    result = json.loads(lines[-1])
    assert result["type"] == "result"
    # Metode paired terpilih: intra-trial tidak dihitung, paired dihitung.
    assert result["erd_records"] == []
    assert "erd_paired_records" in result


def test_process_recoverix_intratrial_only_skips_paired():
    resp = client.post(
        PROCESS_URL,
        files={"file": ("sess.zip", _make_two_session_zip().getvalue(), "application/zip")},
        data={
            "subbands": "alpha", "features": "mav",
            "recoverix_erd_methods": "intratrial",
        },
    )
    assert resp.status_code == 200, resp.text
    lines = [l for l in resp.text.strip().split("\n") if l]
    result = json.loads(lines[-1])
    assert result["type"] == "result"
    assert len(result["erd_records"]) > 0
    assert result["erd_paired_records"] == []


def test_scan_edf_still_reports_data_type_edf():
    # ZIP tanpa EDF & tanpa sesi recoveriX -> 422 (bukan crash).
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("notes/readme.txt", "kosong")
    zbuf.seek(0)
    resp = client.post(
        SCAN_URL,
        files={"file": ("x.zip", zbuf.getvalue(), "application/zip")},
    )
    assert resp.status_code == 422
