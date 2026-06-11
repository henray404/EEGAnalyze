"""
Modul recoverix — Parser format data mentah recoveriX (g.tec).

Membaca rawData.bin (sinyal float32 little-endian, interleaved 16 EEG + 1 flag)
dan rawDataDescriptor.xml (metadata + daftar trial) menjadi array NumPy dan
struktur trial, siap dibungkus jadi MNE RawArray oleh EEGLoader.
"""

import io
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
