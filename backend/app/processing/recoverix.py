"""
Modul recoverix — Parser format data mentah recoveriX (g.tec).

Membaca rawData.bin (sinyal float32 little-endian, interleaved 16 EEG + 1 flag)
dan rawDataDescriptor.xml (metadata + daftar trial) menjadi array NumPy dan
struktur trial, siap dibungkus jadi MNE RawArray oleh EEGLoader.
"""

import io
import os
import re
import tarfile
import xml.etree.ElementTree as ET

import numpy as np


def parse_descriptor(xml_bytes):
    """Parse rawDataDescriptor.xml.

    Returns dict:
        sfreq        : float
        ch_names     : list[str]
        frame_len    : int   (FrameLengthInSamples)
        trigger_pos  : int   (TriggerPositionInSamples)
        trials       : list[dict] {sample_index, flashing_item, is_valid, is_artifact}
    """
    root = ET.fromstring(xml_bytes)
    frame = root.find("FrameDefinition")
    sfreq = float(frame.findtext("SampleRate"))
    frame_len = int(frame.findtext("FrameLengthInSamples"))
    trigger_pos = int(frame.findtext("TriggerPositionInSamples"))
    ch_names = frame.findtext("Layout").split()

    trials = []
    data = root.find("Data")
    if data is not None:
        for tr in data.findall("Trial"):
            trials.append({
                "sample_index": int(tr.get("sampleIndex")),
                "flashing_item": int(tr.get("FlashingItem")),
                "is_valid": tr.get("IsValid") == "True",
                "is_artifact": tr.get("IsArtifact") == "True",
            })

    return {
        "sfreq": sfreq,
        "ch_names": ch_names,
        "frame_len": frame_len,
        "trigger_pos": trigger_pos,
        "trials": trials,
    }


def read_rawdata_bin(bin_bytes, n_cols, n_eeg):
    """Decode rawData.bin -> array EEG (n_eeg, N_samples), kolom flag dibuang.

    bin_bytes : isi mentah rawData.bin (float32 LE, interleaved n_cols/sample).
    n_cols    : total kolom per sample (n_eeg + 1 flag).
    n_eeg     : jumlah channel EEG yang dipertahankan.
    """
    arr = np.frombuffer(bin_bytes, dtype="<f4")
    if arr.size % n_cols != 0:
        raise ValueError(
            f"Ukuran rawData.bin ({arr.size} float) bukan kelipatan {n_cols}."
        )
    mat = arr.reshape(-1, n_cols)            # (N, n_cols)
    return mat[:, :n_eeg].T.astype(np.float64)  # (n_eeg, N)


_TAR_PATTERN = re.compile(r"rawData(\d+)\.tar\.gz$", re.IGNORECASE)


def find_rawdata_tars(namelist):
    """Dari daftar nama file dalam ZIP, ambil rawData*.tar.gz urut numerik."""
    found = []
    for name in namelist:
        m = _TAR_PATTERN.search(name)
        if m:
            found.append((int(m.group(1)), name))
    found.sort()
    return [name for _, name in found]


def find_recoverix_sessions(namelist):
    """Kelompokkan rawData*.tar.gz dalam ZIP berdasarkan folder induk (sesi).

    Tiap sesi = satu folder yang berisi rawData*.tar.gz miliknya sendiri.
    Tiap grup di-sort numerik berdasarkan nomor blok (rawData1, rawData2, ...).

    Returns
    -------
    list[dict]  [{"session_dir": str, "tar_names": list[str]}], urut session_dir.
    """
    sessions = {}
    for name in namelist:
        m = _TAR_PATTERN.search(name)
        if not m:
            continue
        session_dir = os.path.dirname(name)
        sessions.setdefault(session_dir, []).append((int(m.group(1)), name))

    result = []
    for session_dir in sorted(sessions.keys()):
        tar_names = [name for _, name in sorted(sessions[session_dir])]
        result.append({"session_dir": session_dir, "tar_names": tar_names})
    return result


_RUN_PATTERN = re.compile(r"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$")


def parse_session_path(session_dir):
    """Parse path sesi recoveriX jadi metadata.

    Format yang diharapkan (5 komponen terakhir):
        <event>/<patient_id>/<patient_name>/<scenario>/<run YYYYMMDD_HHMMSS>

    Kalau path punya kurang dari 5 komponen, semua field "unknown".
    Kalau komponen terakhir tidak match format run, field run_date/run_time
    "unknown" tapi event/subject/subject_name/scenario/run tetap diisi -
    sesi tetap diproses, tidak di-skip.
    """
    parts = [p for p in session_dir.replace("\\", "/").split("/") if p]

    unknown = {
        "event": "unknown", "subject": "unknown", "subject_name": "unknown",
        "scenario": "unknown", "run": "unknown",
        "run_date": "unknown", "run_time": "unknown",
    }
    if len(parts) < 5:
        return unknown

    run, scenario, subject_name, subject, event = parts[-1], parts[-2], parts[-3], parts[-4], parts[-5]

    m = _RUN_PATTERN.match(run)
    if not m:
        result = dict(unknown)
        result.update({
            "event": event, "subject": subject, "subject_name": subject_name,
            "scenario": scenario, "run": run,
        })
        return result

    y, mo, d, h, mi, s = m.groups()
    return {
        "event": event,
        "subject": subject,
        "subject_name": subject_name,
        "scenario": scenario,
        "run": run,
        "run_date": f"{y}-{mo}-{d}",
        "run_time": f"{h}:{mi}:{s}",
    }


def read_block_from_tar(tar_bytes):
    """Dari bytes tar.gz, return (bin_bytes, descriptor_dict)."""
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as t:
        bin_bytes = t.extractfile("rawData.bin").read()
        xml_bytes = t.extractfile("rawDataDescriptor.xml").read()
    return bin_bytes, parse_descriptor(xml_bytes)


def load_session(blocks):
    """Gabung beberapa blok rawData jadi satu rekaman.

    blocks : list of (bin_bytes, descriptor_dict), urut blok 1..N.
    Returns dict:
        data     : np.ndarray (n_eeg, N_total)
        ch_names : list[str]
        sfreq    : float
        trials   : list[dict] dengan sample_index sudah digeser ke koordinat gabungan
        meta     : {n_blocks, frame_len, trigger_pos}
    """
    if not blocks:
        raise ValueError("Tidak ada blok rawData untuk dimuat.")

    first = blocks[0][1]
    ch_names = first["ch_names"]
    sfreq = first["sfreq"]
    n_eeg = len(ch_names)
    n_cols = n_eeg + 1

    datas = []
    trials = []
    offset = 0
    for bin_bytes, desc in blocks:
        if desc["ch_names"] != ch_names:
            raise ValueError(
                "Layout channel antar blok rawData berbeda; tidak bisa digabung."
            )
        if desc["sfreq"] != sfreq:
            raise ValueError(
                "SampleRate antar blok rawData berbeda; tidak bisa digabung."
            )
        eeg = read_rawdata_bin(bin_bytes, n_cols=n_cols, n_eeg=n_eeg)
        datas.append(eeg)
        for tr in desc["trials"]:
            shifted = dict(tr)
            shifted["sample_index"] = tr["sample_index"] + offset
            trials.append(shifted)
        offset += eeg.shape[1]

    return {
        "data": np.concatenate(datas, axis=1),
        "ch_names": ch_names,
        "sfreq": sfreq,
        "trials": trials,
        "meta": {
            "n_blocks": len(blocks),
            "frame_len": first["frame_len"],
            "trigger_pos": first["trigger_pos"],
        },
    }
