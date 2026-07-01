/* global React, Icon */
const { useState, useRef: useRefB, useCallback, useEffect } = React;
const Api = window.Api;
const AppConfigB = window.AppConfig;
const { FileListTab, ChartTab, TabelTab, HeatmapTab, ScatterTab, DataTableTab, RingkasanTab, EncodingTab } = window;

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

function SliderB({ min = 0, max = 1, value, onChange, step = 0.01, snapPoints }) {
  const trackRef = useRefB(null);
  const dragging = useRefB(false);

  const clamp = (v) => {
    const snapped = step ? Math.round(v / step) * step : v;
    return Math.min(max, Math.max(min, parseFloat(snapped.toFixed(10))));
  };

  const posToValue = useCallback((clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clamp(min + ratio * (max - min));
  }, [min, max, step]);

  const onTrackPointerDown = (e) => {
    e.preventDefault();
    dragging.current = true;
    trackRef.current.setPointerCapture(e.pointerId);
    onChange(posToValue(e.clientX));
  };

  const onPointerMove = (e) => {
    if (!dragging.current) return;
    onChange(posToValue(e.clientX));
  };

  const onPointerUp = () => { dragging.current = false; };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}
      >
        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 999, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: 'var(--accent)', borderRadius: 999 }} />
          <div style={{
            position: 'absolute', top: '50%', left: `${pct}%`,
            width: 20, height: 20, borderRadius: '50%',
            background: '#fff', border: '2px solid var(--accent)',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 2px 6px rgba(91,101,220,0.25)',
            cursor: 'grab',
          }} />
        </div>
      </div>
      {snapPoints && (
        <div className="row gap-8 mt-12" style={{ flexWrap: 'wrap' }}>
          {snapPoints.map(sp => (
            <button key={sp}
              className={`chip-mini ${sp === value ? 'accent' : ''}`}
              onClick={() => onChange(sp)}
              style={{ cursor: 'pointer' }}>
              {sp} s
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchPage() {
  const [file, setFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanMeta, setScanMeta] = useState(null); // {data_type, total_files|total_sessions, ...}
  const [dataType, setDataType] = useState('edf'); // 'edf' | 'recoverix'
  const [uploadError, setUploadError] = useState(null);
  const [kategori, setKategori] = useState(['ALS', 'Normal']);
  const [subjects, setSubjects] = useState([]); // filter subjek (recoveriX)
  const [scenario, setScenario] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [bandpass, setBandpass] = useState(true); // toggle bandpass (recoveriX; EDF selalu on)
  const [erdMethods, setErdMethods] = useState(['intratrial', 'paired']); // metode ERD recoveriX
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
  const [erdEnabled, setErdEnabled] = useState(false);
  const [erdBaseline, setErdBaseline] = useState('');
  const [erdTarget, setErdTarget] = useState('');
  const [erdCompare, setErdCompare] = useState(false);
  const [tab, setTab] = useState('chart');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRefB(null);

  const isRecoverix = dataType === 'recoverix';
  const allChannelsBatch = scanMeta?.channels?.length ? scanMeta.channels : DEFAULT_CHANNELS_B;
  const allTasksBatch = scanMeta?.tasks?.length ? scanMeta.tasks : ['T1', 'T2', 'T3', 'T4'];
  const totalFiles = scanMeta?.total_files ?? scanMeta?.total_sessions ?? 0;
  const totalSubjects = scanMeta?.subjects?.length || 0;
  const unitLabel = isRecoverix ? 'sesi' : 'file';

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
      const dt = data.data_type || 'edf';
      setDataType(dt);
      setScanMeta(data);
      setTasks(data.tasks || []);
      setChannels((data.channels || []).slice(0, 8));
      setScenario(data.scenarios || []);
      if (dt === 'recoverix') {
        setSubjects(data.subjects || []);
        setKategori([]);
        // Data recoveriX sudah difilter di device: semua filter sinyal default OFF.
        setBandpass(false); setNotch(false); setCar(false); setAmp(false);
        setBad(false); setIca(false);
        setExtractMode('full');
      } else {
        setKategori(data.categories || ['ALS', 'Normal']);
        setBandpass(true); setNotch(true);
      }
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
    try {
      const data = await Api.batchProcessStream(file, {
        bp_low: AppConfigB.BP_DEFAULT_LOW,
        bp_high: AppConfigB.BP_DEFAULT_HIGH,
        bp_order: AppConfigB.BP_DEFAULT_ORDER,
        use_bandpass: isRecoverix ? bandpass : true,
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
        erd_enabled: erdEnabled,
        erd_baseline_task: erdBaseline,
        erd_target_task: erdTarget,
        erd_compare_enabled: erdCompare,
        erd_compare_baseline: 'Resting',
        erd_compare_tasks: 'Resting,Thinking',
        recoverix_erd_methods: erdMethods.join(','),
        filter_categories: kategori.join(','),
        filter_subjects: subjects.join(','),
        filter_scenarios: scenario.join(','),
        filter_tasks: tasks.join(','),
        filter_channels: channels.join(','),
      }, (processed, total) => {
        setFilesProcessed(processed);
        setProgress(total > 0 ? Math.round((processed / total) * 100) : 0);
      });
      setResults(data);
      setFilesProcessed(data.processed_files ?? data.processed_sessions ?? totalFiles);
      setProgress(100);
      setDone(true);
    } catch (e) {
      setApiError(e.message || 'Gagal proses batch');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadEncodingCSV = () => {
    if (!results?.encoding_records?.length) return;
    window.downloadCSV(results.encoding_records, `batch_encoding_${Date.now()}.csv`);
  };

  const handleExportEncodingExcel = async () => {
    if (!results?.encoding_records?.length || exporting) return;
    setExporting(true);
    setApiError(null);
    const fname = `batch_encoding_${Date.now()}.xlsx`;
    try {
      const blob = await Api.exportExcel(
        window.recordsToScenarioSheets(results.encoding_records, 'Encoding'), fname,
      );
      window.downloadBlob(blob, fname);
    } catch (e) {
      setApiError(e.message || 'Export Excel gagal');
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcelBatch = async () => {
    if (!results || !results.records || results.records.length === 0) return;
    if (exporting) return;
    setExporting(true);
    setApiError(null);
    const fname = `batch_features_${Date.now()}.xlsx`;
    try {
      const blob = await Api.exportExcel(
        window.recordsToScenarioSheets(results.records, 'Features'), fname,
      );
      window.downloadBlob(blob, fname);
    } catch (e) {
      setApiError(e.message || 'Export Excel gagal');
    } finally {
      setExporting(false);
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
            <button className="btn btn-primary" onClick={handleExportExcelBatch} disabled={!done || exporting}>
              <Icon.Download /> {exporting ? 'Generating...' : 'Export Excel'}
            </button>
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
                      <ScanRow label={isRecoverix ? 'Tipe data' : 'Total file EDF'} value={isRecoverix ? <span className="badge badge-accent">recoveriX</span> : scanMeta.total_files} />
                      {isRecoverix && <ScanRow label="Total sesi" value={scanMeta.total_sessions} />}
                      {!isRecoverix && (
                        <ScanRow label="Kategori" value={
                          <>{(scanMeta.categories || []).map(c => (
                            <span key={c} className={`badge ${c === 'ALS' ? 'badge-als' : c === 'Normal' ? 'badge-normal' : 'badge-accent'}`} style={{ marginRight: 4 }}>{c}</span>
                          ))}</>
                        } />
                      )}
                      <ScanRow label="Subjek" value={(scanMeta.subjects || []).length} />
                      {(scanMeta.scenarios || []).length > 0 && (
                        <ScanRow label="Scenario" wrapValue value={
                          <>{(scanMeta.scenarios || []).map(s => <span key={s} className="chip-mini" style={{ marginRight: 4 }}>{s}</span>)}</>
                        } />
                      )}
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
                {!isRecoverix && (
                  <FilterGroupB label="Kategori" counter={`${kategori.length}/${(scanMeta?.categories || ['ALS', 'Normal']).length} dipilih`}
                    action={<ChipAllRow options={scanMeta?.categories || ['ALS', 'Normal']} onChange={setKategori} />}>
                    <ChipGroupB options={scanMeta?.categories || ['ALS', 'Normal']} value={kategori} onChange={setKategori} />
                  </FilterGroupB>
                )}
                {isRecoverix && (scanMeta?.subjects || []).length > 0 && (
                  <FilterGroupB label="Subjek" counter={`${subjects.length}/${(scanMeta?.subjects || []).length} dipilih`}
                    action={<ChipAllRow options={scanMeta.subjects} onChange={setSubjects} />}>
                    <ChipGroupB options={scanMeta.subjects} value={subjects} onChange={setSubjects} />
                  </FilterGroupB>
                )}
                {(scanMeta?.scenarios || []).length > 0 && (
                  <FilterGroupB label="Scenario" counter={`${scenario.length}/${(scanMeta?.scenarios || []).length} dipilih`}
                    action={<ChipAllRow options={scanMeta.scenarios} onChange={setScenario} />}>
                    <ChipGroupB options={scanMeta.scenarios} value={scenario} onChange={setScenario} />
                  </FilterGroupB>
                )}
                {!isRecoverix ? (
                  <FilterGroupB label="Task" counter={`${tasks.length}/${allTasksBatch.length} dipilih`}
                    action={<ChipAllRow options={allTasksBatch} onChange={setTasks} />}>
                    <ChipGroupB options={allTasksBatch} value={tasks} onChange={setTasks} />
                  </FilterGroupB>
                ) : (
                  <FilterGroupB label="Task">
                    <div className="chip-group">
                      {allTasksBatch.map(t => <span key={t} className="chip selected" style={{ opacity: 0.7 }}>{t}</span>)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>recoveriX: kondisi Left/Right tetap.</div>
                  </FilterGroupB>
                )}
                <FilterGroupB label="Subband" counter={`${subbands.length}/${SUBBANDS_B.length} dipilih`}
                  action={<ChipAllRow options={SUBBANDS_B} onChange={setSubbands} />}>
                  <ChipGroupB options={SUBBANDS_B} value={subbands} onChange={setSubbands} />
                </FilterGroupB>
                <FilterGroupB label="Channel" counter={`${channels.length}/${allChannelsBatch.length} dipilih`}
                  action={<ChipAllRow options={allChannelsBatch} onChange={setChannels} />}>
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
                {(() => {
                  const featOpts = [
                    { id: 'mav', name: 'MAV' }, { id: 'variance', name: 'Variance' }, { id: 'std', name: 'STD' },
                    { id: 'band_power', name: 'Band Power' }, { id: 'relative_power', name: 'Rel. Power' }, { id: 'peak_frequency', name: 'Peak Freq' },
                  ];
                  return (
                    <FilterGroupB label="Fitur Statistik" counter={`${features.length}/${featOpts.length} dipilih`}
                      action={<ChipAllRow options={featOpts} onChange={setFeatures} />}>
                      <ChipGroupB options={featOpts} value={features} onChange={setFeatures} />
                    </FilterGroupB>
                  );
                })()}
                {!isRecoverix ? (
                  <div className="form-row">
                    <label>ERD/ERS</label>
                    <ToggleRowB on={erdEnabled} onChange={v => { setErdEnabled(v); if (!v) { setErdBaseline(''); setErdTarget(''); } }} label="Hitung ERD/ERS" />
                    {erdEnabled && (() => {
                      const selStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, width: '100%', marginTop: 4 };
                      return (
                        <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface-tint)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ERD = (Task - Baseline) / Baseline × 100%</div>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Baseline Task</div>
                            <select value={erdBaseline} onChange={e => setErdBaseline(e.target.value)} style={selStyle}>
                              <option value="">-- pilih --</option>
                              {allTasksBatch.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Target Task</div>
                            <select value={erdTarget} onChange={e => setErdTarget(e.target.value)} style={selStyle}>
                              <option value="">-- pilih --</option>
                              {allTasksBatch.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="form-row">
                    <label>ERD/ERS (recoveriX)</label>
                    <ChipGroupB
                      options={[{ id: 'intratrial', name: 'Intra-trial' }, { id: 'paired', name: 'Paired' }]}
                      value={erdMethods} onChange={setErdMethods}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Intra-trial: pre-cue vs post-cue per kondisi. Paired: baseline task vs target task.
                    </div>
                    {erdMethods.includes('paired') && (() => {
                      const selStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, width: '100%', marginTop: 4 };
                      return (
                        <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface-tint)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Baseline Task</div>
                            <select value={erdBaseline} onChange={e => setErdBaseline(e.target.value)} style={selStyle}>
                              <option value="">-- pilih --</option>
                              {allTasksBatch.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 2 }}>Target Task</div>
                            <select value={erdTarget} onChange={e => setErdTarget(e.target.value)} style={selStyle}>
                              <option value="">-- pilih --</option>
                              {allTasksBatch.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 3: Filter Sinyal */}
            {scanned && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">STEP 03</span>
                  <h3>Filter Sinyal</h3>
                </div>
                {isRecoverix && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 10, fontSize: 11.5 }}>
                    Data recoveriX sudah difilter di perangkat (HP 0.5 / LP 30 / Notch 50 Hz). Filter di bawah opsional, default OFF.
                  </div>
                )}
                {isRecoverix && (
                  <div className="sub-card"><ToggleRowB on={bandpass} onChange={setBandpass} label="Bandpass Filter" /></div>
                )}
                {!isRecoverix && (
                  <div className="sub-card">
                    <div className="row-between mb-12">
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>Bandpass Filter</span>
                    </div>
                    <div className="chip-group">
                      <button className={`chip ${filterMode === 'preset' ? 'selected' : ''}`} onClick={() => setFilterMode('preset')}>Preset Subband</button>
                      <button className={`chip ${filterMode === 'custom' ? 'selected' : ''}`} onClick={() => setFilterMode('custom')}>Custom Range</button>
                    </div>
                  </div>
                )}
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

            {/* SECTION 5: Ekstraksi (chunk hanya untuk EDF; recoveriX full) */}
            {scanned && !isRecoverix && (
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
                    <div className="row-between">
                      <label style={{ marginBottom: 0 }}>Durasi Chunk</label>
                      <span className="chip-mini accent">{chunkDur.toFixed(2)} s</span>
                    </div>
                    <SliderB
                      min={0.05} max={2.0} step={0.05}
                      value={chunkDur} onChange={setChunkDur}
                      snapPoints={[0.25, 0.5, 1.0, 1.5, 2.0]}
                    />
                  </div>
                )}
                {extractMode === 'chunk' && (
                  <div className="sub-card" style={{ marginTop: 12 }}>
                    <ToggleRowB on={erdCompare} onChange={setErdCompare} label="ERD Compare (Resting vs Thinking)" />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Aktifkan untuk chart ERD% chunk per kondisi di tab Chunk Kondisi.</div>
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
                { id: 'files',    label: 'File List' },
                { id: 'chart',    label: 'Chart' },
                { id: 'tabel',    label: 'Tabel' },
                { id: 'heatmap',  label: 'Heatmap' },
                { id: 'scatter',  label: 'Scatter' },
                ...(results?.mode === 'chunk' ? [{ id: 'encoding', label: 'Encoding' }] : []),
                ...((isRecoverix ? erdMethods.length > 0 : erdEnabled) ? [{ id: 'erd', label: 'ERD/ERS' }] : []),
                ...(results?.mode === 'chunk' ? [{ id: 'chunk-compare', label: 'Chunk Kondisi' }] : []),
                { id: 'data',     label: 'Data Table' },
                { id: 'sum',      label: 'Ringkasan' },
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
                  <h4>Upload file ZIP untuk memulai ekstraksi fitur</h4>
                  <p>Ringkasan fitur, tabel record, dan statistik akan tampil di sini setelah proses selesai.</p>
                </div>
              </div>
            ) : processing ? (
              <div className="canvas">
                <div className="empty">
                  <BatchEmptyArt />
                  <h4>Memproses {filesProcessed} / {totalFiles} file...</h4>
                  <p>Pipeline paralel menjalankan ekstraksi fitur per record.</p>
                </div>
              </div>
            ) : (
              <>
                {tab === 'files'    && <FileListTab results={results} />}
                {tab === 'chart'    && <ChartTab results={results} subbands={subbands} />}
                {tab === 'tabel'    && <TabelTab results={results} subbands={subbands} />}
                {tab === 'heatmap'  && <HeatmapTab results={results} subbands={subbands} channels={channels} />}
                {tab === 'scatter'  && <ScatterTab results={results} />}
                {tab === 'encoding' && <EncodingTab results={results} onDownloadEncoding={handleDownloadEncodingCSV} onDownloadEncodingExcel={handleExportEncodingExcel} exporting={exporting} />}
                {tab === 'erd'          && <BatchErdTab results={results} baseline={erdBaseline} target={erdTarget} />}
                {tab === 'chunk-compare' && <ChunkCompareTab results={results} />}
                {tab === 'data'         && <DataTableTab results={results} subbands={subbands} onDownloadExcel={handleExportExcelBatch} exporting={exporting} />}
                {tab === 'sum'      && <RingkasanTab results={results} scanMeta={scanMeta} />}
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

function ChipAllRow({ options, onChange }) {
  const allIds = (options || []).map(o => (typeof o === 'string' ? o : o.id));
  return (
    <span className="row gap-8">
      <button type="button" className="chip-mini accent" style={{ border: 'none', cursor: 'pointer' }} onClick={() => onChange(allIds)}>Pilih Semua</button>
      <button type="button" className="chip-mini" style={{ border: 'none', cursor: 'pointer' }} onClick={() => onChange([])}>Hapus Semua</button>
    </span>
  );
}

function FilterGroupB({ label, counter, action, children }) {
  return (
    <div className="form-row">
      <label>
        <span>{label}</span>
        {action || (counter && <span className="hint">{counter}</span>)}
      </label>
      {action && counter && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4, marginBottom: 4 }}>{counter}</div>
      )}
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
  const processedFiles = results?.processed_files ?? new Set(records.map(r => r.filename)).size;
  const subjectCount = totalSubjects ?? new Set(records.map(r => r.subject).filter(Boolean)).size;
  const channelCount = new Set(records.map(r => r.channel).filter(Boolean)).size;
  const subbandCount = new Set(records.map(r => r.subband).filter(Boolean)).size;

  const labelStyle = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 };
  const valStyle = { fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' };

  return (
    <div className="stat-strip" style={{ marginBottom: 24 }}>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>FILES DIPROSES</div>
        <div style={valStyle}>{processedFiles}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>TOTAL RECORDS</div>
        <div style={valStyle}>{records.length.toLocaleString()}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>SUBJEK</div>
        <div style={valStyle}>{subjectCount}</div>
      </div>
      <div className="card card-pad" style={{ padding: 18 }}>
        <div className="label" style={labelStyle}>CHANNELS × SUBBANDS</div>
        <div style={valStyle}>{channelCount} × {subbandCount}</div>
      </div>
    </div>
  );
}

function BatchErdTab({ results, baseline, target }) {
  const isRec = results?.data_type === 'recoverix';
  const records = isRec
    ? [...(results?.erd_records || []), ...(results?.erd_paired_records || [])]
    : (results?.erd_records || []);
  const [page, setPage] = useState(0);
  const [catFilter, setCatFilter] = useState('all');
  const [sbFilter, setSbFilter] = useState('all');
  const pageSize = 25;

  if (records.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: '12px 16px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12.5 }}>
          {isRec
            ? 'Tidak ada data ERD. Pilih metode ERD (intra-trial/paired) sebelum proses.'
            : 'Tidak ada data ERD. Pastikan baseline dan target task ada di semua file yang diproses.'}
        </div>
      </div>
    );
  }

  // recoveriX: kolom "Kategori" diisi kondisi (Left/Right), "File" diisi session.
  const catKey = (r) => (isRec ? r.task : r.category);
  const cats = Array.from(new Set(records.map(catKey).filter(Boolean)));
  const sbs = Array.from(new Set(records.map(r => r.subband).filter(Boolean)));
  const hasChunk = records.some(r => r.chunk != null);

  const filtered = records.filter(r =>
    (catFilter === 'all' || catKey(r) === catFilter) &&
    (sbFilter === 'all' || r.subband === sbFilter),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const fmtN = (v) => {
    if (v === null || v === undefined) return '-';
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) return String(v);
    if (Math.abs(n) < 0.001 && n !== 0) return n.toExponential(2);
    return n.toFixed(4);
  };

  return (
    <div style={{ padding: 24 }}>
      <div className="row-between mb-16">
        <div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>ERD/ERS Batch</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
            {isRec
              ? 'recoveriX: intra-trial (pre/post-cue) + paired (Left/Right)'
              : <>Baseline: <strong>{baseline}</strong> → Target: <strong>{target}</strong></>}
          </span>
          <span className="chip-mini" style={{ marginLeft: 10 }}>{records.length} records</span>
        </div>
        <div className="row gap-8">
          <button className="btn btn-secondary" onClick={() => window.downloadCSV(records, `batch_erd_${Date.now()}.csv`)}>
            <Icon.Download /> CSV
          </button>
          <button className="btn btn-primary" onClick={async () => {
            const fname = `batch_erd_${Date.now()}.xlsx`;
            try { const blob = await window.Api.exportExcel(window.recordsToScenarioSheets(records, 'ERD_ERS'), fname); window.downloadBlob(blob, fname); } catch (e) { alert(e.message || 'Export gagal'); }
          }}>
            <Icon.Download /> Excel
          </button>
        </div>
      </div>
      <div className="row mb-16" style={{ gap: 8 }}>
        <select className="fpill" value={catFilter} onChange={e => { setCatFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)' }}>
          <option value="all">{isRec ? 'Kondisi: All' : 'Kategori: All'}</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="fpill" value={sbFilter} onChange={e => { setSbFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)' }}>
          <option value="all">Subband: All</option>
          {sbs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>{isRec ? 'Kondisi' : 'Kategori'}</th><th>Subject</th><th>{isRec ? 'Session' : 'File'}</th>
              <th>Channel</th><th>Subband</th>
              {hasChunk && <th className="num">Chunk</th>}
              <th className="num">Baseline Power</th>
              <th className="num">Task Power</th>
              <th className="num">ERD/ERS (%)</th>
              <th>Tipe</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const pct = r.erd_ers_pct;
              const isErd = pct < 0;
              const fname = (r.filename || r.session || '').split('/').pop();
              const catVal = catKey(r);
              return (
                <tr key={safePage * pageSize + i}>
                  <td><span className={`badge ${catVal === 'ALS' ? 'badge-als' : catVal === 'Normal' ? 'badge-normal' : 'badge-accent'}`}>{catVal || '-'}</span></td>
                  <td>{r.subject || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{fname}</td>
                  <td>{r.channel}</td>
                  <td><span className="badge badge-accent">{r.subband}</span></td>
                  {hasChunk && <td className="num">{r.chunk}</td>}
                  <td className="num">{fmtN(r.baseline_power)}</td>
                  <td className="num">{fmtN(r.task_power)}</td>
                  <td className="num" style={{ fontWeight: 700, color: isErd ? 'var(--danger)' : 'var(--success)' }}>
                    {pct != null ? (pct > 0 ? '+' : '') + fmtN(pct) + '%' : '-'}
                  </td>
                  <td>
                    {pct != null ? <span className="badge" style={{ background: isErd ? 'var(--danger-tint)' : 'var(--success-tint)', color: isErd ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{isErd ? 'ERD' : 'ERS'}</span> : '-'}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={hasChunk ? 10 : 9} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Tidak ada data sesuai filter</td></tr>
            )}
          </tbody>
        </table>
        <div className="pagination">
          <button className="chip chip-mini" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>‹ Prev</button>
          <span>Hal <span className="page-label">{safePage + 1}</span> / {totalPages}</span>
          <button className="chip chip-mini" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}>Next ›</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BatchPage });
