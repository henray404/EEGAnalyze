from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import single_file, batch, export, ml

app = FastAPI(title="EEG Analysis API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(single_file.router, prefix="/api/single", tags=["single-file"])
app.include_router(batch.router, prefix="/api/batch", tags=["batch"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(ml.router, prefix="/api/ml", tags=["machine-learning"])


@app.get("/health")
def health():
    return {"status": "ok"}
