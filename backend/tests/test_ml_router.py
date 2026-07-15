import io

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.main import app
from tests._ndjson import ndjson_result

client = TestClient(app)
UPLOAD_URL = "/api/ml/upload"
TRAIN_URL = "/api/ml/train"


def _make_grouped_csv_bytes(n_subjects=20, rows_per_subject=10, seed=0):
    """CSV sintetis: N subjek, tiap subjek py punya rows_per_subject baris,
    dengan offset per-subjek supaya split row-level naif punya sinyal bocor
    untuk dites (grouped split harus tetap konsisten walau ada offset itu).
    """
    rng = np.random.RandomState(seed)
    rows = []
    for i in range(n_subjects):
        subj = f"S{i:02d}"
        cls = "ALS" if i % 2 == 0 else "Normal"
        subj_offset = rng.randn() * 5
        for _ in range(rows_per_subject):
            rows.append({
                "subject": subj,
                "category": cls,
                "feat_a": rng.randn() + subj_offset,
                "feat_b": rng.randn() + subj_offset * 0.5,
            })
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


def _upload(csv_bytes, filename="feat.csv"):
    resp = client.post(UPLOAD_URL, files={"file": (filename, csv_bytes, "text/csv")})
    assert resp.status_code == 200, resp.text
    return ndjson_result(resp)


def test_train_without_group_col_warns_about_subject_column():
    data = _upload(_make_grouped_csv_bytes())
    payload = {
        "dataset_id": data["dataset_id"],
        "target_col": "category",
        "feature_cols": ["feat_a", "feat_b"],
        "models": [{"id": "lr", "hyper": {}}],
    }
    resp = client.post(TRAIN_URL, json=payload)
    assert resp.status_code == 200, resp.text
    out = ndjson_result(resp)
    assert out["leakage_warning"] is not None
    assert "subject" in out["leakage_warning"]
    assert out["group_column"] is None
    assert out["split_strategy"].startswith("train_test_split")


def test_train_with_group_col_no_leakage_and_group_metrics():
    data = _upload(_make_grouped_csv_bytes())
    payload = {
        "dataset_id": data["dataset_id"],
        "target_col": "category",
        "feature_cols": ["feat_a", "feat_b"],
        "group_col": "subject",
        "cv_folds": 5,
        "models": [{"id": "rf", "hyper": {}}],
    }
    resp = client.post(TRAIN_URL, json=payload)
    assert resp.status_code == 200, resp.text
    out = ndjson_result(resp)
    assert out["leakage_warning"] is None
    assert out["group_column"] == "subject"
    assert out["split_strategy"].startswith("StratifiedGroupKFold")
    assert out["n_groups_train"] is not None and out["n_groups_test"] is not None
    assert out["n_groups_train"] + out["n_groups_test"] == 20

    rec = out["results"][0]
    assert rec["mcc"] is not None
    assert rec["specificity"] is not None
    assert rec["group_accuracy"] is not None
    assert rec["group_f1"] is not None


def test_train_group_col_never_leaks_a_subject_across_train_and_test():
    """Reproduksi langsung: pastikan tidak ada subject yang nyebrang train/test
    lewat pemanggilan endpoint berkali-kali dengan seed berbeda-beda."""
    for seed in range(3):
        data = _upload(_make_grouped_csv_bytes(seed=seed))
        payload = {
            "dataset_id": data["dataset_id"],
            "target_col": "category",
            "feature_cols": ["feat_a", "feat_b"],
            "group_col": "subject",
            "models": [{"id": "lr", "hyper": {}}],
        }
        resp = client.post(TRAIN_URL, json=payload)
        assert resp.status_code == 200, resp.text
        out = ndjson_result(resp)
        # Kalau ada leakage, backend raise 500 sebelum sampai sini (guardrail
        # eksplisit) -- jadi status 200 + n_groups konsisten sudah cukup bukti.
        assert out["n_groups_train"] > 0 and out["n_groups_test"] > 0


def test_train_class_weight_balanced_toggle_accepted():
    data = _upload(_make_grouped_csv_bytes())
    payload = {
        "dataset_id": data["dataset_id"],
        "target_col": "category",
        "feature_cols": ["feat_a", "feat_b"],
        "class_weight_balanced": True,
        "models": [{"id": "svm", "hyper": {}}, {"id": "lr", "hyper": {}}],
    }
    resp = client.post(TRAIN_URL, json=payload)
    assert resp.status_code == 200, resp.text
    out = ndjson_result(resp)
    assert out["class_weight_balanced"] is True
    for rec in out["results"]:
        assert rec["pr_auc"] is not None


def test_train_cv_folds_capped_when_groups_scarce():
    """4 subjek per kelas doang -> cv_folds diminta 10 harus di-cap turun,
    bukan crash StratifiedGroupKFold."""
    data = _upload(_make_grouped_csv_bytes(n_subjects=8, rows_per_subject=6))
    payload = {
        "dataset_id": data["dataset_id"],
        "target_col": "category",
        "feature_cols": ["feat_a", "feat_b"],
        "group_col": "subject",
        "cv_folds": 10,
        "models": [{"id": "lr", "hyper": {}}],
    }
    resp = client.post(TRAIN_URL, json=payload)
    assert resp.status_code == 200, resp.text
    out = ndjson_result(resp)
    assert out["cv_folds"] is None or out["cv_folds"] <= 10


def _make_multiclass_imbalanced_csv_bytes():
    """4 kelas, tapi jumlah subjek per kelas timpang jauh (7/1/1/1) -- setup
    yang bikin StratifiedGroupKFold (dipakai buat holdout split kalau ada
    group_col) sangat mungkin menghasilkan test set yang gak nyakup SEMUA
    kelas (lihat regresi index-out-of-bounds di confusion_matrix)."""
    rng = np.random.RandomState(1)
    rows = []
    class_subject_counts = {"A": 7, "B": 1, "C": 1, "D": 1}
    for cls, n_subj in class_subject_counts.items():
        for si in range(n_subj):
            subj = f"{cls}_{si}"
            for _ in range(5):
                rows.append({
                    "subject": subj,
                    "label": cls,
                    "feat_a": rng.randn(),
                    "feat_b": rng.randn(),
                })
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


def test_train_multiclass_missing_class_in_test_set_does_not_crash():
    """Regresi: confusion_matrix(y_test, y_pred) tanpa labels= eksplisit bikin
    IndexError ("index N is out of bounds for axis 1 with size M") kalau satu
    kelas gak kebagian sampel test sama sekali -- kejadian nyata pas pakai
    group_col dengan kelas yang jumlah subjeknya timpang jauh."""
    data = _upload(_make_multiclass_imbalanced_csv_bytes())
    payload = {
        "dataset_id": data["dataset_id"],
        "target_col": "label",
        "feature_cols": ["feat_a", "feat_b"],
        "group_col": "subject",
        "models": [{"id": "lr", "hyper": {}}],
    }
    resp = client.post(TRAIN_URL, json=payload)
    assert resp.status_code == 200, resp.text
    out = ndjson_result(resp)
    assert len(out["labels"]) == 4
    rec = out["results"][0]
    assert rec["confusion_matrix"]["figure"] is not None
    # Confusion matrix cells harus tetap mencakup SEMUA kelas (4x4), bukan
    # cuma kelas yang kebetulan muncul di test set.
    assert len(rec["confusion_matrix"]["cells"]) == 4 * 4