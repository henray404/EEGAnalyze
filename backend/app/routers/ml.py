"""
Router ml — Machine Learning pipeline.

Endpoint:
  POST /upload     — load CSV/XLSX, return columns + preview + cached dataset_id
  POST /train      — train multiple models, return metrics + plotly figures
  POST /predict    — predict on new data using a trained model
  GET  /models     — list trained models
"""

import io
import json
import logging
import time
import uuid

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Any

from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, MinMaxScaler, LabelEncoder
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score,
    confusion_matrix, roc_curve, auc,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_DATASETS: Dict[str, pd.DataFrame] = {}
_MODELS: Dict[str, Dict[str, Any]] = {}


def _build_estimator(model_id: str, hyper: Dict[str, Any]):
    if model_id == "svm":
        return SVC(
            kernel=hyper.get("kernel", "rbf"),
            C=float(hyper.get("C", 1.0)),
            probability=True,
            random_state=42,
        )
    if model_id == "rf":
        return RandomForestClassifier(
            n_estimators=int(hyper.get("n_estimators", 100)),
            max_depth=int(hyper.get("max_depth", 10)),
            random_state=42, n_jobs=-1,
        )
    if model_id == "knn":
        return KNeighborsClassifier(
            n_neighbors=int(hyper.get("n_neighbors", 5)),
            metric=hyper.get("metric", "euclidean"),
        )
    if model_id == "lr":
        return LogisticRegression(
            C=float(hyper.get("C", 1.0)),
            solver=hyper.get("solver", "lbfgs"),
            max_iter=1000, random_state=42,
        )
    if model_id == "nb":
        return GaussianNB()
    raise ValueError(f"Unknown model id: {model_id}")


def _model_display_name(model_id: str) -> str:
    return {
        "svm": "SVM",
        "rf": "Random Forest",
        "knn": "K-Nearest Neighbors",
        "lr": "Logistic Regression",
        "nb": "Naive Bayes",
    }.get(model_id, model_id)


def _confusion_matrix_fig(cm: np.ndarray, labels: list, model_name: str) -> dict:
    rows = []
    total = cm.sum()
    for i, row_label in enumerate(labels):
        for j, col_label in enumerate(labels):
            count = int(cm[i, j])
            pct = (count / total * 100) if total > 0 else 0
            rows.append({
                "predicted": col_label,
                "actual": row_label,
                "count": count,
                "pct": pct,
            })

    fig = go.Figure(go.Heatmap(
        x=labels, y=labels, z=cm.tolist(),
        text=[[str(c) for c in row] for row in cm.tolist()],
        texttemplate="%{text}",
        colorscale=[[0, "#EEEFFD"], [1, "#5B65DC"]],
        showscale=False,
        hovertemplate="Actual %{y}<br>Predicted %{x}<br>Count %{z}<extra></extra>",
    ))
    fig.update_layout(
        title=f"Confusion Matrix - {model_name}",
        xaxis_title="Predicted",
        yaxis_title="Actual",
        plot_bgcolor="white", paper_bgcolor="white",
        font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
        margin=dict(l=80, r=20, t=50, b=60),
        height=380,
    )
    return {"figure": json.loads(fig.to_json()), "cells": rows}


def _roc_fig(roc_curves: Dict[str, Dict[str, list]]) -> dict:
    fig = go.Figure()
    colors = ["#5B65DC", "#7B83E5", "#4A53C0", "#8E96EE", "#3A45A8"]
    for i, (name, data) in enumerate(roc_curves.items()):
        fig.add_trace(go.Scatter(
            x=data["fpr"], y=data["tpr"],
            mode="lines", name=f"{name} (AUC={data['auc']:.3f})",
            line=dict(width=2.5, color=colors[i % len(colors)], shape="spline"),
        ))
    fig.add_trace(go.Scatter(
        x=[0, 1], y=[0, 1], mode="lines", name="Random",
        line=dict(width=1.5, color="#6B7593", dash="dash"),
        showlegend=False,
    ))
    fig.update_layout(
        title="ROC Curves",
        xaxis_title="False Positive Rate",
        yaxis_title="True Positive Rate",
        plot_bgcolor="white", paper_bgcolor="white",
        font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
        margin=dict(l=60, r=20, t=50, b=50),
        height=420,
        xaxis=dict(showgrid=True, gridcolor="#E8E9F8", griddash="dash", range=[0, 1]),
        yaxis=dict(showgrid=True, gridcolor="#E8E9F8", griddash="dash", range=[0, 1]),
        legend=dict(orientation="h", y=-0.18, x=0),
    )
    return json.loads(fig.to_json())


def _feature_importance_fig(features: list, importances: list) -> dict:
    pairs = sorted(zip(features, importances), key=lambda x: -x[1])[:20]
    feats, imps = zip(*pairs) if pairs else ([], [])
    fig = go.Figure(go.Bar(
        x=list(imps), y=list(feats), orientation="h",
        marker=dict(color="#5B65DC"),
    ))
    fig.update_layout(
        title="Feature Importance (Top 20)",
        xaxis_title="Importance",
        plot_bgcolor="white", paper_bgcolor="white",
        font=dict(family="Inter, sans-serif", size=11, color="#3F4A7A"),
        margin=dict(l=120, r=20, t=50, b=40),
        height=max(40 * len(feats), 320),
        yaxis=dict(autorange="reversed"),
        xaxis=dict(showgrid=True, gridcolor="#E8E9F8", griddash="dash"),
    )
    return json.loads(fig.to_json())


# ============================================================== #
#  POST /upload                                                   #
# ============================================================== #

@router.post("/upload")
async def ml_upload(file: UploadFile = File(...)):
    fname = (file.filename or "").lower()
    content = await file.read()
    try:
        if fname.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif fname.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="File harus .csv atau .xlsx")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Gagal load: {e}")

    if df.empty:
        raise HTTPException(status_code=422, detail="File kosong")

    dataset_id = str(uuid.uuid4())
    _DATASETS[dataset_id] = df

    columns_info = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        n_unique = int(df[col].nunique(dropna=True))
        n_missing = int(df[col].isna().sum())
        is_numeric = pd.api.types.is_numeric_dtype(df[col])
        columns_info.append({
            "name": col,
            "dtype": dtype,
            "is_numeric": is_numeric,
            "n_unique": n_unique,
            "n_missing": n_missing,
        })

    preview = df.head(20).fillna("").astype(str).to_dict(orient="records")

    return JSONResponse(content={
        "dataset_id": dataset_id,
        "filename": file.filename,
        "n_rows": int(len(df)),
        "n_cols": int(len(df.columns)),
        "columns": columns_info,
        "preview": preview,
    })


# ============================================================== #
#  POST /train                                                    #
# ============================================================== #

class TrainModelSpec(BaseModel):
    id: str
    hyper: Dict[str, Any] = {}


class TrainRequest(BaseModel):
    dataset_id: str
    target_col: str
    feature_cols: List[str]
    missing_strategy: str = "drop"
    normalize: str = "standard"
    test_size: float = 0.2
    cv_folds: int = 5
    models: List[TrainModelSpec]


@router.post("/train")
async def ml_train(req: TrainRequest):
    if req.dataset_id not in _DATASETS:
        raise HTTPException(status_code=404, detail="Dataset tidak ditemukan (re-upload)")
    df = _DATASETS[req.dataset_id].copy()

    if req.target_col not in df.columns:
        raise HTTPException(status_code=400, detail=f"Target col '{req.target_col}' tidak ada")
    missing_features = [c for c in req.feature_cols if c not in df.columns]
    if missing_features:
        raise HTTPException(status_code=400, detail=f"Fitur tidak ada: {missing_features}")
    if not req.feature_cols:
        raise HTTPException(status_code=400, detail="Pilih minimal 1 kolom fitur")

    cols = req.feature_cols + [req.target_col]
    df = df[cols].copy()
    if req.missing_strategy == "drop":
        df = df.dropna()
    elif req.missing_strategy == "mean":
        df[req.feature_cols] = df[req.feature_cols].fillna(df[req.feature_cols].mean())
        df = df.dropna(subset=[req.target_col])
    elif req.missing_strategy == "median":
        df[req.feature_cols] = df[req.feature_cols].fillna(df[req.feature_cols].median())
        df = df.dropna(subset=[req.target_col])

    if df.empty:
        raise HTTPException(status_code=422, detail="Tidak ada data setelah handling missing values")

    numeric_subset = df[req.feature_cols].select_dtypes(include=[np.number])
    if numeric_subset.shape[1] != len(req.feature_cols):
        valid = numeric_subset.columns.tolist()
        raise HTTPException(
            status_code=400,
            detail=f"Kolom fitur harus numerik. Numerik valid: {valid}",
        )
    X = numeric_subset.values

    y_raw = df[req.target_col].values
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_raw)
    label_names = label_encoder.classes_.tolist()

    if len(set(y)) < 2:
        raise HTTPException(status_code=422, detail="Target hanya punya 1 kelas")

    scaler = None
    if req.normalize == "standard":
        scaler = StandardScaler()
        X = scaler.fit_transform(X)
    elif req.normalize == "minmax":
        scaler = MinMaxScaler()
        X = scaler.fit_transform(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=req.test_size, random_state=42, stratify=y,
    )

    results = []
    roc_curves = {}
    best_acc = -1
    best_model_uuid = None

    for spec in req.models:
        name = _model_display_name(spec.id)
        t0 = time.time()
        try:
            estimator = _build_estimator(spec.id, spec.hyper)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            cv_scores = cross_val_score(
                estimator, X_train, y_train,
                cv=min(req.cv_folds, max(2, len(y_train) // 5)),
                scoring="accuracy", n_jobs=-1,
            )
            cv_mean = float(np.mean(cv_scores))
        except Exception as e:
            logger.warning(f"CV failed for {name}: {e}")
            cv_mean = float("nan")

        estimator.fit(X_train, y_train)
        y_pred = estimator.predict(X_test)
        elapsed = time.time() - t0

        avg_strategy = "binary" if len(label_names) == 2 else "macro"
        acc = float(accuracy_score(y_test, y_pred))
        f1 = float(f1_score(y_test, y_pred, average=avg_strategy, zero_division=0))
        prec = float(precision_score(y_test, y_pred, average=avg_strategy, zero_division=0))
        rec = float(recall_score(y_test, y_pred, average=avg_strategy, zero_division=0))

        auc_val = float("nan")
        if len(label_names) == 2 and hasattr(estimator, "predict_proba"):
            try:
                probs = estimator.predict_proba(X_test)[:, 1]
                fpr, tpr, _ = roc_curve(y_test, probs)
                auc_val = float(auc(fpr, tpr))
                roc_curves[name] = {
                    "fpr": fpr.tolist(),
                    "tpr": tpr.tolist(),
                    "auc": auc_val,
                }
            except Exception:
                pass

        cm = confusion_matrix(y_test, y_pred)
        cm_fig = _confusion_matrix_fig(cm, label_names, name)

        feat_imp = None
        if spec.id == "rf" and hasattr(estimator, "feature_importances_"):
            feat_imp = _feature_importance_fig(
                req.feature_cols,
                estimator.feature_importances_.tolist(),
            )

        model_uuid = str(uuid.uuid4())
        _MODELS[model_uuid] = {
            "estimator": estimator,
            "scaler": scaler,
            "label_encoder": label_encoder,
            "feature_cols": req.feature_cols,
            "model_id": spec.id,
            "name": name,
            "accuracy": acc,
            "trained_at": time.time(),
        }

        if acc > best_acc:
            best_acc = acc
            best_model_uuid = model_uuid

        results.append({
            "model_id": spec.id,
            "model_uuid": model_uuid,
            "name": name,
            "accuracy": acc,
            "f1": f1,
            "precision": prec,
            "recall": rec,
            "auc": auc_val if not np.isnan(auc_val) else None,
            "cv_mean": cv_mean if not np.isnan(cv_mean) else None,
            "time_seconds": round(elapsed, 3),
            "confusion_matrix": cm_fig,
            "feature_importance": feat_imp,
        })

    roc_figure = _roc_fig(roc_curves) if roc_curves else None

    return JSONResponse(content={
        "results": results,
        "roc": roc_figure,
        "best_model_uuid": best_model_uuid,
        "labels": label_names,
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "n_features": int(X.shape[1]),
    })


# ============================================================== #
#  POST /predict                                                  #
# ============================================================== #

@router.post("/predict")
async def ml_predict(
    file: UploadFile = File(...),
    model_id: str = Form(...),
):
    if model_id not in _MODELS:
        raise HTTPException(status_code=404, detail="Model belum dilatih (re-train)")
    info = _MODELS[model_id]
    estimator = info["estimator"]
    scaler = info["scaler"]
    label_encoder = info["label_encoder"]
    feat_cols = info["feature_cols"]

    fname = (file.filename or "").lower()
    content = await file.read()
    try:
        if fname.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif fname.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="File harus .csv atau .xlsx")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Gagal load: {e}")

    missing = [c for c in feat_cols if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Kolom fitur hilang: {missing}")

    feat_df = df[feat_cols].copy()
    feat_df = feat_df.fillna(feat_df.mean(numeric_only=True))
    X = feat_df.values
    if scaler is not None:
        X = scaler.transform(X)

    preds = estimator.predict(X)
    labels = label_encoder.inverse_transform(preds)

    confidences = None
    if hasattr(estimator, "predict_proba"):
        probs = estimator.predict_proba(X)
        confidences = probs.max(axis=1).tolist()

    rows = []
    for i in range(len(preds)):
        row = {
            "row": i + 1,
            "prediction": str(labels[i]),
        }
        if confidences is not None:
            row["confidence"] = float(confidences[i])
        for c in feat_cols:
            v = df.iloc[i][c]
            if pd.isna(v):
                row[c] = ""
            elif isinstance(v, (int, float, np.number)):
                row[c] = float(v)
            else:
                row[c] = str(v)
        rows.append(row)

    summary = {"total": len(rows)}
    for label in label_encoder.classes_:
        count = int(np.sum(labels == label))
        summary[str(label)] = count

    return JSONResponse(content={
        "predictions": rows,
        "summary": summary,
        "model_name": info["name"],
        "avg_confidence": float(np.mean(confidences)) if confidences else None,
    })


# ============================================================== #
#  GET /models                                                    #
# ============================================================== #

@router.get("/models")
async def ml_list_models():
    return JSONResponse(content=[
        {
            "model_uuid": uid,
            "model_id": info["model_id"],
            "name": info["name"],
            "accuracy": info["accuracy"],
            "feature_cols": info["feature_cols"],
        }
        for uid, info in _MODELS.items()
    ])
