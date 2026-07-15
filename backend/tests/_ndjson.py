"""Helper test untuk endpoint streaming NDJSON.

Sejak semua endpoint proses dibikin real-time (StreamingResponse NDJSON:
tiap baris satu event {type: log|progress|result|error}), response tidak lagi
satu JSON object. Helper ini ekstrak payload event 'result' terakhir (untuk
test sukses) atau detail event 'error' (untuk test yang harusnya gagal).
"""

import json


def ndjson_result(resp):
    """Return payload event 'result' (tanpa field 'type'). Raise kalau error."""
    result = None
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        evt = json.loads(line)
        t = evt.get("type")
        if t == "error":
            raise AssertionError(f"stream error: {evt.get('detail')}")
        if t == "result":
            result = {k: v for k, v in evt.items() if k != "type"}
    assert result is not None, f"tidak ada event result di stream: {resp.text[:300]}"
    return result


def ndjson_error(resp):
    """Return detail event 'error' (atau None kalau tidak ada)."""
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        evt = json.loads(line)
        if evt.get("type") == "error":
            return evt.get("detail")
    return None
