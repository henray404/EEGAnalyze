"""
Modul chunking â€” Pipeline Chunking & Chain Encoding untuk sinyal EEG.

Mengadopsi format output dan alur kerja dari ``chunking (1).py`` namun:
  * Menambah 3 fitur frequency-domain (band_power, relative_power,
    peak_frequency) selain time-domain (mav, variance, std).
  * TIDAK melakukan double bandpass filtering (sinyal tidak dibandpass
    secara global lebih dulu; cukup bandpass per-subband di dalam chunk).
  * Mendukung toggle task segmentation (task-aware atau whole-file).
  * Chain encoding configurable â€” user pilih fitur mana yang di-chain.
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
from scipy.signal import butter, filtfilt

from app.config import (
    DEFAULT_SUBBANDS, DEFAULT_ENCODING_WINDOW,
    EEGET_ALS_SCENARIOS,
)
from app.processing.features import EEGFeatures
from app.processing.loader import EEGLoader

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

_MIN_CHUNK_SAMPLES = 4


# ------------------------------------------------------------------ #
#  Helper: bandpass filter per subband                                #
# ------------------------------------------------------------------ #

@lru_cache(maxsize=256)
def _butter_coeffs(sfreq, low, high, order=5):
    """Koefisien butterworth bandpass (cached per sfreq/low/high/order).

    Koefisien hanya bergantung pada parameter ini, bukan pada data, jadi
    dihitung sekali lalu dipakai ulang untuk semua chunk/channel. Hasil
    numerik identik dengan menghitung ulang tiap kali.
    """
    nyq = 0.5 * sfreq
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    return butter(order, [low_n, high_n], btype="band")


def _bandpass_array(data, sfreq, low, high, order=5):
    """Bandpass filter pada array numpy 1-D (per-subband, single pass)."""
    b, a = _butter_coeffs(sfreq, low, high, order)
    return filtfilt(b, a, data)


# Ambang minimal unit kerja sebelum parallelisasi proses dipakai. Di bawah
# ini overhead spawn proses lebih besar dari kerjanya, jadi tetap serial.
_PARALLEL_MIN_UNITS = 8


def _chunk_unit_rows(args):
    """Worker: hitung semua row chunk untuk satu (task, channel).

    Module-level + argumen picklable (numpy array + tuple) supaya bisa
    dijalankan di ProcessPoolExecutor pada Windows (spawn).
    """
    task, ch, signal, sfreq, chunk_samples, subband_items, features = args
    rows = []
    n_chunks = len(signal) // chunk_samples
    for ci in range(n_chunks):
        start = ci * chunk_samples
        chunk_signal = signal[start:start + chunk_samples]
        for sb_name, (low, high) in subband_items:
            filtered = _bandpass_array(chunk_signal, sfreq, low, high)
            row = {"chunk": ci, "channel": ch, "subband": sb_name}
            if task is not None:
                row = {"task": task, **row}
            for feat in features:
                row[feat] = _compute_feature(feat, filtered, sfreq, low, high)
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


def _compute_feature(feat, filtered, sfreq, low, high):
    """Hitung satu fitur dari sinyal yang sudah di-bandpass ke subband."""
    if feat == "mav":
        return float(np.mean(np.abs(filtered)))
    if feat == "variance":
        return float(np.var(filtered))
    if feat == "std":
        return float(np.std(filtered))
    if feat == "band_power":
        return EEGFeatures.compute_band_power(filtered, sfreq, low, high)
    if feat == "relative_power":
        return EEGFeatures.compute_relative_power(filtered, sfreq, low, high)
    if feat == "peak_frequency":
        return EEGFeatures.compute_peak_frequency(filtered, sfreq, low, high)
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
        Sinyal TIDAK dibandpass secara global terlebih dahulu â€” bandpass
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
            (None, ch, df[ch].values, sfreq, chunk_samples,
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
                units.append((task, ch, signal, sfreq, chunk_samples,
                              subband_items, features))

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

        has_task = "task" in chunked_features_df.columns
        group_cols = (["task", "channel", "subband"] if has_task
                      else ["channel", "subband"])

        all_rows = []
        for group_key, grp in chunked_features_df.groupby(group_cols):
            grp = grp.sort_values("chunk").reset_index(drop=True)
            if len(grp) < 2:
                continue

            if not isinstance(group_key, tuple):
                group_key = (group_key,)

            chunks = grp["chunk"].values

            transition_rows = []
            for idx in range(len(chunks) - 1):
                if has_task:
                    row = {
                        "task": group_key[0],
                        "channel": group_key[1],
                        "subband": group_key[2],
                    }
                else:
                    row = {
                        "channel": group_key[0],
                        "subband": group_key[1],
                    }
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
        has_task = "task" in df.columns
        group_cols = (["task", "channel", "subband"] if has_task
                      else ["channel", "subband"])

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

        has_task = "task" in chain_df.columns
        group_cols = (["task", "channel", "subband"] if has_task
                      else ["channel", "subband"])

        rows = []
        for group_key, grp in chain_df.groupby(group_cols):
            grp = grp.sort_values("chunk_from")

            if not isinstance(group_key, tuple):
                group_key = (group_key,)

            if has_task:
                row = {"task": group_key[0], "channel": group_key[1],
                       "subband": group_key[2]}
            else:
                row = {"channel": group_key[0], "subband": group_key[1]}

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


# ------------------------------------------------------------------ #
#  5. Batch orchestration EEGET-ALS                                   #
# ------------------------------------------------------------------ #

def _find_edf_path(dataset_root, subject_id, scenario_num):
    """Cari EDF subjek + skenario: dataset_root/idN/time1/scenarioN/EEG.edf."""
    edf_path = os.path.join(
        dataset_root, subject_id, "time1",
        f"scenario{scenario_num}", "EEG.edf",
    )
    if os.path.isfile(edf_path):
        return edf_path
    return None


def _get_subject_ids(dataset_root, subject_range=None):
    """Ambil daftar subject_id (idN) dari folder dataset, sorted numeric."""
    if not os.path.isdir(dataset_root):
        return []

    all_dirs = [
        name for name in os.listdir(dataset_root)
        if os.path.isdir(os.path.join(dataset_root, name))
        and name.startswith("id")
    ]

    def _sort_key(s):
        num = s.replace("id", "")
        try:
            return int(num)
        except ValueError:
            return 999999

    all_dirs.sort(key=_sort_key)

    if subject_range is not None:
        start, end = subject_range
        all_dirs = [
            d for d in all_dirs
            if start <= _sort_key(d) <= end
        ]

    return all_dirs


def process_dataset(dataset_root, subject_range=None, scenarios=None,
                    chunk_duration=DEFAULT_CHUNK_DURATION,
                    subbands=None, features=None,
                    chain_features=None,
                    use_task_segmentation=True,
                    progress_callback=None):
    """Batch chunking+chain encoding untuk EEGET-ALS Dataset.

    Iterasi 170 subjek x 9 skenario, panggil ``process_single_file`` per
    EDF, gabungkan seluruh hasil ke 3 DataFrame besar.

    Parameters
    ----------
    dataset_root : str
        Root folder EEGET-ALS Dataset.
    subject_range : tuple(int, int) | None
        (start, end) inclusive. None = semua subjek id*.
    scenarios : list[int] | None
        Daftar skenario (1..9). None = semua.
    chunk_duration : float
    subbands : dict | None
    features : list[str] | None
        Fitur per chunk (default 6 fitur).
    chain_features : list[str] | None
        Fitur yang di-chain (default sama dengan ``features``).
    use_task_segmentation : bool
        Toggle task segmentation vs whole-file chunking.
    progress_callback : callable | None
        Callback ``(subject_id, scenario, current, total)``.

    Returns
    -------
    tuple
        (features_df, chain_df, summary_df, run_summary)
        - features_df : long format fitur per chunk (output 1)
        - chain_df    : long format chain sequence per grup (output 2)
        - summary_df  : cross-file comparison (output 3)
        - run_summary : dict statistik run (n_success, n_failed, ...)
    """
    if scenarios is None:
        scenarios = list(range(1, 10))
    if subbands is None:
        subbands = DEFAULT_SUBBANDS
    if features is None:
        features = DEFAULT_CHUNK_FEATURES
    if chain_features is None:
        chain_features = features

    subject_ids = _get_subject_ids(dataset_root, subject_range)
    total_tasks = len(subject_ids) * len(scenarios)
    current = 0
    n_failed = 0
    n_success = 0
    n_total_chunks = 0

    all_features = []
    all_chains = []

    for subj_id in subject_ids:
        for sc_num in scenarios:
            current += 1

            edf_path = _find_edf_path(dataset_root, subj_id, sc_num)
            if edf_path is None:
                logger.info("EDF tidak ditemukan: %s scenario%d", subj_id, sc_num)
                n_failed += 1
                if progress_callback:
                    progress_callback(subj_id, sc_num, current, total_tasks)
                continue

            try:
                loader = EEGLoader()
                loader.load_edf(edf_path)
                df = loader.extract_dataframe()
                channels = loader.channel_names

                feat_df, chain_df = ChunkingPipeline.process_single_file(
                    loader=loader,
                    df=df,
                    channels=channels,
                    chunk_duration=chunk_duration,
                    subbands=subbands,
                    features=features,
                    chain_features=chain_features,
                    use_task_segmentation=use_task_segmentation,
                    filename=os.path.basename(edf_path),
                    subject_id=subj_id,
                    scenario=f"scenario{sc_num}",
                    scenario_id=int(sc_num),
                )

                if feat_df.empty:
                    n_failed += 1
                else:
                    all_features.append(feat_df)
                    n_success += 1
                    # Hitung jumlah chunk unik (per file)
                    n_total_chunks += int(
                        feat_df[["channel", "subband", "chunk", "task"]]
                        .drop_duplicates().shape[0]
                    )

                if not chain_df.empty:
                    all_chains.append(chain_df)

            except Exception as exc:
                logger.warning(
                    "Gagal memproses %s/scenario%d: %s",
                    subj_id, sc_num, exc,
                )
                n_failed += 1

            if progress_callback:
                progress_callback(subj_id, sc_num, current, total_tasks)

    features_df = (
        pd.concat(all_features, ignore_index=True) if all_features
        else pd.DataFrame()
    )
    chain_df = (
        pd.concat(all_chains, ignore_index=True) if all_chains
        else pd.DataFrame()
    )
    summary_df = ChunkingPipeline.generate_cross_file_summary(chain_df)

    run_summary = {
        "n_subjects": len(subject_ids),
        "n_scenarios": len(scenarios),
        "n_total_files": total_tasks,
        "n_success": n_success,
        "n_failed": n_failed,
        "n_total_chunks": n_total_chunks,
        "n_feature_rows": int(features_df.shape[0]),
        "n_chain_rows": int(chain_df.shape[0]),
        "n_summary_rows": int(summary_df.shape[0]),
    }

    return features_df, chain_df, summary_df, run_summary


def _task_segments_from_df(df, task_name):
    """Ambil segment task dari DataFrame (tanpa perlu loader)."""
    return df[df["marker"] == task_name].copy()


def _compute_task_chunked_from_df(df, channels, sfreq, tasks,
                                   chunk_duration, subbands, features):
    """Sama seperti compute_task_chunked_features tapi tanpa loader object."""
    all_parts = []
    for task in tasks:
        seg = _task_segments_from_df(df, task)
        if seg.empty:
            continue
        feat_df = ChunkingPipeline.compute_chunked_subband_features(
            seg, channels, sfreq, chunk_duration, subbands, features,
        )
        if feat_df.empty:
            continue
        feat_df.insert(0, "task", task)
        all_parts.append(feat_df)

    if all_parts:
        return pd.concat(all_parts, ignore_index=True)
    return pd.DataFrame()


def process_cached_item(df, channels, sfreq, tasks,
                        chunk_duration=DEFAULT_CHUNK_DURATION,
                        subbands=None, features=None,
                        chain_features=None,
                        use_task_segmentation=True,
                        scale_x10k=False,
                        filename=None, subject_id=None,
                        scenario=None, scenario_id=None):
    """Varian process_single_file yang tidak butuh loader object.

    Dipakai ketika data sudah di-cache (preprocessed) dari batch ZIP.
    ``df`` harus sudah punya kolom ``marker`` kalau task segmentation
    dipakai.

    Returns
    -------
    tuple (features_df, chain_df)
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
    if use_task_segmentation and tasks:
        chunked_df = _compute_task_chunked_from_df(
            df, channels, sfreq, tasks, chunk_duration, subbands, features,
        )
    else:
        chunked_df = ChunkingPipeline.compute_chunked_subband_features(
            df, channels, sfreq, chunk_duration, subbands, features,
        )

    if chunked_df.empty:
        return pd.DataFrame(), pd.DataFrame()

    has_task = "task" in chunked_df.columns

    # --- OUTPUT 1: features per chunk ---
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

    if scale_x10k and not chunked_df.empty and not chain_out.empty:
        feat_cols_to_scale = [f for f in features if f in chunked_df.columns]
        chunked_scaled = chunked_df.copy()
        chunked_scaled[feat_cols_to_scale] = chunked_scaled[feat_cols_to_scale] * 10_000

        chain_enc_s = ChunkingPipeline.compute_chain_encoding(chunked_scaled, chain_features)
        chain_sum_s = ChunkingPipeline.summarize_chain_encoding(chain_enc_s, chain_features)

        if not chain_sum_s.empty:
            scaled_rows = []
            for _, r in chain_sum_s.iterrows():
                for feat in chain_features:
                    seq_col = f"chain_{feat}_sequence"
                    if seq_col not in chain_sum_s.columns:
                        continue
                    row_s = {
                        "channel": r["channel"],
                        "subband": r["subband"],
                        "feature": feat,
                        "chain_sequence_x10k": r[seq_col],
                        "chain_ratio_x10k": r.get(f"chain_{feat}_ratio", 0.0),
                    }
                    if has_task:
                        row_s["task"] = r.get("task", "")
                    scaled_rows.append(row_s)

            scaled_df = pd.DataFrame(scaled_rows)
            merge_keys = ["channel", "subband", "feature"]
            if has_task:
                merge_keys = ["task"] + merge_keys
            chain_out = chain_out.merge(
                scaled_df[merge_keys + ["chain_sequence_x10k", "chain_ratio_x10k"]],
                on=merge_keys,
                how="left",
            )

            if "chain_sequence_x10k" in chain_out.columns:
                def _seq_sim(row):
                    s1 = str(row["chain_sequence"]) if pd.notna(row["chain_sequence"]) else ""
                    s2 = str(row["chain_sequence_x10k"]) if pd.notna(row["chain_sequence_x10k"]) else ""
                    denom = max(len(s1), len(s2))
                    if denom == 0:
                        return float("nan")
                    matches = sum(c1 == c2 for c1, c2 in zip(s1, s2))
                    return round(matches / denom * 100, 2)
                chain_out["similarity_pct"] = chain_out.apply(_seq_sim, axis=1)

    return features_out, chain_out


def process_cached_items(cached_items,
                         chunk_duration=DEFAULT_CHUNK_DURATION,
                         subbands=None, features=None,
                         chain_features=None,
                         use_task_segmentation=True,
                         scale_x10k=False,
                         progress_callback=None):
    """Batch chunking+chain encoding dari cached items.

    Alternatif ``process_dataset`` untuk data yang sudah di-preprocess
    di session_state (hasil batch ZIP). Tidak load EDF ulang.

    Parameters
    ----------
    cached_items : list[dict]
        Tiap item harus punya ``df`` (DataFrame atau path pickle),
        ``channels``, ``sfreq``, ``tasks``, ``subject_id``,
        ``scenario``, ``scenario_id``, ``filename``.
    progress_callback : callable | None

    Returns
    -------
    tuple (features_df, chain_df, summary_df, run_summary)
    """
    if subbands is None:
        subbands = DEFAULT_SUBBANDS
    if features is None:
        features = DEFAULT_CHUNK_FEATURES
    if chain_features is None:
        chain_features = features

    total = len(cached_items)
    n_success = 0
    n_failed = 0
    n_total_chunks = 0

    all_features = []
    all_chains = []

    for idx, item in enumerate(cached_items, start=1):
        subj = item.get("subject_id", "")
        scen = item.get("scenario", "unknown")
        scen_id = item.get("scenario_id", -1)

        # Load df dari pickle jika path
        raw_df = item["df"]
        if isinstance(raw_df, str):
            try:
                raw_df = pd.read_pickle(raw_df)
            except Exception as exc:
                logger.warning("Gagal load cache %s: %s", raw_df, exc)
                n_failed += 1
                if progress_callback:
                    progress_callback(subj, scen_id, idx, total)
                continue

        channels = item.get("channels") or [
            c for c in raw_df.columns if c not in ("time", "marker")
        ]
        sfreq = item["sfreq"]
        tasks = item.get("tasks") or []

        try:
            feat_df, chain_df = process_cached_item(
                df=raw_df,
                channels=channels,
                sfreq=sfreq,
                tasks=tasks,
                chunk_duration=chunk_duration,
                subbands=subbands,
                features=features,
                chain_features=chain_features,
                use_task_segmentation=use_task_segmentation,
                scale_x10k=scale_x10k,
                filename=item.get("filename", "EEG.edf"),
                subject_id=subj,
                scenario=scen,
                scenario_id=scen_id,
            )
        except Exception as exc:
            logger.warning("Gagal memproses %s: %s", item.get("filename"), exc)
            n_failed += 1
            if progress_callback:
                progress_callback(subj, scen_id, idx, total)
            continue

        if feat_df.empty:
            n_failed += 1
        else:
            all_features.append(feat_df)
            n_success += 1
            n_total_chunks += int(
                feat_df[["channel", "subband", "chunk", "task"]]
                .drop_duplicates().shape[0]
            )

        if not chain_df.empty:
            all_chains.append(chain_df)

        if progress_callback:
            progress_callback(subj, scen_id, idx, total)

    features_df = (
        pd.concat(all_features, ignore_index=True) if all_features
        else pd.DataFrame()
    )
    chain_df = (
        pd.concat(all_chains, ignore_index=True) if all_chains
        else pd.DataFrame()
    )
    summary_df = ChunkingPipeline.generate_cross_file_summary(chain_df)

    run_summary = {
        "n_total_files": total,
        "n_success": n_success,
        "n_failed": n_failed,
        "n_total_chunks": n_total_chunks,
        "n_feature_rows": int(features_df.shape[0]),
        "n_chain_rows": int(chain_df.shape[0]),
        "n_summary_rows": int(summary_df.shape[0]),
    }

    return features_df, chain_df, summary_df, run_summary


def process_and_export(dataset_root, output_dir,
                       features_name="output_features.csv",
                       chain_name="output_chain.csv",
                       summary_name="output_summary.csv",
                       **kwargs):
    """Wrapper: jalankan ``process_dataset`` lalu simpan 3 CSV.

    Returns
    -------
    dict  run_summary + path output.
    """
    features_df, chain_df, summary_df, run_summary = process_dataset(
        dataset_root, **kwargs
    )

    os.makedirs(output_dir, exist_ok=True)
    paths = {}

    if not features_df.empty:
        p = os.path.join(output_dir, features_name)
        features_df.to_csv(p, index=False)
        paths["features"] = p

    if not chain_df.empty:
        p = os.path.join(output_dir, chain_name)
        chain_df.to_csv(p, index=False)
        paths["chain"] = p

    if not summary_df.empty:
        p = os.path.join(output_dir, summary_name)
        summary_df.to_csv(p, index=False)
        paths["summary"] = p

    run_summary["output_paths"] = paths
    return run_summary

