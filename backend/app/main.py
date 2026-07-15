import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Root logger belum dikonfigurasi di mana pun -- tanpa ini, logger.warning()
# di seluruh modul (processing/, routers/) cuma nongol lewat handler default
# Python (WARNING+ doang, tanpa timestamp/nama modul). Ini dipanggil sebelum
# router di-import supaya semua log request pertama pun sudah rapi.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from app.routers import single_file, batch, export, ml

app = FastAPI(title="EEG Analysis API", version="2.2.0")

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
