/* global React, Icon, Plotly */
const { useState, useRef, useEffect } = React;
const Api = window.Api;
const AppConfig = window.AppConfig;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="canvas">
          <div className="empty">
            <h4>Render Error</h4>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button className="btn btn-secondary" onClick={() => this.setState({ hasError: false, error: null })}>
              Coba Lagi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SUBBANDS = AppConfig.SUBBANDS;

// Fallback channel set (used before upload; replaced by backend metadata after upload)
const DEFAULT_CHANNELS = [
  'Cz', 'Fz', 'Pz', 'Oz', 'Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8',
  'FC1', 'FC2', 'FC5', 'FC6', 'C3', 'C4', 'T7', 'T8', 'CP1', 'CP2',
  'CP5', 'CP6', 'P3', 'P4', 'P7', 'P8', 'PO3', 'PO4', 'O1', 'O2',
  'FT9', 'FT10'
];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(s) {
  if (!s && s !== 0) return '-';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function PlotlyView({ figure }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !figure) return;
    if (typeof window.Plotly === 'undefined') {
      ref.current.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:13px">Plotly not loaded</div>';
      return;
    }
    window.Plotly.react(ref.current, figure.data || [], figure.layout || {}, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    });
    return () => {
      try { window.Plotly.purge(ref.current); } catch { }
    };
  }, [figure]);
  return <div ref={ref} style={{ width: '100%', minHeight: 360 }} />;
}

// === Chips ===
function ChipGroup({ options, value, onChange, idKey = 'id', labelKey = 'name' }) {
  return (
    <div className="chip-group">
      {options.map(o => {
        const id = typeof o === 'string' ? o : o[idKey];
        const label = typeof o === 'string' ? o : o[labelKey];
        const selected = value.includes(id);
        return (
          <button key={id}
            className={`chip ${selected ? 'selected' : ''}`}
            onClick={() => onChange(selected ? value.filter(v => v !== id) : [...value, id])}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CheckPill({ checked, onClick, children }) {
  return (
    <button className={`check-pill ${checked ? 'checked' : ''}`} onClick={onClick}>
      <span className="ck"><Icon.Check /></span>
      {children}
    </button>
  );
}

function ToggleRow({ on, onChange, label, bold }) {
  return (
    <div className={`toggle-row ${bold ? 'bold' : ''}`} onClick={() => onChange(!on)} style={{ cursor: 'pointer' }}>
      <span className={`toggle ${on ? 'on' : ''}`} />
      <span>{label}</span>
    </div>
  );
}

function Slider({ min = 0, max = 100, value, onChange, label, snapPoints }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      {label && <div className="row-between mb-12"><span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span><span className="chip-mini accent">{value}</span></div>}
      <div className="slider">
        <div className="slider-track">
          <div className="slider-fill" style={{ width: `${pct}%` }} />
          <div className="slider-thumb" style={{ left: `${pct}%` }} />
        </div>
      </div>
      {snapPoints && (
        <div className="row gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
          {snapPoints.map(sp => (
            <button key={sp} className={`chip-mini ${sp === value ? 'accent' : ''}`} onClick={() => onChange(sp)}>{sp}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// === Single File Page ===
function SingleFilePage() {
  const [file, setFile] = useState(null);                 // raw File obj
  const [meta, setMeta] = useState(null);                 // backend metadata
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const allChannels = meta?.channels?.length ? meta.channels : DEFAULT_CHANNELS;

  const [selectedChannels, setSelectedChannels] = useState([]);
  const [expandAllChannels, setExpandAllChannels] = useState(false);
  const [filterMode, setFilterMode] = useState('preset');
  const [bpSubbands, setBpSubbands] = useState(['alpha', 'beta']);
  const [bpLow, setBpLow] = useState(AppConfig.BP_DEFAULT_LOW);
  const [bpHigh, setBpHigh] = useState(AppConfig.BP_DEFAULT_HIGH);
  const [bpOrder, setBpOrder] = useState(AppConfig.BP_DEFAULT_ORDER);
  const [amplitudeOn, setAmplitudeOn] = useState(false);
  const [notchOn, setNotchOn] = useState(true);
  const [notchHz, setNotchHz] = useState('50');
  const [carOn, setCarOn] = useState(false);
  const [icaOn, setIcaOn] = useState(false);
  const [icaAuto, setIcaAuto] = useState(true);
  const [icaN, setIcaN] = useState(5);
  const [icaMethod, setIcaMethod] = useState('fastica');
  const [extractMode, setExtractMode] = useState('full');
  const [chunkDur, setChunkDur] = useState(AppConfig.CHUNK_DEFAULT);
  const [features, setFeatures] = useState(['mav', 'variance', 'std']);
  const [erdEnabled, setErdEnabled] = useState(false);
  const [erdBaseline, setErdBaseline] = useState('');
  const [erdTarget, setErdTarget] = useState('');
  const [subbandSel, setSubbandSel] = useState(['delta', 'theta', 'alpha', 'beta']);
  const [tab, setTab] = useState('raw');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null);
  const [apiError, setApiError] = useState(null);

  // Plot tab state
  const [rawPlot, setRawPlot] = useState(null);
  const [filteredPlot, setFilteredPlot] = useState(null);
  const [subbandPlot, setSubbandPlot] = useState(null);
  const [icaPlot, setIcaPlot] = useState(null);
  const [plotLoading, setPlotLoading] = useState(false);
  const [plotError, setPlotError] = useState(null);
  const [tStart, setTStart] = useState(0);
  const [tDur, setTDur] = useState(5);
  const [subbandChannel, setSubbandChannel] = useState('');
  const [flagFilter, setFlagFilter] = useState([]);  // [] = show all; non-empty = whitelist

  const fileInputRef = useRef(null);

  const buildProcessOpts = () => ({
    bp_low: filterMode === 'preset' ? AppConfig.BP_DEFAULT_LOW : bpLow,
    bp_high: filterMode === 'preset' ? AppConfig.BP_DEFAULT_HIGH : bpHigh,
    bp_order: bpOrder,
    use_notch: notchOn,
    notch_freq: notchHz,
    use_car: carOn,
    use_amplitude: amplitudeOn,
    use_ica: icaOn,
    ica_method: icaMethod,
    ica_n: icaAuto ? null : icaN,
    subbands: subbandSel.join(','),
    features: features
      .map(f => AppConfig.FEATURES_BACKEND_MAP[f] || f.toLowerCase())
      .join(','),
    include_frequency: true,
    chunk_mode: extractMode === 'chunk',
    chunk_duration: chunkDur,
    channels_filter: selectedChannels.join(','),
    filter_tasks: flagFilter.join(','),
  });

  const handleUpload = async (f) => {
    if (!f) return;
    setFile(f);
    setUploading(true);
    setUploadError(null);
    setMeta(null);
    setDone(false);
    setResults(null);
    setRawPlot(null); setFilteredPlot(null); setSubbandPlot(null); setIcaPlot(null);
    setFlagFilter([]);
    try {
      const data = await Api.singleUpload(f);
      setMeta(data);
      const chs = data.channels || [];
      setSelectedChannels(chs.slice(0, Math.min(12, chs.length)));
      if (chs.length > 0) setSubbandChannel(chs[0]);
    } catch (e) {
      setUploadError(e.message || 'Tidak dapat terhubung ke backend. Pastikan uvicorn berjalan di port 8000.');
      setMeta(null);
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setDone(false);
    setProgress(0);
    setApiError(null);
    setResults(null);
    const ticker = setInterval(() => setProgress(p => Math.min(p + 2, 90)), 250);
    try {
      const opts = buildProcessOpts();
      const data = await Api.singleProcess(file, opts);

      if (erdEnabled && erdBaseline && erdTarget) {
        try {
          const erdData = await Api.singleErd(file, {
            bp_low: opts.bp_low, bp_high: opts.bp_high, bp_order: opts.bp_order,
            use_notch: opts.use_notch, notch_freq: opts.notch_freq,
            use_car: opts.use_car, use_amplitude: opts.use_amplitude,
            use_ica: opts.use_ica, ica_method: opts.ica_method, ica_n: opts.ica_n,
            subbands: opts.subbands,
            channels_filter: opts.channels_filter,
            baseline_task: erdBaseline,
            target_task: erdTarget,
          });
          data.erd_records = erdData.erd_records || [];
        } catch {
          data.erd_records = [];
        }
      }

      setResults(data);
      setDone(true);
      setTab('fitur');
    } catch (e) {
      setApiError(e.message || 'Gagal memproses');
    } finally {
      clearInterval(ticker);
      setProgress(100);
      setProcessing(false);
    }
  };

  const fetchPlot = async (kind) => {
    if (!file) return;
    setPlotLoading(true);
    setPlotError(null);
    const annFilterCSV = flagFilter.join(',');
    try {
      if (kind === 'raw') {
        const r = await Api.singlePlotRaw(file, selectedChannels.slice(0, 8), tStart, tDur, annFilterCSV);
        setRawPlot(r.figure);
      } else if (kind === 'filtered') {
        const opts = buildProcessOpts();
        const r = await Api.singlePlotFiltered(
          file, selectedChannels.slice(0, 8), tStart, tDur, {
          bp_low: opts.bp_low, bp_high: opts.bp_high, bp_order: opts.bp_order,
          use_notch: opts.use_notch, notch_freq: opts.notch_freq,
          use_car: opts.use_car, use_amplitude: opts.use_amplitude,
        },
          annFilterCSV,
        );
        setFilteredPlot(r.figure);
      } else if (kind === 'subband') {
        if (!subbandChannel) { setPlotError('Pilih channel'); return; }
        const r = await Api.singlePlotSubband(file, subbandChannel, tStart, tDur, subbandSel, {}, annFilterCSV);
        setSubbandPlot(r.figure);
      } else if (kind === 'ica') {
        const r = await Api.singlePlotIca(file, {
          bp_low: bpLow, bp_high: bpHigh, bp_order: bpOrder,
          ica_method: icaMethod,
          ica_n: icaAuto ? null : icaN,
          t_start: tStart,
          t_dur: tDur,
          annotation_filter: annFilterCSV,
        });
        setIcaPlot(r.figure);
      }
    } catch (e) {
      setPlotError(e.message || 'Gagal mengambil plot');
    } finally {
      setPlotLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!results || !results.features || results.features.length === 0) return;
    const fname = `single_file_features_${Date.now()}.xlsx`;
    try {
      const blob = await Api.exportExcel(
        [{ name: 'Features', records: results.features }], fname,
      );
      window.downloadBlob(blob, fname);
    } catch (e) {
      setApiError(e.message || 'Export gagal');
    }
  };

  const handleDownloadCSV = () => {
    if (!results || !results.features || results.features.length === 0) return;
    window.downloadCSV(results.features, `single_file_features_${Date.now()}.csv`);
  };

  const handlePlotAndSwitch = async (kind) => {
    setTab(kind);
    await fetchPlot(kind);
  };

  const handleClearFile = () => {
    setFile(null); setMeta(null); setResults(null); setDone(false);
    setRawPlot(null); setFilteredPlot(null); setSubbandPlot(null); setIcaPlot(null);
    setSelectedChannels([]); setSubbandChannel(''); setFlagFilter([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDropFile = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  };

  const channelsShown = expandAllChannels ? allChannels : allChannels.slice(0, 16);

  return (
    <main data-screen-label="03 Single File">
      <div className="page">
        <div className="page-head">
          <div className="page-head-text">
            <div className="crumb">Analisis <Icon.Chev /> Single File</div>
            <h2>Single File Analysis</h2>
            <p className="subtitle">Upload satu file EDF atau TXT dan analisis sinyal interaktif.</p>
          </div>
          <div className="page-head-actions">
            <button className="fpill"><Icon.Sliders /> Mode: EDF <Icon.ChevDown /></button>
            <button className="fpill"><Icon.Clock /> Last 5s</button>
            <button className="fpill"><Icon.Wave /> All channels <Icon.ChevDown /></button>
            <button className="btn btn-primary" onClick={handleExportExcel} disabled={!done}><Icon.Download /> Export Excel</button>
          </div>
        </div>

        <div className="split">
          {/* ============ LEFT PANEL ============ */}
          <aside className="split-left">

            {/* === SECTION 1: Upload === */}
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 01</span>
                <h3>Upload File EDF / TXT</h3>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".edf,.txt"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.target.value = '';
                }}
              />
              {file ? (
                <div className="file-card">
                  <div className="file-card-badge"><Icon.File /></div>
                  <div className="file-card-info">
                    <div className="name">{file.name}</div>
                    <div className="meta">
                      {formatSize(file.size)} · {file.name.toLowerCase().endsWith('.txt') ? 'TXT' : 'EDF'}
                    </div>
                  </div>
                  <button className="file-card-x" onClick={handleClearFile}><Icon.X /></button>
                </div>
              ) : (
                <div
                  className="dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={onDropFile}
                >
                  <div className="dz-icon"><Icon.Cloud /></div>
                  <div className="dz-title">Drag &amp; drop file</div>
                  <div className="dz-sub">atau klik untuk pilih file</div>
                  <div className="dz-hint">Format: .edf  .txt (OpenBCI)</div>
                </div>
              )}
              {uploading && (
                <div className="row gap-8" style={{ marginTop: 10, background: 'var(--accent-tint)', padding: '8px 14px', borderRadius: 999, fontSize: 12.5, color: 'var(--accent)', fontWeight: 500 }}>
                  <span className="loading-dot" />
                  Memuat file...
                </div>
              )}
              {uploadError && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
                  {uploadError}
                </div>
              )}
            </div>

            {/* === SECTION 2: Metadata (after upload) === */}
            {meta && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">FILE INFO</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <MetaCard label="FORMAT" value={meta.format || 'EDF'} />
                  <MetaCard label="CHANNELS" value={meta.n_channels ?? meta.channels?.length ?? '-'} />
                  <MetaCard label="RATE" value={meta.sfreq ? `${meta.sfreq} Hz` : '-'} />
                  <MetaCard label="SAMPLES" value={meta.duration_s && meta.sfreq ? Math.round(meta.duration_s * meta.sfreq).toLocaleString() : '-'} />
                  <MetaCard label="DURATION" value={formatDuration(meta.duration_s)} />
                  <MetaCard label="SIZE" value={file ? formatSize(file.size) : '-'} />
                </div>
                {meta.tasks?.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                    Tasks: {meta.tasks.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* === SECTION 2b: Flags / Annotations === */}
            {meta?.annotations?.length > 0 && (
              <FlagsCard
                annotations={meta.annotations}
                flagFilter={flagFilter}
                setFlagFilter={setFlagFilter}
                onJump={(onset) => { setTStart(Math.max(0, onset - 0.5)); }}
              />
            )}

            {/* === SECTION 3: Channels === */}
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 02</span>
                <h3>Pilih Channel</h3>
              </div>
              <div className="row">
                <button className="btn-ghost-accent" onClick={() => setSelectedChannels([...allChannels])}>Pilih Semua</button>
                <button className="btn-ghost" onClick={() => setSelectedChannels([])}>Hapus Semua</button>
                <span className="spacer" />
                <span className="chip-mini">{selectedChannels.length} / {allChannels.length}</span>
              </div>
              <div className="chip-group" style={{ maxHeight: expandAllChannels ? 'none' : 180, overflow: 'hidden' }}>
                {channelsShown.map(c => {
                  const sel = selectedChannels.includes(c);
                  return (
                    <button key={c}
                      className={`chip ${sel ? 'selected' : ''}`}
                      style={{ fontSize: 11.5, padding: '5px 12px', height: 28 }}
                      onClick={() => setSelectedChannels(sel ? selectedChannels.filter(x => x !== c) : [...selectedChannels, c])}>
                      {c}
                    </button>
                  );
                })}
                {!expandAllChannels && allChannels.length > 16 && (
                  <button className="chip" style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)', fontSize: 11.5, padding: '5px 12px', height: 28 }} onClick={() => setExpandAllChannels(true)}>
                    + {allChannels.length - 16} more
                  </button>
                )}
              </div>
            </div>

            {/* === SECTION 4: Pre-processing === */}
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 03</span>
                <h3>Pre-processing</h3>
              </div>

              {/* 4a Bandpass */}
              <div className="sub-card">
                <div className="row-between mb-12">
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>Bandpass Filter</span>
                  <span className="sub-card-chevron" aria-hidden="true">▾</span>
                </div>
                <div className="chip-group mb-12">
                  <button className={`chip ${filterMode === 'preset' ? 'selected' : ''}`} onClick={() => setFilterMode('preset')}>Preset Subband</button>
                  <button className={`chip ${filterMode === 'custom' ? 'selected' : ''}`} onClick={() => setFilterMode('custom')}>Custom Range</button>
                </div>
                {filterMode === 'preset' ? (
                  <ChipGroup options={SUBBANDS} value={bpSubbands} onChange={setBpSubbands} />
                ) : (
                  <>
                    <div className="input-grid-2 mb-12">
                      <input className="input" type="number" step="0.1" value={bpLow}
                        onChange={e => setBpLow(parseFloat(e.target.value) || 0)} placeholder="Low (Hz)" />
                      <input className="input" type="number" step="0.1" value={bpHigh}
                        onChange={e => setBpHigh(parseFloat(e.target.value) || 0)} placeholder="High (Hz)" />
                    </div>
                    <div className="row gap-8" style={{ alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Order:</span>
                      <input className="input" type="number" min="1" max="10" value={bpOrder}
                        onChange={e => setBpOrder(parseInt(e.target.value) || 5)} style={{ width: 80 }} />
                    </div>
                  </>
                )}
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => handlePlotAndSwitch('filtered')} disabled={!file || plotLoading}><Icon.Wave /> Plot Filtered Signal</button>
              </div>

              {/* 4b Amplitude */}
              <div className="sub-card">
                <ToggleRow on={amplitudeOn} onChange={setAmplitudeOn} label="Amplitude Filter (clip ±100 µV)" />
                {amplitudeOn && (
                  <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => handlePlotAndSwitch('filtered')} disabled={!file || plotLoading}><Icon.Chart /> Plot Amplitude Filter</button>
                )}
              </div>

              {/* 4c Notch */}
              <div className="sub-card">
                <ToggleRow on={notchOn} onChange={setNotchOn} label="Notch Filter" />
                {notchOn && (
                  <>
                    <div className="chip-group mt-12">
                      <button className={`chip ${notchHz === '50' ? 'selected' : ''}`} onClick={() => setNotchHz('50')}>50 Hz</button>
                      <button className={`chip ${notchHz === '60' ? 'selected' : ''}`} onClick={() => setNotchHz('60')}>60 Hz</button>
                    </div>
                    <button className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => handlePlotAndSwitch('filtered')} disabled={!file || plotLoading}><Icon.Chart /> Plot Notch Filter</button>
                  </>
                )}
              </div>

              {/* 4d ICA */}
              <div className="sub-card">
                <ToggleRow on={icaOn} onChange={setIcaOn} label="ICA Artifact Removal" bold />
                {icaOn && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <ToggleRow on={icaAuto} onChange={setIcaAuto} label="Komponen Otomatis" />
                    {!icaAuto && (
                      <div className="row gap-8" style={{ alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Komponen:</span>
                        <input className="input" type="number" min="1" max="20" value={icaN}
                          onChange={e => setIcaN(parseInt(e.target.value) || 5)} style={{ width: 80 }} />
                      </div>
                    )}
                    <div className="chip-group">
                      {['fastica', 'infomax', 'picard'].map(m => (
                        <button key={m} className={`chip ${icaMethod === m ? 'selected' : ''}`} onClick={() => setIcaMethod(m)}>{m}</button>
                      ))}
                    </div>
                    <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => handlePlotAndSwitch('ica')} disabled={!file || plotLoading}><Icon.Chart /> Plot ICA Components</button>
                  </div>
                )}
              </div>
            </div>

            {/* === SECTION 5: Ekstraksi Fitur === */}
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 04</span>
                <h3>Ekstraksi Fitur</h3>
              </div>
              <div className="chip-group">
                <button className={`chip ${extractMode === 'full' ? 'selected' : ''}`} onClick={() => setExtractMode('full')}>Full Data</button>
                <button className={`chip ${extractMode === 'chunk' ? 'selected' : ''}`} onClick={() => setExtractMode('chunk')}>Chunk</button>
              </div>
              {extractMode === 'chunk' && (
                <Slider min={0.25} max={2.0} value={chunkDur} onChange={setChunkDur} label={`Durasi Chunk: ${chunkDur} s`} snapPoints={[0.25, 0.5, 1.0, 1.5, 2.0]} />
              )}
              <div className="form-row">
                <label>Pilih fitur statistik</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { id: 'mav', label: 'MAV' },
                    { id: 'variance', label: 'Variance' },
                    { id: 'std', label: 'STD' },
                    { id: 'band_power', label: 'Band Power' },
                    { id: 'relative_power', label: 'Rel. Power' },
                    { id: 'peak_frequency', label: 'Peak Freq' },
                  ].map(f => (
                    <CheckPill key={f.id} checked={features.includes(f.id)} onClick={() => {
                      setFeatures(features.includes(f.id) ? features.filter(x => x !== f.id) : [...features, f.id]);
                    }}>{f.label}</CheckPill>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <CheckPill checked={erdEnabled} onClick={() => setErdEnabled(!erdEnabled)}>ERD/ERS</CheckPill>
                </div>
                {erdEnabled && (() => {
                  const taskOpts = meta?.annotations
                    ? Array.from(new Set(meta.annotations.map(a => a.description)))
                    : (results?.tasks || []);
                  const selStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, width: '100%', marginTop: 4 };
                  return (
                    <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--surface-tint)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>ERD = (Task - Baseline) / Baseline × 100%</div>
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Baseline Task</div>
                        <select value={erdBaseline} onChange={e => setErdBaseline(e.target.value)} style={selStyle}>
                          <option value="">-- pilih --</option>
                          {taskOpts.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Target Task</div>
                        <select value={erdTarget} onChange={e => setErdTarget(e.target.value)} style={selStyle}>
                          <option value="">-- pilih --</option>
                          {taskOpts.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="form-row">
                <label>Subband</label>
                <ChipGroup options={SUBBANDS} value={subbandSel} onChange={setSubbandSel} />
              </div>
            </div>

            <div className="card-divider" />

            <button className="btn-cta" onClick={handleProcess} disabled={!file || processing}>
              <Icon.Play />
              {processing ? 'Memproses...' : 'Ekstrak Fitur'}
              <Icon.Arrow />
            </button>

            {processing && (
              <>
                <div className="progress lg"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
                <div className="progress-meta">
                  <span>Bandpass · Subband · Fitur</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </>
            )}
          </aside>

          {/* ============ RIGHT PANEL ============ */}
          <section className="split-right">
            <div className="tabs-pill">
              {[
                { id: 'raw', label: 'Raw Signal' },
                { id: 'filtered', label: 'Filtered' },
                { id: 'subband', label: 'Subband Plots' },
                { id: 'ica', label: 'ICA Components' },
                { id: 'fitur', label: 'Hasil Fitur' },
              ].map(t => (
                <button key={t.id}
                  className={`tab-pill ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
              <span className="right">Last updated 12s ago</span>
            </div>

            {tab === 'raw' && (
              <RawSignalTab
                file={file} channels={selectedChannels}
                tStart={tStart} setTStart={setTStart}
                tDur={tDur} setTDur={setTDur}
                figure={rawPlot} loading={plotLoading} error={plotError}
                onPlot={() => fetchPlot('raw')}
              />
            )}
            {tab === 'filtered' && (
              <FilteredTab
                file={file} channels={selectedChannels}
                bpLow={bpLow} bpHigh={bpHigh} notchHz={notchHz} notchOn={notchOn}
                tStart={tStart} setTStart={setTStart}
                tDur={tDur} setTDur={setTDur}
                figure={filteredPlot} loading={plotLoading} error={plotError}
                onPlot={() => fetchPlot('filtered')}
              />
            )}
            {tab === 'subband' && (
              <SubbandTab
                file={file} allChannels={allChannels} subbands={subbandSel}
                channel={subbandChannel} setChannel={setSubbandChannel}
                tStart={tStart} setTStart={setTStart} tDur={tDur} setTDur={setTDur}
                figure={subbandPlot} loading={plotLoading} error={plotError}
                onPlot={() => fetchPlot('subband')}
              />
            )}
            {tab === 'ica' && (
              <IcaTab
                icaOn={icaOn} file={file}
                tStart={tStart} setTStart={setTStart}
                tDur={tDur} setTDur={setTDur}
                figure={icaPlot} loading={plotLoading} error={plotError}
                onPlot={() => fetchPlot('ica')}
              />
            )}
            {tab === 'fitur' && (
              <ErrorBoundary>
                <FiturTab
                  done={done} processing={processing}
                  results={results} error={apiError}
                  extractMode={extractMode} chunkDur={chunkDur}
                  erdBaseline={erdBaseline} erdTarget={erdTarget}
                  onDownloadCSV={handleDownloadCSV}
                  onDownloadExcel={handleExportExcel}
                />
              </ErrorBoundary>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function FlagsCard({ annotations, flagFilter, setFlagFilter, onJump }) {
  const uniqueDescs = Array.from(new Set(annotations.map(a => a.description)));
  const counts = {};
  for (const a of annotations) counts[a.description] = (counts[a.description] || 0) + 1;
  const filterActive = flagFilter.length > 0;
  const toggleDesc = (d) => {
    if (flagFilter.includes(d)) setFlagFilter(flagFilter.filter(x => x !== d));
    else setFlagFilter([...flagFilter, d]);
  };
  const showCount = filterActive
    ? annotations.filter(a => flagFilter.includes(a.description)).length
    : annotations.length;
  return (
    <div className="side-section">
      <div className="side-title-row">
        <span className="eyebrow">FLAGS / TASKS</span>
        <h3>Annotations ({annotations.length})</h3>
      </div>
      <div className="row mb-12" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button className="btn-ghost-accent" onClick={() => setFlagFilter([])}>
          Tampilkan Semua
        </button>
        <button className="btn-ghost" onClick={() => setFlagFilter([...uniqueDescs])}>
          Pilih Semua
        </button>
        <span className="spacer" />
        <span className="chip-mini accent">{showCount} aktif</span>
      </div>
      <div className="chip-group mb-12">
        {uniqueDescs.map(d => {
          const selected = filterActive ? flagFilter.includes(d) : true;
          return (
            <button key={d}
              className={`chip ${selected ? 'selected' : ''}`}
              style={{ fontSize: 11.5, padding: '5px 12px', height: 28 }}
              onClick={() => toggleDesc(d)}
              title={`Klik untuk ${selected ? 'sembunyikan' : 'tampilkan'} di plot`}>
              {d} ({counts[d]})
            </button>
          );
        })}
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {annotations.map((a, i) => {
          const visible = !filterActive || flagFilter.includes(a.description);
          return (
            <div key={i} className="row" style={{
              padding: '6px 10px', borderRadius: 8,
              background: visible ? 'var(--surface-tint)' : 'transparent',
              opacity: visible ? 1 : 0.45,
              fontSize: 11.5,
            }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', minWidth: 56, color: 'var(--accent)', fontWeight: 600 }}>
                {a.onset.toFixed(2)}s
              </span>
              <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 500 }}>{a.description}</span>
              {a.duration > 0 && (
                <span className="chip-mini">{a.duration.toFixed(2)}s</span>
              )}
              <button className="chip-mini accent" onClick={() => onJump(a.onset)} style={{ cursor: 'pointer', border: 'none' }}>
                Jump
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetaCard({ label, value }) {
  return (
    <div style={{ background: 'var(--surface-tint)', borderRadius: 14, padding: '10px 12px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{value}</div>
    </div>
  );
}

// === Time-range stepper (shared) ===
function TimeStepper({ label, value, onChange, step = 0.5, min = 0 }) {
  return (
    <div className="input-pill">
      <span className="label">{label}</span>
      <button className="stepper-btn" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <input type="number" step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)} />
      <button className="stepper-btn" onClick={() => onChange(+(value + step).toFixed(2))}>+</button>
    </div>
  );
}

// === Raw Signal Tab ===
function RawSignalTab({ file, channels, tStart, setTStart, tDur, setTDur, figure, loading, error, onPlot }) {
  return (
    <>
      <div className="ctrl-bar">
        <div className="chip-group" style={{ flex: 1, overflow: 'hidden', maxWidth: 360 }}>
          {channels.slice(0, 6).map(c => <span key={c} className="chip selected" style={{ fontSize: 11.5, padding: '5px 12px', height: 28 }}>{c}</span>)}
          {channels.length > 6 && <span className="chip-mini">+{channels.length - 6}</span>}
        </div>
        <TimeStepper label="Mulai (s)" value={tStart} onChange={setTStart} step={0.5} />
        <TimeStepper label="Durasi (s)" value={tDur} onChange={setTDur} step={0.5} min={0.5} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onPlot} disabled={!file || loading || channels.length === 0}>
          <Icon.Play /> {loading ? 'Memuat...' : 'Tampilkan Plot'}
        </button>
      </div>
      <div className="canvas">
        {error && <PlotErrorBox msg={error} />}
        {!file ? (
          <EmptyPlot title="Plot belum dirender" sub="Upload file dan klik 'Tampilkan Plot' untuk melihat sinyal raw" />
        ) : !figure ? (
          <EmptyPlot title="Klik Tampilkan Plot" sub={`${channels.length} channel terpilih · ${tDur}s window`} />
        ) : (
          <PlotlyView figure={figure} />
        )}
      </div>
    </>
  );
}

function FilteredTab({ file, channels, bpLow, bpHigh, notchHz, notchOn, tStart, setTStart, tDur, setTDur, figure, loading, error, onPlot }) {
  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini accent"><Icon.Filter /> Bandpass {bpLow}-{bpHigh} Hz{notchOn ? `, Notch ${notchHz} Hz` : ''}</span>
        <TimeStepper label="Mulai (s)" value={tStart} onChange={setTStart} step={0.5} />
        <TimeStepper label="Durasi (s)" value={tDur} onChange={setTDur} step={0.5} min={0.5} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onPlot} disabled={!file || loading || channels.length === 0}>
          <Icon.Play /> {loading ? 'Memuat...' : 'Tampilkan Plot'}
        </button>
      </div>
      <div className="canvas">
        {error && <PlotErrorBox msg={error} />}
        {!file ? (
          <EmptyPlot title="Plot belum dirender" sub="Filter akan diterapkan setelah file di-upload" />
        ) : !figure ? (
          <EmptyPlot title="Klik Tampilkan Plot" sub="Plot akan menampilkan sinyal setelah bandpass/notch diterapkan" />
        ) : (
          <PlotlyView figure={figure} />
        )}
      </div>
    </>
  );
}

function SubbandTab({ file, allChannels, subbands, channel, setChannel, tStart, setTStart, tDur, setTDur, figure, loading, error, onPlot }) {
  if (!file) {
    return <div className="canvas"><EmptyPlot title="Belum ada data" sub="Upload file untuk melihat dekomposisi subband per channel" /></div>;
  }
  return (
    <>
      <div className="ctrl-bar">
        <select value={channel} onChange={e => setChannel(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {allChannels.length === 0 && <option value="">— Pilih channel —</option>}
          {allChannels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <TimeStepper label="Mulai (s)" value={tStart} onChange={setTStart} step={0.5} />
        <TimeStepper label="Durasi (s)" value={tDur} onChange={setTDur} step={0.5} min={0.5} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onPlot} disabled={!file || loading || !channel}>
          <Icon.Play /> {loading ? 'Memuat...' : 'Tampilkan Plot'}
        </button>
      </div>
      <div className="canvas">
        {error && <PlotErrorBox msg={error} />}
        {!figure ? (
          <EmptyPlot title="Klik Tampilkan Plot" sub={`Dekomposisi ${subbands.length} subband pada channel ${channel || '—'}`} />
        ) : (
          <PlotlyView figure={figure} />
        )}
      </div>
    </>
  );
}

function PlotErrorBox({ msg }) {
  return (
    <div style={{ margin: 16, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12.5 }}>
      Error: {msg}
    </div>
  );
}

function IcaTab({ icaOn, file, tStart, setTStart, tDur, setTDur, figure, loading, error, onPlot }) {
  if (!icaOn) {
    return (
      <div className="canvas">
        <div className="empty">
          <EmptyArtBrain />
          <h4>ICA Tidak Aktif</h4>
          <p>Aktifkan ICA Artifact Removal di panel kiri terlebih dahulu untuk melihat komponen.</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini accent"><Icon.Filter /> ICA Components</span>
        <TimeStepper label="Mulai (s)" value={tStart} onChange={setTStart} step={0.5} />
        <TimeStepper label="Durasi (s)" value={tDur} onChange={setTDur} step={1} min={1} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onPlot} disabled={!file || loading}>
          <Icon.Play /> {loading ? 'Memuat...' : 'Tampilkan Plot'}
        </button>
      </div>
      <div className="canvas">
        {error && <PlotErrorBox msg={error} />}
        {!file ? (
          <EmptyPlot title="Belum ada data" sub="Upload file untuk menjalankan ICA decomposition" />
        ) : !figure ? (
          <EmptyPlot title="Klik Tampilkan Plot" sub="Annotation task (Resting, Thinking, dll) akan muncul sebagai marker di plot" />
        ) : (
          <PlotlyView figure={figure} />
        )}
      </div>
    </>
  );
}

// === Format helpers for feature values ===
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return String(v);
  if (Math.abs(n) < 0.001 && n !== 0) return n.toExponential(2);
  if (Math.abs(n) >= 1000) return n.toFixed(1);
  return n.toFixed(4);
}

function pickColumns(records) {
  if (!records || records.length === 0) return [];
  const first = records[0];
  return Object.keys(first);
}

function ErdTable({ records, baseline, target }) {
  const subbands = Array.from(new Set(records.map(r => r.subband).filter(Boolean)));
  const channels = Array.from(new Set(records.map(r => r.channel).filter(Boolean)));
  return (
    <div style={{ marginTop: 32 }}>
      <div className="row-between mb-12">
        <div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>ERD/ERS</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
            Baseline: <strong>{baseline}</strong> → Target: <strong>{target}</strong>
          </span>
        </div>
        <button className="btn btn-secondary" onClick={() => window.downloadCSV(records, `erd_${Date.now()}.csv`)}>
          <Icon.Download /> CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Channel</th><th>Subband</th>
              <th className="num">Baseline Power</th><th className="num">Task Power</th>
              <th className="num">ERD/ERS (%)</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const pct = r.erd_ers_pct;
              const isErd = pct < 0;
              return (
                <tr key={i}>
                  <td>{r.channel}</td>
                  <td><span className="badge badge-accent">{r.subband}</span></td>
                  <td className="num">{fmtNum(r.baseline_power)}</td>
                  <td className="num">{fmtNum(r.task_power)}</td>
                  <td className="num" style={{ fontWeight: 700, color: isErd ? 'var(--danger)' : 'var(--success)' }}>
                    {pct != null ? (pct > 0 ? '+' : '') + fmtNum(pct) + '%' : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FiturTab({ done, processing, results, error, extractMode, chunkDur, erdBaseline, erdTarget, onDownloadCSV, onDownloadExcel }) {
  const [page, setPage] = useState(0);
  const [taskFilter, setTaskFilter] = useState('all');
  const [subbandFilter, setSubbandFilter] = useState('all');
  const pageSize = 20;

  if (error) {
    return (
      <div className="canvas">
        <div className="empty">
          <EmptyArtChart />
          <h4>Error processing</h4>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="canvas">
        <div className="empty">
          <EmptyArtChart />
          <h4>Memproses fitur...</h4>
          <p>Pipeline berjalan: bandpass, subband, ekstraksi fitur.</p>
        </div>
      </div>
    );
  }

  if (!done || !results) {
    return (
      <div className="canvas">
        <div className="empty">
          <EmptyArtChart />
          <h4>Belum ada fitur diekstrak</h4>
          <p>Klik 'Ekstrak Fitur' di panel kiri untuk memulai analisis.</p>
        </div>
      </div>
    );
  }

  const records = results.features || [];
  const cols = pickColumns(records);

  const tasksAvail = Array.from(new Set(records.map(r => r.task).filter(Boolean)));
  const subbandsAvail = Array.from(new Set(records.map(r => r.subband).filter(Boolean)));

  const filtered = records.filter(r =>
    (taskFilter === 'all' || r.task === taskFilter) &&
    (subbandFilter === 'all' || r.subband === subbandFilter),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const numChannels = new Set(records.map(r => r.channel).filter(Boolean)).size;
  const numSubbands = subbandsAvail.length;

  return (
    <div style={{ padding: 24 }}>
      <div className="stat-strip mb-20">
        <StatStrip label="TOTAL RECORDS" value={records.length.toLocaleString()} />
        <StatStrip label="CHANNELS" value={numChannels || '-'} />
        <StatStrip label="SUBBANDS" value={numSubbands || '-'} />
        <StatStrip label="MODE" value={results.mode === 'chunk' ? `Chunk ${chunkDur}s` : 'Full Data'} />
      </div>
      <div className="row mb-16">
        <select className="fpill" value={taskFilter} onChange={e => { setTaskFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)' }}>
          <option value="all">Task: All</option>
          {tasksAvail.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fpill" value={subbandFilter} onChange={e => { setSubbandFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)' }}>
          <option value="all">Subband: All</option>
          {subbandsAvail.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={onDownloadCSV} disabled={records.length === 0}>
          <Icon.Download /> Download CSV
        </button>
        <button className="btn btn-primary" onClick={onDownloadExcel} disabled={records.length === 0}>
          <Icon.Download /> Download Excel
        </button>
      </div>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} className={typeof records[0][c] === 'number' ? 'num' : ''}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={safePage * pageSize + i}>
                {cols.map(c => {
                  const v = r[c];
                  const isSubbandCol = c === 'subband';
                  const isNum = typeof v === 'number';
                  return (
                    <td key={c} className={isNum ? 'num' : ''}>
                      {isSubbandCol ? <span className="badge badge-accent">{v}</span> :
                        isNum ? fmtNum(v) : (v ?? '-')}
                    </td>
                  );
                })}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                Tidak ada data sesuai filter
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="pagination">
          <button className="chip chip-mini" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>‹ Prev</button>
          <span>Hal <span className="page-label">{safePage + 1}</span> / {totalPages}</span>
          <button className="chip chip-mini" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}>Next ›</button>
        </div>
      </div>

      {(results.erd_records || []).length > 0 && (
        <ErdTable records={results.erd_records} baseline={erdBaseline} target={erdTarget} />
      )}
    </div>
  );
}

function StatStrip({ label, value, delta, trend }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <span className={`trend ${trend || 'neutral'}`}>{delta}</span>}
    </div>
  );
}

function EmptyPlot({ title, sub }) {
  return (
    <div className="empty" style={{ margin: 'auto' }}>
      <EmptyArtWave />
      <h4>{title}</h4>
      <p>{sub}</p>
    </div>
  );
}

function EmptyArtWave() {
  const w = 220, h = 100;
  const pts = [];
  for (let x = 0; x <= w; x += 3) {
    const y = h / 2 + Math.sin(x * 0.07) * 18 + Math.sin(x * 0.22) * 6;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return (
    <svg className="empty-art" viewBox={`0 0 ${w} ${h}`} style={{ height: 110 }}>
      <path d={`M${pts.join(' L')}`} fill="none" stroke="#DDDFFB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[20, 60, 110, 160, 200].map(cx => <circle key={cx} cx={cx} cy={h - 6} r="3" fill="#DDDFFB" />)}
    </svg>
  );
}

function EmptyArtBrain() {
  return (
    <svg className="empty-art" viewBox="0 0 220 140" style={{ height: 120 }}>
      <ellipse cx="80" cy="70" rx="50" ry="55" fill="none" stroke="#DDDFFB" strokeWidth="2" />
      <ellipse cx="140" cy="70" rx="50" ry="55" fill="none" stroke="#DDDFFB" strokeWidth="2" />
      <path d="M 80 30 Q 110 50 80 110" fill="none" stroke="#DDDFFB" strokeWidth="1.5" />
      <path d="M 140 30 Q 110 90 140 110" fill="none" stroke="#DDDFFB" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyArtChart() {
  return (
    <svg className="empty-art" viewBox="0 0 220 140">
      {[20, 50, 80, 110, 140, 170].map((x, i) => {
        const hh = 30 + (i % 3) * 18;
        return <rect key={i} x={x} y={110 - hh} width="22" height={hh + 8} rx="8" fill="#DDDFFB" />;
      })}
      <line x1="10" y1="120" x2="210" y2="120" stroke="#DDDFFB" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

Object.assign(window, { SingleFilePage });
