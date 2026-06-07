# Batch Viz, Excel Encode & ERD Chunk Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batasi opsi channel di subband plot, ubah format excel (6 desimal + integer + kolom encode), dan tambah tab batch baru yang membandingkan nilai chunk antar 2 kondisi (Feature atau ERD%).

**Architecture:** Empat perubahan independen. (1) FE-only prop swap di single-file. (2) BE: format excel by-type + helper encode di ChunkingPipeline yang menempel kolom `{feat}_encoded` ke records. (3) BE: jalur ERD compare terpisah (`erd_compare_*`) yang tidak menyentuh ERD existing. (4) FE: komponen `ChunkCompareTab` di batch-tabs.jsx dengan toggle mode Feature/ERD%.

**Tech Stack:** FastAPI + openpyxl + pandas (backend), React via Babel standalone tanpa bundler (frontend, komponen global lewat urutan script tag). Tidak ada test framework (per CLAUDE.md) → verifikasi via smoke test python + manual UI.

**Catatan konflik:** File target punya perubahan uncommitted (git status M). Selalu baca state terkini sebelum edit. Jangan ubah signature/behaviour ERD existing.

---

### Task 1: Subband plot — batasi dropdown channel ke channel terpilih

**Files:**
- Modify: `frontend_v2/src/pages/single-file.jsx:710-716` (call site SubbandTab)
- Modify: `frontend_v2/src/pages/single-file.jsx:225-230` (default subbandChannel saat process)

Subband sudah dibatasi (plot pakai `subbandSel`). Masalah hanya dropdown channel pakai `allChannels`. Ganti ke `selectedChannels` dengan fallback.

- [ ] **Step 1: Ganti prop allChannels jadi selectedChannels (dengan fallback)**

Di call site (sekitar line 710-716), ubah baris prop:

```jsx
              <SubbandTab
                file={file} allChannels={selectedChannels.length ? selectedChannels : allChannels} subbands={subbandSel}
                channel={subbandChannel} setChannel={setSubbandChannel}
```

(Hanya bagian `allChannels={...}` yang berubah; baris lain tetap.)

- [ ] **Step 2: Default subbandChannel ke channel terpilih pertama**

Cari blok di `handleProcess`/upload sekitar line 225-230 yang men-set `setSubbandChannel(chs[0])`. Pastikan channel default valid terhadap pilihan. Ubah jadi:

```jsx
      const subChs = selectedChannels.length ? selectedChannels : chs;
      if (subChs.length > 0) setSubbandChannel(subChs[0]);
```

Jika variabel `chs` tidak ada di scope itu, gunakan `allChannels`:

```jsx
      const subChs = selectedChannels.length ? selectedChannels : allChannels;
      if (subChs.length > 0) setSubbandChannel(subChs[0]);
```

- [ ] **Step 3: Verifikasi manual**

Jalankan static server frontend (`cd frontend_v2; python -m http.server 5173`), upload file, pilih subset channel (mis. 3 dari 8), buka tab "Subband Plots". Dropdown channel HANYA menampilkan 3 channel terpilih. Subband plot tampil sesuai `subbandSel`.

- [ ] **Step 4: Commit**

```bash
git add frontend_v2/src/pages/single-file.jsx
git commit -m "feat(single-file): batasi dropdown subband plot ke channel terpilih"
```

---

### Task 2: Excel — format angka by-type (6 desimal float, integer polos)

**Files:**
- Modify: `backend/app/routers/export.py:48-61` (`_write_sheet` loop nilai)

Ganti scientific `0.000000E+00` untuk semua non-meta numerik menjadi dispatch berdasarkan tipe nilai.

- [ ] **Step 1: Ganti blok penulisan cell**

Ganti loop badan (baris ~48-61) jadi:

```python
    for ri, rec in enumerate(records, 2):
        fill = _ALT_FILL if ri % 2 == 0 else None
        for ci, h in enumerate(headers, 1):
            v = rec.get(h)
            if isinstance(v, float):
                v = round(v, 6)
            cell = ws.cell(ri, ci, v)
            cell.border = _THIN
            if fill:
                cell.fill = fill
            if isinstance(v, bool):
                pass  # tampil TRUE/FALSE apa adanya
            elif isinstance(v, int):
                cell.number_format = "0"
                cell.alignment = Alignment(horizontal="right")
            elif isinstance(v, float):
                cell.number_format = "0.000000"
                cell.alignment = Alignment(horizontal="right")
            col_widths[h] = max(col_widths[h], len(str(v if v is not None else "")) + 2)
```

Catatan: `_META_COLS` tidak lagi dipakai di sini; biarkan definisi konstanta (baris 20) untuk kompatibilitas, tidak dihapus.

- [ ] **Step 2: Smoke test endpoint format**

Dari folder `backend/` (venv aktif), jalankan:

```bash
python -c "import openpyxl; from app.routers.export import _write_sheet; wb=openpyxl.Workbook(); ws=wb.active; _write_sheet(ws,[{'channel':'Fp1','chunk':3,'mav':0.123456789,'mav_encoded':1}]); print(ws['B2'].number_format, ws['C2'].number_format, ws['D2'].number_format, ws['C2'].value)"
```

Expected: `0  0.000000  0  3` (chunk=integer `0`, mav=`0.000000`, encoded=`0`).

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/export.py
git commit -m "feat(export): format excel 6 desimal float + integer polos, ganti scientific"
```

---

### Task 3: Encode menempel ke records chunk (raw + encode satu tabel)

**Files:**
- Modify: `backend/app/processing/chunking.py` (tambah method `attach_chunk_encoding` setelah `compute_chain_encoding`, sekitar line 343)
- Modify: `backend/app/routers/batch.py:106-110` (wire di `_process_one_file`)

- [ ] **Step 1: Tambah helper attach_chunk_encoding di ChunkingPipeline**

Sisipkan method ini tepat setelah `compute_chain_encoding` (sebelum `summarize_chain_encoding`, ~line 344). `pd` sudah di-import di file ini.

```python
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
```

- [ ] **Step 2: Wire di _process_one_file (batch.py)**

Di `_process_one_file`, setelah cek `if feat_df.empty: return out` (line ~106-107) dan SEBELUM loop `for record in feat_df.to_dict(...)` (line ~109), tambah:

```python
        if cfg["chunk_mode"]:
            feat_df = ChunkingPipeline.attach_chunk_encoding(feat_df)
```

(`ChunkingPipeline` sudah di-import di batch.py line 14.)

- [ ] **Step 3: Smoke test helper**

Dari `backend/`:

```bash
python -c "import pandas as pd; from app.processing.chunking import ChunkingPipeline as C; df=pd.DataFrame([{'task':'Resting','channel':'Fp1','subband':'Delta','chunk':0,'mav':1.0},{'task':'Resting','channel':'Fp1','subband':'Delta','chunk':1,'mav':2.0},{'task':'Resting','channel':'Fp1','subband':'Delta','chunk':2,'mav':1.5}]); out=C.attach_chunk_encoding(df); print(list(out.columns)); print(out['mav_encoded'].tolist())"
```

Expected: kolom mengandung `'mav','mav_encoded'` bersebelahan; `mav_encoded` = `[None, 1, 0]` (chunk0 kosong, naik 1->2 = 1, turun 2->1.5 = 0).

- [ ] **Step 4: Commit**

```bash
git add backend/app/processing/chunking.py backend/app/routers/batch.py
git commit -m "feat(chunking): tempel kolom encoded per chunk ke records batch"
```

---

### Task 4: Backend ERD compare (jalur terpisah, 2 target task)

**Files:**
- Modify: `backend/app/routers/batch.py:36-45` (`out` dict tambah key)
- Modify: `backend/app/routers/batch.py:122-143` (hitung erd_compare di `_process_one_file`)
- Modify: `backend/app/routers/batch.py:274-277` (Form params baru)
- Modify: `backend/app/routers/batch.py:305-319` (masuk cfg)
- Modify: `backend/app/routers/batch.py:406-434` (agregasi + payload result)

- [ ] **Step 1: Tambah key di out dict**

Di `_process_one_file` (line ~44-45), ubah inisialisasi `out`:

```python
    out = {"filename": edf_path, "records": [], "encoding": [],
           "erd": [], "erd_compare": [], "error": None}
```

- [ ] **Step 2: Hitung erd_compare setelah blok ERD existing**

Tepat setelah blok `if cfg["erd_enabled"] ...` (selesai di line ~143) dan sebelum `except Exception as e` (line ~145), tambah:

```python
        if (cfg.get("erd_compare_enabled") and cfg["chunk_mode"]
                and cfg.get("erd_compare_tasks")):
            try:
                for tname in cfg["erd_compare_tasks"]:
                    erd_c_df = EEGFeatures.compute_erd_ers_paired_chunked(
                        loader, df, channels, tname,
                        subbands=cfg["subbands"],
                        baseline_task=cfg["erd_compare_baseline"],
                        chunk_duration=cfg["chunk_duration"],
                    )
                    if not erd_c_df.empty:
                        for rec in erd_c_df.to_dict(orient="records"):
                            out["erd_compare"].append(
                                {**meta, "filename": edf_path, **rec})
            except Exception:
                pass
```

- [ ] **Step 3: Tambah Form params di process_batch**

Di signature `process_batch` setelah `erd_target_task` (line ~276), tambah:

```python
    erd_compare_enabled: str = Form("false"),
    erd_compare_baseline: str = Form("Resting"),
    erd_compare_tasks: str = Form("Resting,Thinking"),
```

- [ ] **Step 4: Masukkan ke cfg**

Di dict `cfg` (setelah `erd_target_task`, line ~318), tambah:

```python
        "erd_compare_enabled": to_bool(erd_compare_enabled),
        "erd_compare_baseline": erd_compare_baseline,
        "erd_compare_tasks": [t.strip() for t in erd_compare_tasks.split(",") if t.strip()],
```

- [ ] **Step 5: Agregasi + payload result**

Di `event_generator`, ubah baris agregasi (line ~406):

```python
        rec_all, enc_all, erd_all, erd_cmp_all, errs = [], [], [], [], []
```

Di loop agregasi setelah `erd_all.extend(res["erd"])` (line ~415), tambah:

```python
            erd_cmp_all.extend(res.get("erd_compare", []))
```

Di payload result (line ~424-434), tambah field:

```python
            "erd_compare_records": erd_cmp_all,
```

- [ ] **Step 6: Smoke test import + signature**

Dari `backend/`:

```bash
python -c "from app.routers import batch; import inspect; ps=inspect.signature(batch.process_batch).parameters; print('erd_compare_enabled' in ps, 'erd_compare_tasks' in ps)"
```

Expected: `True True`. (Server harus tetap bisa di-import tanpa error.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/batch.py
git commit -m "feat(batch): jalur erd_compare terpisah untuk 2 target task chunked"
```

---

### Task 5: Frontend config — kirim erd_compare ke backend

**Files:**
- Modify: `frontend_v2/src/pages/batch.jsx:143-145` (state baru)
- Modify: `frontend_v2/src/pages/batch.jsx:212-214` (opts kirim)
- Modify: `frontend_v2/src/pages/batch.jsx:504-516` (UI toggle, dalam section Ekstraksi)

- [ ] **Step 1: Tambah state erd compare**

Setelah `const [erdTarget, setErdTarget] = useState('');` (line ~145), tambah:

```jsx
  const [erdCompare, setErdCompare] = useState(false);
```

- [ ] **Step 2: Kirim di opts batchProcessStream**

Di objek opts (setelah `erd_target_task: erdTarget,` line ~214), tambah:

```jsx
        erd_compare_enabled: erdCompare,
        erd_compare_baseline: 'Resting',
        erd_compare_tasks: 'Resting,Thinking',
```

- [ ] **Step 3: Tambah toggle UI di section Ekstraksi**

Di section Ekstraksi, di dalam blok `extractMode === 'chunk'` (setelah penutup `</div>` SliderB durasi chunk, sekitar line 516, masih dalam `{extractMode === 'chunk' && (...)}`), tambah sub-card baru di bawah slider:

```jsx
                {extractMode === 'chunk' && (
                  <div className="sub-card" style={{ marginTop: 12 }}>
                    <ToggleRowB on={erdCompare} onChange={setErdCompare} label="ERD Compare (Resting vs Thinking)" />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Aktifkan untuk chart ERD% chunk per kondisi di tab Chunk Kondisi.</div>
                  </div>
                )}
```

- [ ] **Step 4: Verifikasi manual**

Reload UI, aktifkan mode Chunk → toggle "ERD Compare" muncul. Aktifkan, proses ZIP, cek di Network response payload mengandung `erd_compare_records` (non-kosong jika data punya task Resting & Thinking).

- [ ] **Step 5: Commit**

```bash
git add frontend_v2/src/pages/batch.jsx
git commit -m "feat(batch-ui): kirim config erd_compare ke backend"
```

---

### Task 6: Tab baru ChunkCompareTab (Feature / ERD% toggle)

**Files:**
- Modify: `frontend_v2/src/pages/batch-tabs.jsx` (tambah komponen `ChunkCompareTab` di akhir file; global scope)
- Modify: `frontend_v2/src/pages/batch.jsx:540-552` (daftar tab)
- Modify: `frontend_v2/src/pages/batch.jsx:577-589` (render switch)

Komponen meniru pola `ChartTab` (SVG bar chart, helper `_fmt`, `_emptyTab`, `useStateBT`, `useMemoBT` sudah ada di file). X = chunk index, 2 seri per kondisi (task). Toggle mode Feature (dari `results.records`) / ERD% (dari `results.erd_compare_records`).

- [ ] **Step 1: Tambah komponen ChunkCompareTab di batch-tabs.jsx**

Sisipkan di akhir `batch-tabs.jsx` (setelah komponen terakhir):

```jsx
// ===================== CHUNK COMPARE TAB (chunk index x 2 kondisi) =====================
function ChunkCompareTab({ results }) {
  const records = results?.records || [];
  const erdRecords = results?.erd_compare_records || [];
  const [mode, setMode] = useStateBT('feature'); // 'feature' | 'erd'

  const isChunk = results?.mode === 'chunk';
  const src = mode === 'erd' ? erdRecords : records;

  const idKey = (r) => r.subject || r.scenario || r.filename || '-';
  const ids = useMemoBT(() => Array.from(new Set(src.map(idKey))).sort(), [src]);
  const channels = useMemoBT(() => Array.from(new Set(src.map(r => r.channel).filter(Boolean))).sort(), [src]);
  const subbandsAvail = useMemoBT(() => Array.from(new Set(src.map(r => r.subband).filter(Boolean))).sort(), [src]);
  const featureCols = useMemoBT(() => _detectFeatureCols(records).filter(f => f !== 'chunk'), [records]);
  const tasks = useMemoBT(() => Array.from(new Set(src.map(r => r.task).filter(Boolean))).sort(), [src]);

  const [id, setId] = useStateBT('');
  const [channel, setChannel] = useStateBT('');
  const [subband, setSubband] = useStateBT('');
  const [feature, setFeature] = useStateBT('');
  const [condA, setCondA] = useStateBT('Resting');
  const [condB, setCondB] = useStateBT('Thinking');

  const curId = ids.includes(id) ? id : (ids[0] || '');
  const curCh = channels.includes(channel) ? channel : (channels[0] || '');
  const curSb = subbandsAvail.includes(subband) ? subband : (subbandsAvail[0] || '');
  const curFeat = featureCols.includes(feature) ? feature : (featureCols[0] || 'mav');
  const yKey = mode === 'erd' ? 'erd_ers_pct' : curFeat;

  const seriesFor = (cond) => src
    .filter(r => idKey(r) === curId && r.channel === curCh && r.subband === curSb && r.task === cond)
    .map(r => ({ chunk: Number(r.chunk), y: Number(r[yKey]) }))
    .filter(d => !isNaN(d.chunk) && !isNaN(d.y))
    .sort((a, b) => a.chunk - b.chunk);

  const sA = useMemoBT(() => seriesFor(condA), [src, curId, curCh, curSb, yKey, condA]);
  const sB = useMemoBT(() => seriesFor(condB), [src, curId, curCh, curSb, yKey, condB]);

  if (!isChunk) {
    return _emptyTab('Hanya untuk mode Chunk', 'Pilih mode ekstraksi "Chunk" lalu proses ulang.');
  }
  if (mode === 'erd' && erdRecords.length === 0) {
    return _emptyTab('ERD Compare belum aktif', 'Aktifkan toggle "ERD Compare" di panel Ekstraksi lalu proses ulang.');
  }
  if (src.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch dengan mode Chunk untuk melihat perbandingan.');
  }

  const chunkSet = Array.from(new Set([...sA.map(d => d.chunk), ...sB.map(d => d.chunk)])).sort((a, b) => a - b);
  const mapA = new Map(sA.map(d => [d.chunk, d.y]));
  const mapB = new Map(sB.map(d => [d.chunk, d.y]));
  const allY = [...sA.map(d => d.y), ...sB.map(d => d.y)];
  const maxAbs = allY.reduce((a, b) => Math.abs(b) > a ? Math.abs(b) : a, Number.EPSILON);

  const w = 800, h = 340, pad = 50;
  const groupW = (w - pad - 20) / Math.max(chunkSet.length, 1);
  const barW = Math.min(20, groupW * 0.32);
  const maxH = h - 80;
  const zeroY = 20 + maxH;

  const selStyle = { padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 };
  const colA = '#5B65DC', colB = '#9AA0EC';
  const barY = (v) => v >= 0 ? zeroY - Math.abs(v / maxAbs) * maxH : zeroY;
  const barH = (v) => Math.abs(v / maxAbs) * maxH;

  return (
    <>
      <div className="ctrl-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="chip-group">
          <button className={`chip ${mode === 'feature' ? 'selected' : ''}`} onClick={() => setMode('feature')}>Feature</button>
          <button className={`chip ${mode === 'erd' ? 'selected' : ''}`} onClick={() => setMode('erd')}>ERD%</button>
        </div>
        <select value={curId} onChange={e => setId(e.target.value)} style={selStyle}>
          {ids.map(x => <option key={x} value={x}>ID: {x}</option>)}
        </select>
        <select value={curCh} onChange={e => setChannel(e.target.value)} style={selStyle}>
          {channels.map(x => <option key={x} value={x}>Ch: {x}</option>)}
        </select>
        <select value={curSb} onChange={e => setSubband(e.target.value)} style={selStyle}>
          {subbandsAvail.map(x => <option key={x} value={x}>SB: {x}</option>)}
        </select>
        {mode === 'feature' && (
          <select value={curFeat} onChange={e => setFeature(e.target.value)} style={selStyle}>
            {featureCols.map(x => <option key={x} value={x}>Fitur: {x}</option>)}
          </select>
        )}
        <select value={condA} onChange={e => setCondA(e.target.value)} style={selStyle}>
          {tasks.map(x => <option key={x} value={x}>A: {x}</option>)}
        </select>
        <select value={condB} onChange={e => setCondB(e.target.value)} style={selStyle}>
          {tasks.map(x => <option key={x} value={x}>B: {x}</option>)}
        </select>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="row-between mb-16">
            <span style={{ fontWeight: 600 }}>{mode === 'erd' ? 'ERD%' : curFeat.toUpperCase()} per Chunk · {curCh} / {curSb}</span>
            <span className="row gap-8" style={{ fontSize: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: colA, display: 'inline-block' }} /> {condA}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: colB, display: 'inline-block' }} /> {condB}</span>
            </span>
          </div>
          {chunkSet.length === 0 ? (
            <div className="empty"><p>Tidak ada chunk untuk kombinasi ini.</p></div>
          ) : (
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 360 }}>
              {[0, 0.25, 0.5, 0.75, 1].map(t => (
                <g key={t}>
                  <line x1={pad} x2={w - 20} y1={20 + maxH * (1 - t)} y2={20 + maxH * (1 - t)} className="gridline" />
                  <text x={pad - 6} y={24 + maxH * (1 - t)} textAnchor="end" className="axis-text">{_fmt(t * maxAbs, 2)}</text>
                </g>
              ))}
              {chunkSet.map((ck, gi) => {
                const gx = pad + 10 + gi * groupW + groupW / 2;
                const vA = mapA.has(ck) ? mapA.get(ck) : null;
                const vB = mapB.has(ck) ? mapB.get(ck) : null;
                return (
                  <g key={ck}>
                    {vA !== null && <rect x={gx - barW - 2} y={barY(vA)} width={barW} height={barH(vA)} rx="3" fill={colA} />}
                    {vB !== null && <rect x={gx + 2} y={barY(vB)} width={barW} height={barH(vB)} rx="3" fill={colB} />}
                    <text x={gx} y={h - 12} textAnchor="middle" className="axis-text">{ck}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Daftar tab di batch.jsx**

Di array tab (line ~540-552), tambah entri setelah baris `erd` (chunk mode saja):

```jsx
                ...(results?.mode === 'chunk' ? [{ id: 'chunk-compare', label: 'Chunk Kondisi' }] : []),
```

- [ ] **Step 3: Render switch di batch.jsx**

Di blok render tab (line ~577-589), tambah baris:

```jsx
                {tab === 'chunk-compare' && <ChunkCompareTab results={results} />}
```

- [ ] **Step 4: Verifikasi manual — Feature mode**

Proses ZIP mode Chunk. Buka tab "Chunk Kondisi". Mode default "Feature". Pilih ID, channel, subband, fitur, kondisi A=Resting B=Thinking. Bar chart muncul: X = chunk index, 2 warna per kondisi.

- [ ] **Step 5: Verifikasi manual — ERD% mode**

Aktifkan toggle "ERD Compare" (Task 5) sebelum proses. Setelah proses, di tab Chunk Kondisi klik "ERD%". Chart tampil dari `erd_compare_records`. Jika toggle tidak aktif, tampil hint "ERD Compare belum aktif".

- [ ] **Step 6: Commit**

```bash
git add frontend_v2/src/pages/batch-tabs.jsx frontend_v2/src/pages/batch.jsx
git commit -m "feat(batch): tab Chunk Kondisi bandingkan chunk Feature/ERD per kondisi"
```

---

## Self-Review

- **Spec coverage:** (1) subband restrict → Task 1. (2+3) excel format + encode satu tabel → Task 2 + Task 3. (4) tab baru toggle Feature/ERD% → Task 5 (config) + Task 6 (UI). ERD jalur terpisah → Task 4. Semua section spec tercakup.
- **Type consistency:** helper `attach_chunk_encoding` dipanggil tanpa argumen features (auto-detect). Kolom `{feat}_encoded`. `erd_compare_records` dipakai konsisten BE (batch.py payload) → FE (ChunkCompareTab `results.erd_compare_records`). Kolom ERD chunked: `task, channel, subband, chunk, erd_ers_pct` (dari `compute_erd_ers_paired_chunked`). `chunk` numeric.
- **Placeholder scan:** tidak ada TBD/TODO; semua step berisi kode konkret.
- **Risiko:** `_detectFeatureCols` tidak meng-exclude `chunk` → di-filter manual di ChunkCompareTab (`.filter(f => f !== 'chunk')`). Backend belum punya test → verifikasi smoke + manual.

## Catatan CLAUDE.md
- Tanpa emoji di semua file.
- Jika muncul sesi debugging saat implementasi, catat ke `docs/bugs/` (TEMPLATE.md → NNNN-slug.md, update README index, commit terpisah).
