/* global React, Icon, ColumnSelect, FeaturePicker, DataPreview */
const { useState: useStateML, useRef: useRefML, useEffect: useEffectML } = React;
const ApiML = window.Api;

// ===================== STEPPER =====================
function Stepper({ steps, current, completed, onJump }) {
  return (
    <div className="stepper-card">
      <div className="stepper">
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            <div
              className={`step-node ${current === i ? 'active' : ''} ${completed.includes(i) ? 'completed' : ''}`}
              onClick={() => onJump(i)}
            >
              <div className={`step-circle ${current === i ? 'active' : ''} ${completed.includes(i) ? 'completed' : ''}`}>
                {completed.includes(i) ? <Icon.Check /> : i + 1}
              </div>
              <div className="step-label">
                <span className="num">STEP {String(i + 1).padStart(2, '0')}</span>
                <span className="name">{step}</span>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-line ${completed.includes(i) && completed.includes(i + 1) ? 'done' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function _formatSizeML(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ===================== STAGE 1: UPLOAD =====================
const _GROUP_COL_RE = /subject|participant|patient|group.?id|subjek|pasien/i;

/** Kolom yang masuk akal jadi label klasifikasi: sedikit kelas, tidak konstan. */
function _targetHint(c) {
  const n = c.n_unique ?? 0;
  if (n < 2) return null;
  if (n === 2) return 'biner';
  if (n <= 10 && !c.is_numeric) return 'cocok jadi target';
  return null;
}

function StageUpload({ onNext, dataset, setDataset, target, setTarget, featureCols, setFeatureCols, groupCol, setGroupCol }) {
  const [uploading, setUploading] = useStateML(false);
  const [error, setError] = useStateML(null);
  const [rawFile, setRawFile] = useStateML(null);
  const [dragging, setDragging] = useStateML(false);
  const fileInputRef = useRefML(null);

  const handleFile = async (f) => {
    if (!f) return;
    setRawFile(f);
    setUploading(true);
    setError(null);
    try {
      const data = await ApiML.mlUpload(f);
      setDataset(data);
      const candidate = data.columns.find(c => !c.is_numeric && c.n_unique > 1 && c.n_unique <= 10)
        || data.columns[0];
      setTarget(candidate?.name || '');
      setGroupCol('');
      setFeatureCols(data.columns.filter(c => c.is_numeric && c.name !== candidate?.name).map(c => c.name));
    } catch (e) {
      setError(e.message || 'Gagal upload');
      setDataset(null);
    } finally {
      setUploading(false);
    }
  };

  const clearDataset = () => {
    setDataset(null); setRawFile(null); setTarget(''); setFeatureCols([]); setGroupCol('');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const allCols = dataset?.columns || [];
  const featureOptions = allCols.filter(c => c.is_numeric && c.name !== target && c.name !== groupCol);
  const groupColOptions = allCols.filter(c => c.name !== target);
  const suggestedGroupCol = !groupCol && groupColOptions.find(c => _GROUP_COL_RE.test(c.name));

  // Target/group bisa berubah setelah fitur dipilih; buang dari daftar fitur
  // supaya kolom label tidak ikut kelatih (kebocoran) tanpa user sadar.
  useEffectML(() => {
    const valid = new Set(featureOptions.map(c => c.name));
    const pruned = featureCols.filter(n => valid.has(n));
    if (pruned.length !== featureCols.length) setFeatureCols(pruned);
  }, [target, groupCol, dataset]);

  const targetCol = allCols.find(c => c.name === target);
  const nNumeric = allCols.filter(c => c.is_numeric).length;
  const missingCells = allCols.reduce((s, c) => s + (c.n_missing || 0), 0);

  const blockers = [];
  if (!dataset) blockers.push('upload dataset');
  else {
    if (!target) blockers.push('pilih kolom target');
    else if ((targetCol?.n_unique ?? 0) < 2) blockers.push('target cuma punya 1 nilai unik');
    if (featureCols.length === 0) blockers.push('pilih minimal 1 kolom fitur');
  }
  const ready = blockers.length === 0;

  return (
    <main data-screen-label="05 ML — Upload">
      <div className="up-grid">
        <div className="card card-pad-lg">
          <div className="eyebrow mb-12">STEP 01 — UPLOAD</div>
          <h3 className="sec-title">Upload Data Fitur</h3>
          <p className="sec-sub">
            File CSV atau Excel hasil ekstraksi fitur EEG dari modul Single File atau Batch.
            Satu baris = satu sampel, satu kolom = satu fitur.
          </p>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          {dataset ? (
            <div className="file-card">
              <div className="file-card-badge"><Icon.Spreadsheet /></div>
              <div className="file-card-info">
                <div className="name">{dataset.filename}</div>
                <div className="meta">
                  {dataset.n_rows.toLocaleString()} baris × {dataset.n_cols} kolom
                  {rawFile ? ` · ${_formatSizeML(rawFile.size)}` : ''}
                </div>
              </div>
              <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>Ganti file</button>
              <button className="file-card-x" title="Hapus dataset" onClick={clearDataset}><Icon.X /></button>
            </div>
          ) : (
            <div className={`dropzone ${dragging ? 'dragover' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}>
              <div className="dz-icon"><Icon.Spreadsheet /></div>
              <div className="dz-title">Drag &amp; drop file CSV atau Excel</div>
              <div className="dz-sub">atau klik untuk pilih file</div>
              <div className="dz-hint">Format: .csv .xlsx .xls — maks 50 MB</div>
            </div>
          )}
          {uploading && (
            <div className="up-status loading"><span className="loading-dot" /> Memuat &amp; menganalisis kolom...</div>
          )}
          {error && (
            <div className="up-status error"><Icon.Info /> <span>{error}</span></div>
          )}
        </div>

        <div className="card card-pad-lg">
          <div className="eyebrow mb-12">RINGKASAN DATASET</div>
          {dataset ? (
            <>
              <div className="ds-stats">
                <div className="ds-stat"><span className="k">Baris</span><span className="v">{dataset.n_rows.toLocaleString()}</span></div>
                <div className="ds-stat"><span className="k">Kolom</span><span className="v">{dataset.n_cols}</span></div>
                <div className="ds-stat"><span className="k">Numerik</span><span className="v">{nNumeric}</span></div>
                <div className="ds-stat"><span className="k">Non-numerik</span><span className="v">{dataset.n_cols - nNumeric}</span></div>
              </div>
              <div className={`ds-note ${missingCells > 0 ? 'warn' : 'ok'}`}>
                <Icon.Info />
                <span>{missingCells > 0
                  ? `${missingCells.toLocaleString()} sel kosong terdeteksi — cara mengisinya diatur di Step 02.`
                  : 'Tidak ada sel kosong terdeteksi.'}</span>
              </div>
              {targetCol && (
                <div className="ds-classes">
                  <div className="ds-classes-head">Distribusi <span className="mono">{targetCol.name}</span></div>
                  {(targetCol.top_values || []).length === 0 && (
                    <div className="ds-note"><Icon.Info /> <span>{targetCol.n_unique.toLocaleString()} nilai unik — terlalu banyak buat jadi label klasifikasi.</span></div>
                  )}
                  {(targetCol.top_values || []).map(tv => {
                    const pct = dataset.n_rows ? (tv.count / dataset.n_rows) * 100 : 0;
                    return (
                      <div className="ds-class" key={tv.value}>
                        <div className="ds-class-head">
                          <span className="ds-class-name">{tv.value}</span>
                          <span className="ds-class-num">{tv.count.toLocaleString()} · {pct.toFixed(1)}%</span>
                        </div>
                        <div className="ds-bar"><i style={{ width: `${Math.max(2, pct)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="ds-placeholder">
              <Icon.Database />
              <p>Statistik dataset (jumlah baris, kolom numerik, sel kosong, distribusi kelas) muncul di sini setelah file diupload.</p>
            </div>
          )}
        </div>
      </div>

      <div className="card card-pad-lg mt-16">
        <div className="eyebrow mb-12">KONFIGURASI KOLOM</div>
        <h3 className="sec-title">Pilih Target &amp; Fitur</h3>
        <p className="sec-sub">Tentukan kolom mana yang jadi label, mana yang jadi input model, dan (opsional) kolom ID subjek.</p>

        <div className="cfg-grid">
          <div className="cfg-col">
            <div className="field">
              <div className="field-head">
                <label>Kolom Target (Label)</label>
                <span className="field-req">wajib</span>
              </div>
              <ColumnSelect columns={allCols} value={target} onChange={setTarget} disabled={!dataset}
                recommend={_targetHint} />
              {targetCol && (targetCol.top_values || []).length > 0 && (
                <div className="field-chips">
                  {targetCol.top_values.map(tv => (
                    <span className="value-chip" key={tv.value}>{tv.value}<i>{tv.count.toLocaleString()}</i></span>
                  ))}
                  {targetCol.n_unique > targetCol.top_values.length && (
                    <span className="value-chip muted">+{targetCol.n_unique - targetCol.top_values.length} lainnya</span>
                  )}
                </div>
              )}
              {targetCol && targetCol.n_unique > 10 && (
                <div className="field-warn">
                  <Icon.Info />
                  <span>{targetCol.n_unique.toLocaleString()} nilai berbeda — kolom ini kemungkinan bukan label.
                  Pilih kolom dengan sedikit kategori (mis. ALS vs Normal).</span>
                </div>
              )}
              {targetCol && targetCol.n_missing > 0 && (
                <div className="field-warn">
                  <Icon.Info />
                  <span>{targetCol.n_missing.toLocaleString()} baris tidak punya label; baris itu dibuang saat training.</span>
                </div>
              )}
            </div>

            <div className="field">
              <div className="field-head">
                <label>Group Column (ID subjek)</label>
                <span className="field-opt">opsional</span>
              </div>
              <ColumnSelect columns={groupColOptions} value={groupCol} onChange={setGroupCol} disabled={!dataset}
                emptyLabel="— tidak ada —" placeholder="— tidak ada —"
                recommend={c => (_GROUP_COL_RE.test(c.name) ? 'mirip ID subjek' : null)} />
              <p className="field-help">
                Kalau satu subjek punya banyak baris (per channel/subband/chunk), pilih kolom ID subjeknya.
                Split train/test jadi group-aware: subjek yang sama tidak muncul di dua sisi sekaligus,
                jadi akurasinya tidak palsu.
              </p>
              {groupCol && (
                <div className="field-ok">
                  <Icon.Check /> <span>Split group-aware pakai kolom <span className="mono">{groupCol}</span>.</span>
                </div>
              )}
              {suggestedGroupCol && (
                <div className="field-warn">
                  <Icon.Info />
                  <span>Kolom <span className="mono">{suggestedGroupCol.name}</span> terlihat seperti ID subjek tapi belum dipilih.</span>
                  <button className="btn-ghost-accent" onClick={() => setGroupCol(suggestedGroupCol.name)}>Pakai ini</button>
                </div>
              )}
            </div>
          </div>

          <div className="cfg-col">
            <div className="field field-grow">
              <div className="field-head">
                <label>Kolom Fitur (numerik)</label>
                <span className="chip-mini accent">{featureCols.length} / {featureOptions.length} dipilih</span>
              </div>
              <FeaturePicker columns={featureOptions} selected={featureCols} onChange={setFeatureCols} disabled={!dataset} />
            </div>
          </div>
        </div>
      </div>

      {dataset && (
        <div className="card card-pad-lg mt-16">
          <div className="eyebrow mb-12">DATA PREVIEW</div>
          <h3 className="sec-title">Preview Data</h3>
          <DataPreview dataset={dataset} target={target} groupCol={groupCol} featureCols={featureCols} />
        </div>
      )}

      <div className="stage-nav">
        <div className={`stage-ready ${ready ? 'ok' : ''}`}>
          {ready
            ? <><Icon.Check /> <span>Siap — target <span className="mono">{target}</span>, {featureCols.length} kolom fitur.</span></>
            : <><Icon.Info /> <span>Belum siap: {blockers.join(', ')}.</span></>}
        </div>
        <button className="btn btn-primary" onClick={onNext} disabled={!ready}>
          Lanjut ke Preprocessing <Icon.Arrow />
        </button>
      </div>
    </main>
  );
}

// ===================== STAGE 2: PREPROCESSING =====================
function StagePreproc({ onBack, onNext, dataset, missingStrategy, setMissingStrategy, normalize, setNormalize, splitPct, setSplitPct, target, featureCols }) {
  const total = dataset?.n_rows || 0;
  const trainN = Math.round(total * splitPct / 100);
  const testN = total - trainN;

  const previewRows = dataset?.preview || [];
  const classCounts = {};
  for (const r of previewRows) {
    const cls = String(r[target] ?? '?');
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }

  const featureStats = (dataset?.columns || []).filter(c => featureCols.includes(c.name)).slice(0, 6);
  const totalMissing = (dataset?.columns || []).filter(c => featureCols.includes(c.name)).reduce((s, c) => s + (c.n_missing || 0), 0);

  return (
    <main data-screen-label="06 ML — Preprocessing">
      <div className="split">
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad">
            <div className="card-header">
              <h3>Penanganan Missing Values</h3>
              <Icon.Info />
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              Pilih cara menangani baris dengan nilai kosong
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <RadioPill checked={missingStrategy === 'drop'} onClick={() => setMissingStrategy('drop')} icon={<Icon.Trash />}>Hapus baris</RadioPill>
              <RadioPill checked={missingStrategy === 'mean'} onClick={() => setMissingStrategy('mean')} icon={<Icon.Chart />} recommended>Isi dengan mean</RadioPill>
              <RadioPill checked={missingStrategy === 'median'} onClick={() => setMissingStrategy('median')} icon={<Icon.Chart />}>Isi dengan median</RadioPill>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-header"><h3>Normalisasi</h3><Icon.Info /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <RadioPill checked={normalize === 'none'} onClick={() => setNormalize('none')} icon={<Icon.X />}>Tidak ada</RadioPill>
              <RadioPill checked={normalize === 'standard'} onClick={() => setNormalize('standard')} icon={<Icon.Spark />} recommended>StandardScaler</RadioPill>
              <RadioPill checked={normalize === 'minmax'} onClick={() => setNormalize('minmax')} icon={<Icon.Sliders />}>MinMaxScaler</RadioPill>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-header">
              <h3>Pembagian Data</h3>
              <span className="chip-mini accent">{splitPct}% / {100 - splitPct}%</span>
            </div>
            <div className="row-between" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              <span>Training: <strong style={{ color: 'var(--text-primary)' }}>{splitPct}%</strong></span>
              <span>Test: <strong style={{ color: 'var(--text-primary)' }}>{100 - splitPct}%</strong></span>
            </div>
            <input type="range" min="60" max="90" step="5" value={splitPct} onChange={e => setSplitPct(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#5B65DC' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              <div className="sub-card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Training</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{trainN.toLocaleString()}</div>
              </div>
              <div className="sub-card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Test</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{testN.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </aside>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad-lg">
            <div className="card-header"><h3>Ringkasan Data</h3></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <StatCardMini label="TOTAL SAMPLES" value={total.toLocaleString()} />
              <StatCardMini label="FITUR" value={featureCols.length} />
              <StatCardMini label="KELAS" value={Object.keys(classCounts).length} />
              <StatCardMini label="TRAINING" value={trainN.toLocaleString()} />
              <StatCardMini label="TEST" value={testN.toLocaleString()} />
              <StatCardMini label="MISSING (fitur)" value={totalMissing} warn={totalMissing > 0} />
            </div>
          </div>

          <div className="card card-pad-lg">
            <div className="card-header"><h3>Distribusi Kelas (dari preview)</h3></div>
            <ClassDistChart counts={classCounts} />
          </div>

          <div className="card card-pad-lg">
            <div className="card-header"><h3>Statistik Fitur Terpilih</h3><Icon.Info /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {featureStats.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pilih fitur dulu di Step 01</span>
              )}
              {featureStats.map(c => (
                <div key={c.name} className="row-between" style={{ padding: '8px 14px', background: 'var(--surface-tint)', borderRadius: 10 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}>{c.name}</span>
                  <span className="chip-mini">{c.dtype} · unique={c.n_unique}{c.n_missing > 0 ? ` · missing=${c.n_missing}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
        <button className="btn btn-soft" onClick={onBack}><Icon.ArrowLeft /> Kembali</button>
        <button className="btn btn-primary" onClick={onNext} disabled={!target || featureCols.length === 0}>
          Lanjut ke Model <Icon.Arrow />
        </button>
      </div>
    </main>
  );
}

function RadioPill({ checked, onClick, icon, children, recommended }) {
  return (
    <button className={`radio-pill ${checked ? 'selected' : ''}`} onClick={onClick}>
      <span className="r-dot" />
      {icon}
      <span>{children}</span>
      {recommended && <span className="recommended">recommended</span>}
    </button>
  );
}

function StatCardMini({ label, value, warn }) {
  return (
    <div className="sub-card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</div>
      {warn && <span className="badge badge-warn" style={{ marginTop: 6 }}>⚠ Perlu dibersihkan</span>}
    </div>
  );
}

function ClassDistChart({ counts }) {
  const keys = Object.keys(counts);
  const containerRef = useRefML(null);
  const [w, setW] = useStateML(700);

  useEffectML(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth || 700);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (keys.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 20 }}>Belum ada data preview untuk distribusi kelas.</div>;
  }
  const max = Math.max(...Object.values(counts));
  // w diukur dari lebar container asli (bukan konstanta 400) supaya viewBox
  // seukuran render sebenarnya -- sebelumnya viewBox 400 dipaksa stretch ke
  // container ~1300px lewat preserveAspectRatio="none", jadi bar dan sudut
  // rounded-nya gepeng (distorsi horizontal ~3x).
  const h = 180, barW = Math.min(80, (w - 80) / keys.length - 20);
  return (
    <div ref={containerRef} style={{ width: '100%' }}>
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 200 }}>
      <defs>
        <linearGradient id="alsG3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C95466" /><stop offset="100%" stopColor="#B13A4C" />
        </linearGradient>
        <linearGradient id="normG3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2D9264" /><stop offset="100%" stopColor="#1F7A52" />
        </linearGradient>
        <linearGradient id="otherG3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7B83E5" /><stop offset="100%" stopColor="#5B65DC" />
        </linearGradient>
      </defs>
      {keys.map((k, i) => {
        const v = counts[k];
        const x = 60 + i * ((w - 80) / keys.length);
        const cx = x + ((w - 80) / keys.length) / 2 - barW / 2;
        const hh = (v / max) * (h - 50);
        const grad = k === 'ALS' ? 'alsG3' : k === 'Normal' ? 'normG3' : 'otherG3';
        return (
          <g key={k}>
            <rect x={cx} y={20 + (h - 50) - hh} width={barW} height={hh} rx="14" ry="14" fill={`url(#${grad})`} />
            <text x={cx + barW / 2} y={h - 18} textAnchor="middle" className="axis-text axis-text-bold">{k}</text>
            <text x={cx + barW / 2} y={20 + (h - 50) - hh - 6} textAnchor="middle" className="axis-text" style={{ fontWeight: 600 }}>{v}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

Object.assign(window, { Stepper, StageUpload, StagePreproc });
