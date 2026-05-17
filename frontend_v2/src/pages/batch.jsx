/* global React, Icon */
const { useState, useRef: useRefB } = React;
const Api = window.Api;
const AppConfigB = window.AppConfig;
const { FileListTab, DeltaChartTab, TabelDeltaTab, HeatmapTab, ScatterTab, DataTableTab, RingkasanTab } = window;

const SUBBANDS_B = [
  { id: 'delta', name: 'Delta' },
  { id: 'theta', name: 'Theta' },
  { id: 'mu', name: 'Mu' },
  { id: 'alpha', name: 'Alpha' },
  { id: 'low_beta', name: 'Low Beta' },
  { id: 'beta', name: 'Beta' },
  { id: 'high_beta', name: 'High Beta' },
  { id: 'gamma', name: 'Gamma' },
];
const DEFAULT_CHANNELS_B = ['Cz', 'Fz', 'Pz', 'Oz', 'Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8', 'FC1', 'FC2', 'FC5', 'FC6', 'C3', 'C4', 'T7', 'T8', 'CP1', 'CP2', 'CP5', 'CP6', 'P3', 'P4', 'P7', 'P8', 'PO3', 'PO4', 'O1', 'O2', 'FT9', 'FT10'];

function formatSizeB(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChipGroupB({ options, value, onChange }) {
  return (
    <div className="chip-group">
      {options.map(o => {
        const id = typeof o === 'string' ? o : o.id;
        const label = typeof o === 'string' ? o : o.name;
        const selected = value.includes(id);
        return (
          <button key={id} className={`chip ${selected ? 'selected' : ''}`} onClick={() =>
            onChange(selected ? value.filter(v => v !== id) : [...value, id])
          }>{label}</button>
        );
      })}
    </div>
  );
}

function ToggleRowB({ on, onChange, label, bold }) {
  return (
    <div className={`toggle-row ${bold ? 'bold' : ''}`} onClick={() => onChange(!on)} style={{ cursor: 'pointer' }}>
      <span className={`toggle ${on ? 'on' : ''}`} />
      <span>{label}</span>
    </div>
  );
}

function BatchPage() {
  const [file, setFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanMeta, setScanMeta] = useState(null); // {total_files, categories, subjects, scenarios, tasks, channels}
  const [uploadError, setUploadError] = useState(null);
  const [kategori, setKategori] = useState(['ALS', 'Normal']);
  const [tasks, setTasks] = useState([]);
  const [subbands, setSubbands] = useState(['delta', 'theta', 'alpha', 'beta']);
  const [channels, setChannels] = useState([]);
  const [features, setFeatures] = useState(['mav', 'variance', 'std']);
  const [showAllCh, setShowAllCh] = useState(false);
  const [filterMode, setFilterMode] = useState('preset');
  const [notch, setNotch] = useState(true);
  const [notchHz, setNotchHz] = useState('50');
  const [car, setCar] = useState(false);
  const [amp, setAmp] = useState(false);
  const [bad, setBad] = useState(false);
  const [ica, setIca] = useState(false);
  const [icaAuto, setIcaAuto] = useState(true);
  const [icaMethod, setIcaMethod] = useState('fastica');
  const [extractMode, setExtractMode] = useState('chunk');
  const [chunkDur, setChunkDur] = useState(0.5);
  const [tab, setTab] = useState('delta');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null);
  const [apiError, setApiError] = useState(null);
  const fileInputRef = useRefB(null);

  const allChannelsBatch = scanMeta?.channels?.length ? scanMeta.channels : DEFAULT_CHANNELS_B;
  const allTasksBatch = scanMeta?.tasks?.length ? scanMeta.tasks : ['T1', 'T2', 'T3', 'T4'];
  const totalFiles = scanMeta?.total_files || 0;
  const totalSubjects = scanMeta?.subjects?.length || 0;

  const handleUpload = async (f) => {
    if (!f) return;
    setFile(f);
    setUploadError(null);
    setScanning(true);
    setScanned(false);
    setDone(false);
    setResults(null);
    try {
      const data = await Api.batchScan(f);
      setScanMeta(data);
      setTasks(data.tasks || []);
      setChannels((data.channels || []).slice(0, 8));
      setKategori(data.categories || ['ALS', 'Normal']);
      setScanned(true);
    } catch (e) {
      setUploadError(e.message || 'Gagal scan ZIP. Pastikan backend berjalan.');
      setScanMeta(null);
    } finally {
      setScanning(false);
    }
  };

  const onDropZip = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  };

  const handleProcess = async () => {
    if (!file || !scanned) return;
    setProcessing(true); setDone(false); setProgress(0); setFilesProcessed(0); setApiError(null);
    const ticker = setInterval(() => {
      setProgress(p => {
        const np = Math.min(p + Math.random() * 6 + 1, 95);
        if (totalFiles > 0) setFilesProcessed(Math.floor(np / 100 * totalFiles));
        return np;
      });
    }, 300);
    try {
      const data = await Api.batchProcess(file, {
        bp_low: AppConfigB.BP_DEFAULT_LOW,
        bp_high: AppConfigB.BP_DEFAULT_HIGH,
        bp_order: AppConfigB.BP_DEFAULT_ORDER,
        use_notch: notch,
        notch_freq: notchHz,
        use_car: car,
        use_amplitude: amp,
        detect_bad: bad,
        use_ica: ica,
        ica_method: icaMethod,
        ica_n: icaAuto ? null : 5,
        subbands: subbands.join(','),
        features: features.map(f => AppConfigB.FEATURES_BACKEND_MAP[f] || f.toLowerCase()).join(','),
        include_frequency: true,
        chunk_mode: extractMode === 'chunk',
        chunk_duration: chunkDur,
        filter_categories: kategori.join(','),
        filter_tasks: tasks.join(','),
        filter_channels: channels.join(','),
      });
      setResults(data);
      setFilesProcessed(data.processed_files || totalFiles);
      setDone(true);
    } catch (e) {
      setApiError(e.message || 'Gagal proses batch');
    } finally {
      clearInterval(ticker);
      setProgress(100);
      setProcessing(false);
    }
  };

  const handleExportExcelBatch = async () => {
    if (!results || !results.records || results.records.length === 0) return;
    const fname = `batch_features_${Date.now()}.xlsx`;
    try {
      const blob = await Api.exportExcel(
        [{ name: 'Features', records: results.records }], fname,
      );
      window.downloadBlob(blob, fname);
    } catch (e) {
      setApiError(e.message || 'Export gagal');
    }
  };

  const chShown = showAllCh ? allChannelsBatch : allChannelsBatch.slice(0, 8);

  return (
    <main data-screen-label="04 Batch Analysis">
      <div className="page">
        <div className="page-head">
          <div className="page-head-text">
            <div className="crumb">Analisis <Icon.Chev /> Batch</div>
            <h2>Batch Analysis</h2>
            <p className="subtitle">Upload dataset ZIP, filter, dan jalankan pemrosesan paralel multi-thread.</p>
          </div>
          <div className="page-head-actions">
            <button className="fpill"><Icon.Folder /> {file ? `Dataset: ${file.name}` : 'Dataset: not uploaded'} <Icon.ChevDown /></button>
            <button className="fpill"><Icon.Zap /> 4 worker threads</button>
            <button className="btn btn-primary" onClick={handleExportExcelBatch} disabled={!done}><Icon.Download /> Export Excel</button>
          </div>
        </div>

        {/* HERO BANNER */}
        {!done ? (
          <div className="card-hero" style={{ marginBottom: 24 }}>
            <div className="hero-deco" />
            <div className="hero-deco-2" />
            <div className="card-hero-inner row-between" style={{ alignItems: 'center' }}>
              <div>
                <div className="eyebrow">BATCH SUMMARY</div>
                <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6, letterSpacing: '-0.02em' }}>
                  {processing ? `${filesProcessed} / ${totalFiles} file diproses` : scanned ? `${totalFiles} file siap diproses` : '0 file diproses'}
                </div>
                <div style={{ marginTop: 6, opacity: 0.85, fontSize: 14 }}>
                  {processing ? 'Pipeline berjalan paralel pada 4 worker thread' : scanned ? 'Klik "Proses Batch" di panel kiri untuk memulai' : 'Upload dataset untuk memulai'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <HeroIconCircle />
              </div>
            </div>
          </div>
        ) : (
          <BatchResultStrip results={results} totalSubjects={totalSubjects} />
        )}

        <div className="split">
          {/* ============ LEFT ============ */}
          <aside className="split-left">
            {/* SECTION 1: Upload */}
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 01</span>
                <h3>Upload Dataset ZIP</h3>
              </div>
              <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
              {file ? (
                <>
                  <div className="file-card">
                    <div className="file-card-badge"><Icon.Folder /></div>
                    <div className="file-card-info">
                      <div className="name">{file.name}</div>
                      <div className="meta">{formatSizeB(file.size)} · ZIP</div>
                    </div>
                    <button className="file-card-x" onClick={() => {
                      setFile(null); setScanned(false); setScanning(false); setDone(false);
                      setScanMeta(null); setResults(null); setUploadError(null);
                    }}><Icon.X /></button>
                  </div>
                  {scanning && (
                    <div className="row gap-8" style={{ background: 'var(--accent-tint)', padding: '8px 14px', borderRadius: 999, fontSize: 12.5, color: 'var(--accent)', fontWeight: 500 }}>
                      <span className="loading-dot" />
                      Membaca struktur ZIP...
                    </div>
                  )}
                  {uploadError && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
                      {uploadError}
                    </div>
                  )}
                  {scanned && scanMeta && (
                    <div className="sub-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <ScanRow label="Total file EDF" value={scanMeta.total_files} />
                      <ScanRow label="Kategori" value={
                        <>{(scanMeta.categories || []).map(c => (
                          <span key={c} className={`badge ${c === 'ALS' ? 'badge-als' : c === 'Normal' ? 'badge-normal' : 'badge-accent'}`} style={{ marginRight: 4 }}>{c}</span>
                        ))}</>
                      } />
                      <ScanRow label="Subjek" value={(scanMeta.subjects || []).length} />
                      <ScanRow label="Tasks" wrapValue value={
                        <>{(scanMeta.tasks || []).map(t => <span key={t} className="chip-mini" style={{ marginRight: 4 }}>{t}</span>)}</>
                      } />
                      <ScanRow label="Channels" value={(scanMeta.channels || []).length} />
                    </div>
                  )}
                </>
              ) : (
                <div className="dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={onDropZip}>
                  <div className="dz-icon"><Icon.Folder /></div>
                  <div className="dz-title">Drag &amp; drop file .zip</div>
                  <div className="dz-sub">atau klik untuk pilih dataset</div>
                  <div className="dz-hint">ZIP: folder ALS/ dan Normal/</div>
                </div>
              )}
            </div>

            {/* SECTION 2: Filter Dataset */}
            {scanned && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">STEP 02</span>
                  <h3>Filter Dataset</h3>
                </div>
                <FilterGroupB label="Kategori" counter={`${kategori.length}/${(scanMeta?.categories || ['ALS', 'Normal']).length}`}>
                  <ChipGroupB options={scanMeta?.categories || ['ALS', 'Normal']} value={kategori} onChange={setKategori} />
                </FilterGroupB>
                <FilterGroupB label="Task" counter={`${tasks.length}/${allTasksBatch.length}`}>
                  <ChipGroupB options={allTasksBatch} value={tasks} onChange={setTasks} />
                </FilterGroupB>
                <FilterGroupB label="Subband" counter={`${subbands.length}/5`}>
                  <ChipGroupB options={SUBBANDS_B} value={subbands} onChange={setSubbands} />
                </FilterGroupB>
                <FilterGroupB label="Channel" counter={`${channels.length}/${allChannelsBatch.length}`}>
                  <div className="chip-group">
                    {chShown.map(c => {
                      const sel = channels.includes(c);
                      return <button key={c} className={`chip ${sel ? 'selected' : ''}`} style={{ fontSize: 11.5, padding: '5px 12px', height: 28 }} onClick={() =>
                        setChannels(sel ? channels.filter(x => x !== c) : [...channels, c])
                      }>{c}</button>;
                    })}
                    {!showAllCh && allChannelsBatch.length > 8 && (
                      <button className="chip" style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)', fontSize: 11.5, padding: '5px 12px', height: 28 }} onClick={() => setShowAllCh(true)}>+ {allChannelsBatch.length - 8} more</button>
                    )}
                  </div>
                </FilterGroupB>
                <FilterGroupB label="Fitur Statistik" counter={`${features.length}/5`}>
                  <ChipGroupB options={[
                    { id: 'mav', name: 'MAV' }, { id: 'variance', name: 'Variance' }, { id: 'std', name: 'STD' },
                    { id: 'psd', name: 'PSD' }, { id: 'band_power', name: 'BandPower' },
                  ]} value={features} onChange={setFeatures} />
                </FilterGroupB>
              </div>
            )}

            {/* SECTION 3: Filter Sinyal */}
            {scanned && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">STEP 03</span>
                  <h3>Filter Sinyal</h3>
                </div>
                <div className="sub-card">
                  <div className="row-between mb-12">
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>Bandpass Filter</span>
                  </div>
                  <div className="chip-group">
                    <button className={`chip ${filterMode === 'preset' ? 'selected' : ''}`} onClick={() => setFilterMode('preset')}>Preset Subband</button>
                    <button className={`chip ${filterMode === 'custom' ? 'selected' : ''}`} onClick={() => setFilterMode('custom')}>Custom Range</button>
                  </div>
                </div>
                <div className="sub-card">
                  <ToggleRowB on={notch} onChange={setNotch} label="Notch Filter" />
                  {notch && (
                    <div className="chip-group mt-12">
                      <button className={`chip ${notchHz === '50' ? 'selected' : ''}`} onClick={() => setNotchHz('50')}>50 Hz</button>
                      <button className={`chip ${notchHz === '60' ? 'selected' : ''}`} onClick={() => setNotchHz('60')}>60 Hz</button>
                    </div>
                  )}
                </div>
                <div className="sub-card"><ToggleRowB on={car} onChange={setCar} label="CAR (Common Avg Reference)" /></div>
                <div className="sub-card"><ToggleRowB on={amp} onChange={setAmp} label="Amplitude Filter (clip ±100 µV)" /></div>
                <div className="sub-card"><ToggleRowB on={bad} onChange={setBad} label="Deteksi Bad Channel (MAD)" /></div>
              </div>
            )}

            {/* SECTION 4: ICA */}
            {scanned && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">STEP 04</span>
                  <h3>ICA Artifact Removal</h3>
                </div>
                <div className="sub-card">
                  <ToggleRowB on={ica} onChange={setIca} label="ICA Artifact Removal" bold />
                  {ica && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <ToggleRowB on={icaAuto} onChange={setIcaAuto} label="Komponen Otomatis" />
                      <div className="chip-group">
                        {['fastica', 'infomax', 'picard'].map(m => (
                          <button key={m} className={`chip ${icaMethod === m ? 'selected' : ''}`} onClick={() => setIcaMethod(m)}>{m}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 5: Ekstraksi */}
            {scanned && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">STEP 05</span>
                  <h3>Ekstraksi Fitur</h3>
                </div>
                <div className="chip-group">
                  <button className={`chip ${extractMode === 'full' ? 'selected' : ''}`} onClick={() => setExtractMode('full')}>Full Data</button>
                  <button className={`chip ${extractMode === 'chunk' ? 'selected' : ''}`} onClick={() => setExtractMode('chunk')}>Chunk</button>
                </div>
                {extractMode === 'chunk' && (
                  <div className="form-row">
                    <label>Durasi Chunk: {chunkDur} s</label>
                    <div className="chip-group">
                      {[0.25, 0.5, 1.0, 1.5, 2.0].map(d => (
                        <button key={d} className={`chip ${d === chunkDur ? 'selected' : ''}`} onClick={() => setChunkDur(d)}>{d} s</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="card-divider" />

            {processing ? (
              <>
                <div className="progress lg"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
                <div className="progress-meta">
                  <span>{filesProcessed}/{totalFiles} files · 4 threads</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </>
            ) : (
              <button className="btn-cta" onClick={handleProcess} disabled={!scanned}>
                <Icon.Play /> Proses Batch <Icon.Arrow />
              </button>
            )}
          </aside>

          {/* ============ RIGHT ============ */}
          <section className="split-right">
            <div className="tabs-pill">
              {[
                { id: 'files', label: 'File List' },
                { id: 'delta', label: 'Delta Chart' },
                { id: 'tdelta', label: 'Tabel Delta' },
                { id: 'heatmap', label: 'Heatmap' },
                { id: 'scatter', label: 'Scatter' },
                { id: 'data', label: 'Data Table' },
                { id: 'sum', label: 'Ringkasan' },
              ].map(t => (
                <button key={t.id} className={`tab-pill ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
              <span className="right">{done ? `${totalFiles}/${totalFiles} files processed` : (processing ? `${filesProcessed}/${totalFiles} processing` : 'Idle')}</span>
            </div>

            {apiError && (
              <div style={{ margin: 16, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12.5 }}>
                Error: {apiError}
              </div>
            )}
            {!done && !processing ? (
              <div className="canvas">
                <div className="empty">
                  <BatchEmptyArt />
                  <h4>Upload file ZIP untuk memulai analisis batch</h4>
                  <p>Hasil delta, heatmap, dan scatter akan tampil di sini setelah proses selesai.</p>
                </div>
              </div>
            ) : processing ? (
              <div className="canvas">
                <div className="empty">
                  <BatchEmptyArt />
                  <h4>Memproses {filesProcessed} / {totalFiles} file...</h4>
                  <p>Pipeline paralel sedang menjalankan ekstraksi fitur dan delta antar grup.</p>
                </div>
              </div>
            ) : (
              <>
                {tab === 'files' && <FileListTab results={results} />}
                {tab === 'delta' && <DeltaChartTab results={results} subbands={subbands} />}
                {tab === 'tdelta' && <TabelDeltaTab results={results} subbands={subbands} />}
                {tab === 'heatmap' && <HeatmapTab results={results} subbands={subbands} channels={channels} />}
                {tab === 'scatter' && <ScatterTab results={results} />}
                {tab === 'data' && <DataTableTab results={results} subbands={subbands} onDownloadExcel={handleExportExcelBatch} />}
                {tab === 'sum' && <RingkasanTab results={results} scanMeta={scanMeta} />}
              </>
            )}
          </section>
        </div>
      </div>

      <style>{`
        .loading-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulseDot 1.4s ease-in-out infinite; }
      `}</style>
    </main>
  );
}

function HeroIconCircle() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ opacity: 0.95 }}>
      <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="60" cy="60" r="32" fill="rgba(255,255,255,0.15)" />
      <g transform="translate(60 60)">
        <path d="M-14 -4 L-4 -4 L-4 -14 L4 -14 L4 -4 L14 -4 L14 4 L4 4 L4 14 L-4 14 L-4 4 L-14 4 Z"
          fill="rgba(255,255,255,0.7)" />
      </g>
    </svg>
  );
}

function FilterGroupB({ label, counter, children }) {
  return (
    <div className="form-row">
      <label>
        <span>{label}</span>
        {counter && <span className="hint">{counter}</span>}
      </label>
      {children}
    </div>
  );
}

function ScanRow({ label, value, wrapValue = false }) {
  return (
    <div className="row-between" style={{ fontSize: 12.5, alignItems: wrapValue ? 'flex-start' : 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        justifyContent: 'flex-end',
        fontWeight: 600,
        color: 'var(--text-primary)',
        maxWidth: wrapValue ? '68%' : 'unset',
        flexWrap: wrapValue ? 'wrap' : 'nowrap',
        rowGap: wrapValue ? 6 : 0,
      }}>{value}</span>
    </div>
  );
}

function BatchEmptyArt() {
  return (
    <svg className="empty-art" viewBox="0 0 220 140">
      {[20, 60, 100, 140, 180].map((x, i) => {
        const h1 = 30 + (i % 3) * 18;
        const h2 = 40 + ((i + 1) % 3) * 14;
        return (
          <g key={i}>
            <rect x={x} y={100 - h1} width="14" height={h1 + 6} rx="6" fill="#DDDFFB" />
            <rect x={x + 18} y={100 - h2} width="14" height={h2 + 6} rx="6" fill="rgba(91,101,220,0.5)" />
          </g>
        );
      })}
      <line x1="10" y1="110" x2="210" y2="110" stroke="#DDDFFB" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BatchResultStrip({ results, totalSubjects }) {
  const records = results?.records || [];
  const alsCount = new Set(records.filter(r => r.category === 'ALS').map(r => r.subject)).size;
  const normalCount = new Set(records.filter(r => r.category === 'Normal').map(r => r.subject)).size;
  const processedFiles = results?.processed_files ?? new Set(records.map(r => r.filename)).size;

  let dMav = '-';
  if (records.length > 0) {
    const als = records.filter(r => r.category === 'ALS').map(r => +r.mav).filter(v => !isNaN(v));
    const nor = records.filter(r => r.category === 'Normal').map(r => +r.mav).filter(v => !isNaN(v));
    if (als.length > 0 && nor.length > 0) {
      const mAls = als.reduce((s, v) => s + v, 0) / als.length;
      const mNor = nor.reduce((s, v) => s + v, 0) / nor.length;
      const pct = mNor !== 0 ? ((mAls - mNor) / Math.abs(mNor)) * 100 : 0;
      dMav = `${pct.toFixed(1)}%`;
    }
  }

  const labelStyle = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 };
  const valStyle = { fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' };

  return (
    <div className="stat-strip" style={{ marginBottom: 24 }}>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>FILES DIPROSES</div>
        <div style={valStyle}>{processedFiles}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>ALS SUBJECTS</div>
        <div style={valStyle}>{alsCount}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>NORMAL SUBJECTS</div>
        <div style={valStyle}>{normalCount}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>Δ MAV (ALS vs Normal)</div>
        <div style={valStyle}>{dMav}</div>
      </div>
    </div>
  );
}

Object.assign(window, { BatchPage });
