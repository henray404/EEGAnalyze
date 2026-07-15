/* global React, Icon */
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
function StageUpload({ onNext, dataset, setDataset, target, setTarget, featureCols, setFeatureCols, groupCol, setGroupCol }) {
  const [uploading, setUploading] = useStateML(false);
  const [error, setError] = useStateML(null);
  const [rawFile, setRawFile] = useStateML(null);
  const fileInputRef = useRefML(null);

  const _looksLikeGroupCol = (name) => /subject|participant|patient|group.?id/i.test(name);

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

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const allFeatureCols = (dataset?.columns || [])
    .filter(c => c.is_numeric && c.name !== target && c.name !== groupCol)
    .map(c => c.name);
  const groupColOptions = (dataset?.columns || []).filter(c => c.name !== target);
  const suggestedGroupCol = !groupCol && groupColOptions.find(c => _looksLikeGroupCol(c.name));

  return (
    <main data-screen-label="05 ML — Upload">
      <div className="card card-pad-lg">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          <div>
            <div className="eyebrow mb-12">STEP 01 — UPLOAD</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>Upload Data Fitur</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Upload file CSV atau Excel hasil ekstraksi fitur EEG dari modul Single File atau Batch.
            </p>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            {dataset ? (
              <div className="file-card">
                <div className="file-card-badge"><Icon.Spreadsheet /></div>
                <div className="file-card-info">
                  <div className="name">{dataset.filename}</div>
                  <div className="meta">{dataset.n_rows.toLocaleString()} rows × {dataset.n_cols} cols{rawFile ? ` · ${_formatSizeML(rawFile.size)}` : ''}</div>
                </div>
                <button className="file-card-x" onClick={() => { setDataset(null); setRawFile(null); setTarget(''); setFeatureCols([]); setGroupCol(''); }}><Icon.X /></button>
              </div>
            ) : (
              <div className="dropzone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={onDrop}>
                <div className="dz-icon"><Icon.Spreadsheet /></div>
                <div className="dz-title">Drag &amp; drop file CSV atau Excel</div>
                <div className="dz-sub">atau klik untuk pilih file</div>
                <div className="dz-hint">Format: .csv .xlsx — max 50 MB</div>
              </div>
            )}
            {uploading && (
              <div className="row gap-8" style={{ marginTop: 10, background: 'var(--accent-tint)', padding: '8px 14px', borderRadius: 999, fontSize: 12.5, color: 'var(--accent)', fontWeight: 500 }}>
                <span className="loading-dot" />
                Memuat dataset...
              </div>
            )}
            {error && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow mb-12">KONFIGURASI KOLOM</div>
            <h3 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>Pilih Target &amp; Fitur</h3>

            <div className="sub-card mb-12">
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Kolom Target (Label)</div>
              <select value={target} onChange={e => setTarget(e.target.value)}
                disabled={!dataset}
                style={{ width: '100%', padding: '12px 16px', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                <option value="">— pilih kolom —</option>
                {(dataset?.columns || []).map(c => (
                  <option key={c.name} value={c.name}>{c.name} ({c.dtype}, unique={c.n_unique})</option>
                ))}
              </select>
              {target && (
                <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', width: 14, height: 14 }}><Icon.Info /></span> Kolom ini akan dijadikan label klasifikasi
                </div>
              )}
            </div>

            <div className="sub-card mb-12">
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Group Column (opsional)</div>
              <select value={groupCol} onChange={e => setGroupCol(e.target.value)}
                disabled={!dataset}
                style={{ width: '100%', padding: '12px 16px', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                <option value="">— tidak ada —</option>
                {groupColOptions.map(c => (
                  <option key={c.name} value={c.name}>{c.name} ({c.dtype}, unique={c.n_unique})</option>
                ))}
              </select>
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Kalau dataset ini punya banyak baris per subjek (mis. per channel/subband/chunk),
                pilih kolom ID subjek di sini. Split train/test akan jaga supaya subjek yang sama
                tidak pernah nyebrang ke dua-duanya sekaligus (mencegah akurasi bohong).
              </p>
              {groupCol && (
                <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                  <Icon.Info /> Split akan group-aware berdasarkan kolom ini
                </div>
              )}
              {suggestedGroupCol && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 11.5, lineHeight: 1.5 }}>
                  <Icon.Info /> Kolom "{suggestedGroupCol.name}" terlihat seperti ID subjek tapi belum
                  dipilih sebagai Group Column. Kalau ini benar ID subjek, pilih di atas biar split
                  train/test tidak bocor.
                </div>
              )}
            </div>

            <div className="sub-card">
              <div className="row-between mb-12">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Kolom Fitur (numerik)</span>
                <span className="chip-mini">{featureCols.length} / {allFeatureCols.length} dipilih</span>
              </div>
              <div className="row gap-8 mb-12">
                <button className="btn-ghost-accent" onClick={() => setFeatureCols([...allFeatureCols])} disabled={!dataset}>Pilih Semua</button>
                <button className="btn-ghost" onClick={() => setFeatureCols([])} disabled={!dataset}>Hapus Semua</button>
              </div>
              <div className="chip-group" style={{ maxHeight: 240, overflowY: 'auto' }}>
                {allFeatureCols.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dataset ? 'Tidak ada kolom numerik selain target' : 'Upload dataset dulu'}</span>
                ) : allFeatureCols.map(f => {
                  const sel = featureCols.includes(f);
                  return (
                    <button key={f}
                      className={`chip ${sel ? 'selected' : ''}`}
                      style={{ fontSize: 11.5, padding: '5px 12px', height: 28, fontFamily: 'JetBrains Mono, monospace' }}
                      onClick={() => setFeatureCols(sel ? featureCols.filter(x => x !== f) : [...featureCols, f])}>
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {dataset && (
          <>
            <div className="card-divider" />
            <div className="row-between mb-16">
              <div>
                <div className="eyebrow">DATA PREVIEW</div>
                <h3 style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 600 }}>Preview Data ({Math.min(20, dataset.preview.length)} dari {dataset.n_rows.toLocaleString()})</h3>
              </div>
            </div>
            <PreviewTable dataset={dataset} target={target} />

            <div className="card-divider" />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={onNext} disabled={!target || featureCols.length === 0}>
                Lanjut ke Preprocessing <Icon.Arrow />
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function PreviewTable({ dataset, target }) {
  const cols = dataset.columns.map(c => c.name);
  const rows = dataset.preview;
  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table className="dt">
        <thead><tr>
          <th>#</th>
          {cols.map(c => (
            <th key={c} className={c === target ? '' : 'num'}
              style={c === target ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}}>
              {c}{c === target ? ' (target)' : ''}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {cols.map(c => {
                const v = r[c];
                const isTarget = c === target;
                if (isTarget) {
                  const cls = v === 'ALS' ? 'badge-als' : v === 'Normal' ? 'badge-normal' : 'badge-accent';
                  return <td key={c}><span className={`badge ${cls}`}>{v}</span></td>;
                }
                return <td key={c} className="num">{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
