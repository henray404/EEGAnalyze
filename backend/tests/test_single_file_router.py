import io
import zipfile

from fastapi.testclient import TestClient

from app.main import app
from tests.test_recoverix import make_descriptor, make_bin, make_tar

client = TestClient(app)

UPLOAD_URL = "/api/single/upload"


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
    data = resp.json()
    assert data["format"] == "recoveriX"
    assert data["n_channels"] == 16
    assert set(data["tasks"]) == {"Left", "Right"}
