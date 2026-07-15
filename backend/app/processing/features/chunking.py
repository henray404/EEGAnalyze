"""
Modul chunking — Pipeline Chunking & Chain Encoding untuk sinyal EEG.

Mengadopsi format output dan alur kerja dari ``chunking (1).py`` namun:
  * Menambah 3 fitur frequency-domain (band_power, relative_power,
    peak_frequency) selain time-domain (mav, variance, std).
  * TIDAK melakukan double bandpass filtering (sinyal tidak dibandpass
    secara global lebih dulu; cukup bandpass per-subband di dalam chunk).
  * Mendukung toggle task segmentation (task-aware atau whole-file).
  * Chain encoding configurable — user pilih fitur mana yang di-chain.
  * Batch orchestration EEGET-ALS: 170 subjek x 9 skenario.

Posisi di pipeline:
  EDF -> Load -> extract_dataframe() -> [Task Segmentation opsional]
      -> [Chunking] -> Subband filter per chunk -> FE per chunk (6 fitur)
      -> [Chain Encoding] -> [Summary lintas file]

Output (3 file CSV):
  1. output_features.csv  :
     subject_id | scenario | scenario_id | filename | chunk | task |
     channel | subband | feature | feature_value
  2. output_chain.csv     :
     subject_id | scenario | scenario_id | filename | task | channel |
     subband | feature | chain_sequence
  3. output_summary.csv   :
     scenario | scenario_id | task | channel | subband | feature |
     total_files | unique_sequences | most_common_sequence |
     most_common_count | all_sequences | files_list |
     max_common_prefix_length | longest_exact_match_count
"""

import os
import logging
from collections import Counter
from functools import lru_cache
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd
from scipy.signal import butter, sosfiltfilt

from app.config import (
    DEFAULT_SUBBANDS, DEFAULT_ENCODING_WINDOW,
    EEGET_ALS_SCENARIOS,
)
from app.processing.io.loader import EEGLoader
from app.processing.features.psd import PSDAnalyzer

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
#  Default config                                                     #
# ------------------------------------------------------------------ #

DEFAULT_CHUNK_DURATION = DEFAULT_ENCODING_WINDOW  # 0.3 detik

# 6 fitur: 3 time-domain + 3 frequency-domain
DEFAULT_CHUNK_FEATURES = [
    "mav", "variance", "std",
    "band_power", "relative_power", "peak_frequency",
]

TIME_DOMAIN_FEATURES = {"mav", "variance", "std"}
FREQ_DOMAIN_FEATURES = {"band_power", "relative_power", "peak_frequency"}

# Floor sampel per chunk. Harus > padlen sosfiltfilt (3*(2*len(sos)+1) ~= 33
# untuk order 5) DAN >= window minimum PSD Welch. 64 beri margin aman supaya
# tiap chunk yang lolos tidak di-nol-kan guard _bandpass_array maupun crash.
_MIN_CHUNK_SAMPLES = 64


# ------------------------------------------------------------------ #
#  Helper: bandpass filter per subband                                #
# ------------------------------------------------------------------ #

@lru_cache(maxsize=256)
def _butter_sos(sfreq, low, high, order=5):
    """SOS koefisien butterworth bandpass (cached per sfreq/low/high/order).

    Pakai second-order sections. Bentuk transfer function (b, a) order tinggi
    tidak stabil numerik untuk subband frekuensi rendah (mis. Delta 0.5-4 Hz)
    dan menghasilkan NaN via filtfilt. SOS jauh lebih stabil. Konsisten dengan
    ``features._bandpass_array`` (fix commit 1cfbce5). Koefisien hanya
    bergantung parameter ini, bukan data, jadi di-cache dan dipakai ulang.
    """
    nyq = 0.5 * sfreq
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    return butter(order, [low_n, high_n], btype="band", output="sos")


def _bandpass_array(data, sfreq, low, high, order=5):
    """Bandpass filter pada array numpy 1-D (per-subband, single pass).

    SOS + sosfiltfilt + guard panjang minimum. Kalau data lebih pendek dari
    padlen sosfiltfilt, kembalikan nol agar tidak melempar ValueError (chunk
    sependek itu sudah dicegah _MIN_CHUNK_SAMPLES; ini jaring pengaman akhir).
    """
    sos = _butter_sos(sfreq, low, high, order)
    # sosfiltfilt crash kalau len(data) <= padlen; padlen default = min_len.
    # Pakai <= supaya len == padlen ikut dijaring (bukan cuma < ).
    min_len = 3 * (2 * len(sos) + 1)
    if len(data) <= min_len:
        return np.zeros_like(data)
    return sosfiltfilt(sos, data)


# Ambang minimal unit kerja sebelum parallelisasi proses dipakai. Di bawah
# ini overhead spawn proses lebih besar dari kerjanya, jadi tetap serial.
_PARALLEL_MIN_UNITS = 8


def _chunk_unit_rows(args):
    """Worker: hitung semua row chunk untuk satu (task, channel).

    Module-level + argumen picklable (numpy array + tuple) supaya bisa
    dijalankan di ProcessPoolExecutor pada Windows (spawn).
    """
    task, occurrence, ch, signal, sfreq, chunk_samples, subband_items, features = args
    rows = []
    n_chunks = len(signal) // chunk_samples
    subbands_dict = dict(subband_items)
    want_freq = bool(FREQ_DOMAIN_FEATURES & set(features))
    want_time = bool(TIME_DOMAIN_FEATURES & set(features))
    for ci in range(n_chunks):
        start = ci * chunk_samples
        chunk_signal = signal[start:start + chunk_samples]

        # Fitur frekuensi: satu PSD Welch per chunk dari sinyal MENTAH
        # (bukan per-subband filtered), lalu band_power/relative_power/
        # peak_frequency per subband. relative_power jadi porsi power
        # sebenarnya karena pembaginya total power seluruh spektrum, bukan
        # band itu sendiri (bug lama: sinyal sudah dibandpass duluan).
        freq_map = {}
        if want_freq:
            psds, freqs = PSDAnalyzer.compute_psd_array(
                chunk_signal, sfreq, method="welch",
                fmin=0.0, fmax=sfreq / 2.0,
            )
            bp_df = PSDAnalyzer.compute_band_power_from_psd(
                psds, freqs, ["_"], subbands_dict,
            )
            for _, r in bp_df.iterrows():
                freq_map[r["subband"]] = r

        for sb_name, (low, high) in subband_items:
            row = {"chunk": ci, "channel": ch, "subband": sb_name}
            if occurrence is not None:
                row = {"task": task, "occurrence": occurrence, **row}
            elif task is not None:
                row = {"task": task, **row}
            filtered = (_bandpass_array(chunk_signal, sfreq, low, high)
                        if want_time else None)
            fm = freq_map.get(sb_name)
            for feat in features:
                if feat in TIME_DOMAIN_FEATURES:
                    row[feat] = _compute_time_feature(feat, filtered)
                elif feat in FREQ_DOMAIN_FEATURES:
                    row[feat] = float(fm[feat]) if fm is not None else 0.0
                else:
                    row[feat] = 0.0
            rows.append(row)
    return rows


def _run_chunk_units(units, parallel, max_workers):
    """Jalankan list unit kerja chunk, serial atau via ProcessPoolExecutor.

    Urutan output mengikuti urutan ``units`` (ex.map menjaga urutan), jadi
    DataFrame hasil identik dengan eksekusi serial.
    """
    use_parallel = parallel and len(units) >= _PARALLEL_MIN_UNITS
    rows = []
    if use_parallel:
        workers = max_workers or os.cpu_count() or 1
        workers = max(1, min(workers, len(units)))
        try:
            with ProcessPoolExecutor(max_workers=workers) as ex:
                for part in ex.map(_chunk_unit_rows, units):
                    rows.extend(part)
            return rows
        except Exception as exc:
            # Fallback aman: kalau pool gagal (mis. nested daemon proses),
            # jalankan serial supaya hasil tetap keluar.
            logger.warning("Parallel chunking gagal (%s), fallback serial", exc)
            rows = []
    for unit in units:
        rows.extend(_chunk_unit_rows(unit))
    return rows


def _compute_time_feature(feat, filtered):
    """Hitung satu fitur time-domain dari sinyal yang sudah di-bandpass.

    Fitur frequency-domain (band_power, relative_power, peak_frequency)
    TIDAK lagi dihitung di sini; dihitung sekali per chunk via Welch PSD
    di ``_chunk_unit_rows``.
    """
    if feat == "mav":
        return float(np.mean(np.abs(filtered)))
    if feat == "variance":
        return float(np.var(filtered))
    if feat == "std":
        return float(np.std(filtered))
    return 0.0


# ------------------------------------------------------------------ #
#  Class utama                                                        #
# ------------------------------------------------------------------ #

class ChunkingPipeline:
    """Pipeline Chunking & Chain Encoding untuk sinyal EEG."""

    # ============================================================== #
    #  1. Chunked Feature Extraction                                   #
    # ============================================================== #

    @staticmethod
    def compute_chunked_subband_features(df, channels, sfreq,
                                          chunk_duration=DEFAULT_CHUNK_DURATION,
                                          subbands=None, features=None,
                                          parallel=False, max_workers=None):
        """Hitung fitur per chunk per channel per subband.

        Sinyal dipotong menjadi chunk non-overlapping sepanjang
        ``chunk_duration`` detik. Chunk terakhir yang tidak penuh dibuang.
        Sinyal TIDAK dibandpass secara global terlebih dahulu — bandpass
        dilakukan per-subband di dalam setiap chunk.

        Returns
        -------
        pd.DataFrame
            Kolom: [chunk, channel, subband] + fitur.
        """
        if subbands is None:
            subbands = DEFAULT_SUBBANDS
        if features is None:
            features = DEFAULT_CHUNK_FEATURES

        chunk_samples = int(chunk_duration * sfreq)
        if chunk_samples < _MIN_CHUNK_SAMPLES:
            logger.warning(
                "chunk_duration %.3fs pada sfreq %s Hz menghasilkan "
                "%d sampel (< %d). Kembalikan DataFrame kosong.",
                chunk_duration, sfreq, chunk_samples, _MIN_CHUNK_SAMPLES,
            )
            return pd.DataFrame()

        subband_items = list(subbands.items())
        units = [
            (None, None, ch, df[ch].values, sfreq, chunk_samples,
             subband_items, features)
            for ch in channels
            if ch in df.columns and len(df[ch].values) // chunk_samples > 0
        ]
        rows = _run_chunk_units(units, parallel, max_workers)
        return pd.DataFrame(rows)

    @staticmethod
    def compute_task_chunked_features(loader, df, channels, tasks,
                                       chunk_duration=DEFAULT_CHUNK_DURATION,
                                       subbands=None, features=None,
                                       parallel=False, max_workers=None):
        """Hitung fitur per chunk per task per channel per subband.

        Segment per task diekstrak dari annotations EDF, lalu di-chunk
        secara terpisah. Semua unit (task x channel) dikumpulkan dulu lalu
        dijalankan dalam satu pool proses (kalau ``parallel=True``) supaya
        tidak ada overhead spawn berulang per task.

        Returns
        -------
        pd.DataFrame
            Kolom: [task, chunk, channel, subband] + fitur.
        """
        if subbands is None:
            subbands = DEFAULT_SUBBANDS
        if features is None:
            features = DEFAULT_CHUNK_FEATURES

        sfreq = loader.sfreq
        chunk_samples = int(chunk_duration * sfreq)
        if chunk_samples < _MIN_CHUNK_SAMPLES:
            logger.warning(
                "chunk_duration %.3fs pada sfreq %s Hz menghasilkan "
                "%d sampel (< %d). Kembalikan DataFrame kosong.",
                chunk_duration, sfreq, chunk_samples, _MIN_CHUNK_SAMPLES,
            )
            return pd.DataFrame()

        subband_items = list(subbands.items())
        units = []
        for task in tasks:
            seg = loader.extract_task_segments(df, task)
            if seg.empty:
                continue
            for ch in channels:
                if ch not in seg.columns:
                    continue
                signal = seg[ch].values
                if len(signal) // chunk_samples == 0:
                    continue
                units.append((task, None, ch, signal, sfreq, chunk_samples,
                              subband_items, features))

        rows = _run_chunk_units(units, parallel, max_workers)
        return pd.DataFrame(rows)

    @staticmethod
    def compute_occurrence_chunked_features(loader, df, channels, occurrences,
                                             chunk_duration=DEFAULT_CHUNK_DURATION,
                                             subbands=None, features=None,
                                             parallel=False, max_workers=None):
        """Hitung fitur per chunk per occurrence per channel per subband.

        Sama seperti ``compute_task_chunked_features``, tapi segmentasi per
        occurrence spesifik (``loader.extract_occurrence_segment``) alih-alih
        seluruh task. Dipakai saat user mengisolasi occurrence tertentu
        (mis. cuma "Resting #1") di single-file, supaya chunk + chain
        encoding tetap tersedia untuk seleksi granular itu (sebelumnya cuma
        full-data yang didukung untuk occurrence spesifik).

        Parameters
        ----------
        occurrences : list[tuple[str, int]]
            Daftar (task_name, occurrence_num) yang mau di-chunk.

        Returns
        -------
        pd.DataFrame
            Kolom: [task, occurrence, chunk, channel, subband] + fitur.
        """
        if subbands is None:
            subbands = DEFAULT_SUBBANDS
        if features is None:
            features = DEFAULT_CHUNK_FEATURES

        sfreq = loader.sfreq
        chunk_samples = int(chunk_duration * sfreq)
        if chunk_samples < _MIN_CHUNK_SAMPLES:
            logger.warning(
                "chunk_duration %.3fs pada sfreq %s Hz menghasilkan "
                "%d sampel (< %d). Kembalikan DataFrame kosong.",
                chunk_duration, sfreq, chunk_samples, _MIN_CHUNK_SAMPLES,
            )
            return pd.DataFrame()

        subband_items = list(subbands.items())
        units = []
        for task_name, occ_num in occurrences:
            seg = loader.extract_occurrence_segment(df, task_name, occ_num)
            if seg.empty:
                continue
            for ch in channels:
                if ch not in seg.columns:
                    continue
                signal = seg[ch].values
                if len(signal) // chunk_samples == 0:
                    continue
                units.append((task_name, occ_num, ch, signal, sfreq,
                              chunk_samples, subband_items, features))

        rows = _run_chunk_units(units, parallel, max_workers)
        return pd.DataFrame(rows)

    # ============================================================== #
    #  2. Chain Encoding                                               #
    # ============================================================== #

    @staticmethod
    def compute_chain_encoding(chunked_features_df, features=None):
        """Encode tren antar chunk berturutan.

        chunk[i] > chunk[i-1] -> 1, sebaliknya -> 0. Dilakukan per
        grup (task, channel, subband).

        Parameters
        ----------
        chunked_features_df : pd.DataFrame
            Output ``compute_chunked_subband_features`` atau
            ``compute_task_chunked_features``.
        features : list[str] | None
            Daftar fitur yang akan di-chain. None = semua fitur yang
            tersedia di DataFrame.

        Returns
        -------
        pd.DataFrame
            Kolom: [task?], channel, subband, chunk_from, chunk_to,
            chain_{feat} untuk tiap fitur.
        """
        if chunked_features_df.empty:
            return pd.DataFrame()
        if features is None:
            features = [
                f for f in DEFAULT_CHUNK_FEATURES
                if f in chunked_features_df.columns
            ]

        group_cols = [c for c in ("task", "occurrence", "channel", "subband")
                      if c in chunked_features_df.columns]

        all_rows = []
        for group_key, grp in chunked_features_df.groupby(group_cols):
            grp = grp.sort_values("chunk").reset_index(drop=True)
            if len(grp) < 2:
                continue

            if not isinstance(group_key, tuple):
                group_key = (group_key,)
            group_map = dict(zip(group_cols, group_key))

            chunks = grp["chunk"].values

            transition_rows = []
            for idx in range(len(chunks) - 1):
                row = dict(group_map)
                row["chunk_from"] = int(chunks[idx])
                row["chunk_to"] = int(chunks[idx + 1])
                transition_rows.append(row)

            for feat in features:
                if feat not in grp.columns:
                    continue
                vals = grp[feat].values
                encoded = (vals[1:] > vals[:-1]).astype(int)
                for idx, row in enumerate(transition_rows):
                    row[f"chain_{feat}"] = int(encoded[idx])

            all_rows.extend(transition_rows)

        return pd.DataFrame(all_rows)

    @staticmethod
    def attach_chunk_encoding(chunked_features_df, features=None):
        """Tempel kolom ``{feat}_encoded`` ke tiap baris chunk.

        encoded[i] = 1 jika feat[i] > feat[i-1], else 0. Per grup
        (task?, channel, subband), urut by chunk. Chunk pertama tiap grup
        = None (tak ada pendahulu). Kolom encoded disisipkan tepat setelah
        kolom feature-nya supaya raw + encode bersebelahan di excel.
        """
        if chunked_features_df.empty:
            return chunked_features_df
        if features is None:
            features = [
                f for f in DEFAULT_CHUNK_FEATURES
                if f in chunked_features_df.columns
            ]

        df = chunked_features_df.copy()
        group_cols = [c for c in ("task", "occurrence", "channel", "subband")
                      if c in df.columns]

        for feat in features:
            if feat not in df.columns:
                continue
            enc_col = f"{feat}_encoded"
            df[enc_col] = None
            for _, idx in df.groupby(group_cols).groups.items():
                sub = df.loc[idx].sort_values("chunk")
                order = sub.index.tolist()
                vals = sub[feat].values
                for i in range(1, len(order)):
                    df.at[order[i], enc_col] = int(1 if vals[i] > vals[i - 1] else 0)

        # Susun ulang kolom: tiap feature langsung diikuti kolom encoded-nya.
        ordered = []
        for c in chunked_features_df.columns:
            ordered.append(c)
            if f"{c}_encoded" in df.columns:
                ordered.append(f"{c}_encoded")
        return df[ordered]

    @staticmethod
    def summarize_chain_encoding(chain_df, features=None):
        """Ringkasan chain encoding: sequence string + ratio kenaikan.

        Returns
        -------
        pd.DataFrame
            Kolom: [task?], channel, subband,
            chain_{feat}_sequence, chain_{feat}_increases,
            chain_{feat}_total, chain_{feat}_ratio.
        """
        if chain_df.empty:
            return pd.DataFrame()
        if features is None:
            features = [
                c[len("chain_"):] for c in chain_df.columns
                if c.startswith("chain_")
            ]

        group_cols = [c for c in ("task", "occurrence", "channel", "subband")
                      if c in chain_df.columns]

        rows = []
        for group_key, grp in chain_df.groupby(group_cols):
            grp = grp.sort_values("chunk_from")

            if not isinstance(group_key, tuple):
                group_key = (group_key,)
            row = dict(zip(group_cols, group_key))

            for feat in features:
                col = f"chain_{feat}"
                if col not in grp.columns:
                    continue
                vals = grp[col].values
                sequence = "".join(str(int(v)) for v in vals)
                increases = int(np.sum(vals))
                total = len(vals)
                ratio = round(increases / total, 4) if total > 0 else 0.0

                row[f"chain_{feat}_sequence"] = sequence
                row[f"chain_{feat}_increases"] = increases
                row[f"chain_{feat}_total"] = total
                row[f"chain_{feat}_ratio"] = ratio

            rows.append(row)

        return pd.DataFrame(rows)

    # ============================================================== #
    #  3. Pipeline per file -> Output 1 & Output 2                     #
    # ============================================================== #

    @staticmethod
    def process_single_file(loader, df, channels,
                            chunk_duration=DEFAULT_CHUNK_DURATION,
                            subbands=None, features=None,
                            chain_features=None,
                            use_task_segmentation=True, tasks=None,
                            filename=None,
                            subject_id=None,
                            scenario=None, scenario_id=None):
        """Proses satu file EDF: chunking + FE + chain encoding.

        Parameters
        ----------
        loader : EEGLoader
            Loader yang sudah memuat EDF (butuh ``sfreq`` dan
            ``extract_task_segments`` jika task mode aktif).
        df : pd.DataFrame
            Sinyal EEG (kolom per channel + marker + time).
        channels : list[str]
            Daftar nama channel.
        chunk_duration : float
        subbands : dict | None
        features : list[str] | None
            Fitur yang dihitung per chunk (default: 6 fitur).
        chain_features : list[str] | None
            Fitur yang di-chain (default: semua yang dihitung).
        use_task_segmentation : bool
            Jika True, chunk per task segment. Jika False, chunk seluruh file.
        tasks : list[str] | None
            Daftar task (dipakai jika ``use_task_segmentation=True``).
            None -> ambil dari ``loader.get_task_list()``.
        filename : str | None
        subject_id : str | None
        scenario : str | None
            String label skenario (mis. "scenario5").
        scenario_id : int | None
            Integer label skenario (mis. 5).

        Returns
        -------
        tuple (features_df, chain_df)
            features_df  : long format output 1.
            chain_df     : long format output 2.
        """
        if subbands is None:
            subbands = DEFAULT_SUBBANDS
        if features is None:
            features = DEFAULT_CHUNK_FEATURES

        fname = filename or "EEG.edf"
        subj = subject_id if subject_id is not None else ""
        scen = scenario if scenario is not None else "unknown"
        scen_id = scenario_id if scenario_id is not None else -1

        # --- Chunking + FE ---
        if use_task_segmentation:
            if tasks is None:
                tasks = loader.get_task_list()
            if tasks:
                chunked_df = ChunkingPipeline.compute_task_chunked_features(
                    loader, df, channels, tasks, chunk_duration,
                    subbands, features,
                )
            else:
                # Tidak ada annotations -> fallback whole-file
                chunked_df = ChunkingPipeline.compute_chunked_subband_features(
                    df, channels, loader.sfreq, chunk_duration,
                    subbands, features,
                )
        else:
            chunked_df = ChunkingPipeline.compute_chunked_subband_features(
                df, channels, loader.sfreq, chunk_duration,
                subbands, features,
            )

        if chunked_df.empty:
            return pd.DataFrame(), pd.DataFrame()

        has_task = "task" in chunked_df.columns

        # --- OUTPUT 1: features per chunk (long format) ---
        feat_rows = []
        for _, r in chunked_df.iterrows():
            base = {
                "subject_id": subj,
                "scenario": scen,
                "scenario_id": scen_id,
                "filename": fname,
                "chunk": int(r["chunk"]),
                "task": r["task"] if has_task else "",
                "channel": r["channel"],
                "subband": r["subband"],
            }
            for feat in features:
                if feat not in chunked_df.columns:
                    continue
                row = dict(base)
                row["feature"] = feat
                row["feature_value"] = float(r[feat])
                feat_rows.append(row)
        features_out = pd.DataFrame(feat_rows)

        # --- OUTPUT 2: chain sequence ---
        if chain_features is None:
            chain_features = features
        chain_enc = ChunkingPipeline.compute_chain_encoding(
            chunked_df, chain_features
        )
        chain_sum = ChunkingPipeline.summarize_chain_encoding(
            chain_enc, chain_features
        )

        chain_rows = []
        if not chain_sum.empty:
            for _, r in chain_sum.iterrows():
                for feat in chain_features:
                    seq_col = f"chain_{feat}_sequence"
                    if seq_col not in chain_sum.columns:
                        continue
                    chain_rows.append({
                        "subject_id": subj,
                        "scenario": scen,
                        "scenario_id": scen_id,
                        "filename": fname,
                        "task": r["task"] if has_task else "",
                        "channel": r["channel"],
                        "subband": r["subband"],
                        "feature": feat,
                        "chain_sequence": r[seq_col],
                        "chain_ratio": r.get(f"chain_{feat}_ratio", 0.0),
                    })
        chain_out = pd.DataFrame(chain_rows)

        return features_out, chain_out

    # ============================================================== #
    #  4. Summary lintas file (Output 3)                               #
    # ============================================================== #

    @staticmethod
    def generate_cross_file_summary(all_chain_df):
        """Buat summary perbandingan chain sequence antar file berbeda.

        Grouping: scenario_id, task, channel, subband, feature.
        Membandingkan file-file (subjek berbeda) yang punya konfigurasi
        sama.

        Returns
        -------
        pd.DataFrame
            Kolom summary (lihat docstring modul).
        """
        if all_chain_df.empty:
            return pd.DataFrame()

        # Gunakan scenario_id (int) + scenario (str) sebagai group key
        group_cols = [
            "scenario_id", "scenario", "task",
            "channel", "subband", "feature",
        ]
        group_cols = [c for c in group_cols if c in all_chain_df.columns]
        rows = []

        for group_key, grp in all_chain_df.groupby(group_cols):
            if not isinstance(group_key, tuple):
                group_key = (group_key,)
            group_map = dict(zip(group_cols, group_key))

            sequences = grp["chain_sequence"].tolist()
            filenames = (
                grp["filename"].tolist()
                if "filename" in grp.columns else [""] * len(sequences)
            )
            subjects = (
                grp["subject_id"].tolist()
                if "subject_id" in grp.columns else [""] * len(sequences)
            )
            total_files = len(filenames)

            if total_files < 2:
                continue

            seq_counter = Counter(sequences)
            unique_seqs = len(seq_counter)
            most_common_seq, most_common_count = seq_counter.most_common(1)[0]

            # Longest common prefix antar semua pasangan
            max_common_prefix = 0
            for i in range(len(sequences)):
                for j in range(i + 1, len(sequences)):
                    prefix_len = _common_prefix_length(
                        sequences[i], sequences[j]
                    )
                    if prefix_len > max_common_prefix:
                        max_common_prefix = prefix_len

            file_labels = [
                f"{subj}/{fn}" if subj else fn
                for subj, fn in zip(subjects, filenames)
            ]

            row = dict(group_map)
            row.update({
                "total_files": total_files,
                "unique_sequences": unique_seqs,
                "most_common_sequence": most_common_seq,
                "most_common_count": most_common_count,
                "all_sequences": " | ".join(sequences),
                "files_list": " | ".join(file_labels),
                "max_common_prefix_length": max_common_prefix,
                "longest_exact_match_count": most_common_count,
            })
            rows.append(row)

        return pd.DataFrame(rows)


def _common_prefix_length(s1, s2):
    """Hitung panjang prefix yang sama antara 2 string."""
    n = min(len(s1), len(s2))
    for i in range(n):
        if s1[i] != s2[i]:
            return i
    return n



