# 0011: extract_occurrence_segment menyatukan occurrence task sama yang berdampingan

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** backend
**Severity:** high

---

## Gejala

Memilih occurrence spesifik (mis. "Thinking pertama") mengambil data yang salah ketika file punya dua kemunculan task sama yang berurutan tanpa marker lain di antaranya. `get_task_occurrences()` menghitung 2 occurrence, tapi `extract_occurrence_segment` cuma menemukan 1 segment gabungan.

## Cara Reproduksi

1. File dengan annotations: `Thinking` [1.0-2.0s], `Thinking` [2.0-3.0s] (berdampingan).
2. `extract_occurrence_segment(df, "Thinking", 2)` -> mengembalikan gabungan 1.0-3.0s atau kosong, bukan segment 2.0-3.0s.

## Root Cause

Fungsi mencari batas segment dari gap index kolom `marker` (`indices[i]-indices[i-1] > 1`). Dua occurrence task sama yang bersebelahan menghasilkan marker kontinu tanpa gap -> menyatu jadi satu segment. Penomoran ini jadi tidak konsisten dengan `get_task_occurrences()` (yang menghitung per-annotation), sehingga `occurrence_num` menunjuk data salah untuk semua ERD/occurrence feature.

## Solusi

Ambil batas segment dari `onset`/`duration` occurrence itu sendiri via `get_task_occurrences()`, bukan dari gap index:

```python
task_occs = [o for o in self.get_task_occurrences() if o["task"] == task_name]
occ = task_occs[occurrence_num - 1]
if occ["duration"] > 0:
    mask = (df["time"] >= occ["onset"]) & (df["time"] < occ["onset"] + occ["duration"])
else:
    mask = df.index == (df["time"] - occ["onset"]).abs().idxmin()
return df[mask].copy()
```

Sekalian: `get_occurrence_pairs` branch reversed salah (`(nxt, nxt)`) -> `(nxt["occurrence"], curr["occurrence"])`.

## File yang Berubah

- `backend/app/processing/loader.py:233-265` (`extract_occurrence_segment`)
- `backend/app/processing/loader.py:291` (`get_occurrence_pairs`)

## Verifikasi

`backend/tests/test_qa_fixes.py::test_adjacent_same_task_occurrences_not_merged` — dua occurrence berdampingan harus tetap terpisah 100 sampel masing-masing.

## Catatan Tambahan

- Prasyarat fitur "proses 1 occurrence" (Thinking pertama). Tanpa fix ini fitur berdiri di atas indexing salah.
- Ditemukan lewat QA audit 2026-07-01.
