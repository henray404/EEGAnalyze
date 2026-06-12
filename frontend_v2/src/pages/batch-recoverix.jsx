/* global React, Icon, ChipGroupB, formatSizeB, _fmt */
const { useState: useStateBR, useRef: useRefBR } = React;
const ApiBR = window.Api;
const AppConfigBR = window.AppConfig;

const FEATURES_BR = [
  { id: 'mav', name: 'MAV' },
  { id: 'variance', name: 'Variance' },
  { id: 'std', name: 'STD' },
];

function RecoverixTable({ records, emptyLabel }) {
  if (!records || !records.length) {
    return (
      <div className="sub-card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
        {emptyLabel}
      </div>
    );
  }
  const cols = Object.keys(records[0]);
  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table className="dt">
        <thead>
          <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              {cols.map(c => {
                const v = r[c];
                const isNum = typeof v === 'number';
                return <td key={c} className={isNum ? 'num' : ''}>{isNum ? _fmt(v) : (v ?? '-')}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchRecoverixPage() {
  const [file, setFile] = useStateBR(null);
  const [scanning, setScanning] = useStateBR(false);
  const [scanned, setScanned] = useStateBR(false);
  const [scanMeta, setScanMeta] = useStateBR(null);
  const [uploadError, setUploadError] = useStateBR(null);

  const [subbands, setSubbands] = useStateBR(['delta', 'theta', 'alpha', 'beta', 'gamma']);
  const [features, setFeatures] = useStateBR(['mav', 'variance', 'std']);
  const [channels, setChannels] = useStateBR([]);
  const [subjects, setSubjects] = useStateBR([]);
  const [scenarios, setScenarios] = useStateBR([]);

  const [processing, setProcessing] = useStateBR(false);
  const [progress, setProgress] = useStateBR(0);
  const [sessionsProcessed, setSessionsProcessed] = useStateBR(0);
  const [done, setDone] = useStateBR(false);
  const [results, setResults] = useStateBR(null);
  const [apiError, setApiError] = useStateBR(null);
  const [exporting, setExporting] = useStateBR(false);

  const fileInputRef = useRefBR(null);

  const resetResults = () => {
    setDone(false);
    setResults(null);
    setApiError(null);
  };

  const handleUpload = async (f) => {
    if (!f) return;
    setFile(f);
    setUploadError(null);
    setScanning(true);
    setScanned(false);
    resetResults();
    try {
      const data = await ApiBR.batchRecoverixScan(f);
      setScanMeta(data);
      setChannels(data.channels || []);
      setSubjects(data.subjects || []);
      setScenarios(data.scenarios || []);
      setScanned(true);
    } catch (e) {
      setUploadError(e.message || 'Gagal scan ZIP. Pastikan ZIP berisi sesi recoveriX (rawData*.tar.gz).');
      setScanMeta(null);
    } finally {
      setScanning(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setScanned(false);
    setScanning(false);
    setScanMeta(null);
    setUploadError(null);
    resetResults();
  };

  const handleProcess = async () => {
    if (!file || !scanned) return;
    setProcessing(true);
    setProgress(0);
    setSessionsProcessed(0);
    resetResults();
    try {
      const data = await ApiBR.batchRecoverixProcessStream(file, {
        subbands: subbands.join(','),
        features: features.join(','),
        filter_subjects: subjects.join(','),
        filter_scenarios: scenarios.join(','),
        filter_channels: channels.join(','),
      }, (processedN, totalN) => {
        setSessionsProcessed(processedN);
        setProgress(totalN > 0 ? Math.round((processedN / totalN) * 100) : 0);
      });
      setResults(data);
      setProgress(100);
      setDone(true);
    } catch (e) {
      setApiError(e.message || 'Gagal proses batch recoveriX');
    } finally {
      setProcessing(false);
    }
  };

  const handleExport = async (records, filename) => {
    if (!records || !records.length || exporting) return;
    setExporting(true);
    setApiError(null);
    try {
      const sheets = window.recordsToScenarioSheets(records, 'Features');
      const blob = await ApiBR.exportExcel(sheets, filename);
      window.downloadBlob(blob, filename);
    } catch (e) {
      setApiError(e.message || 'Export Excel gagal');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main data-screen-label="06 Batch recoveriX">
      <div className="page">
        <div className="page-head">
          <div className="page-head-text">
            <div className="crumb">Analisis <Icon.Chev /> Batch recoveriX</div>
            <h2>Batch recoveriX</h2>
            <p className="subtitle">
              Upload ZIP berisi banyak sesi recoveriX (per pasien/skenario). Tiap sesi diproses
              terpisah - fitur regular (MAV/Variance/STD) per kondisi (Left/Right) dan ERD
              intra-trial per kondisi. Data recoveriX sudah difilter di perangkat, tidak ada
              opsi filter sinyal di sini.
            </p>
          </div>
        </div>

        <div className="side-section">
          <div className="side-title-row">
            <span className="eyebrow">STEP 01</span>
            <h3>Upload ZIP Sesi recoveriX</h3>
          </div>
          <input
            ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
          />
          {file ? (
            <div className="file-card">
              <div className="file-card-badge"><Icon.Folder /></div>
              <div className="file-card-info">
                <div className="name">{file.name}</div>
                <div className="meta">{formatSizeB(file.size)} - ZIP</div>
              </div>
              <button className="file-card-x" onClick={handleClear}><Icon.X /></button>
            </div>
          ) : (
            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
              <Icon.Folder /> Pilih ZIP
            </button>
          )}
          {scanning && (
            <div className="row gap-8" style={{ background: 'var(--accent-tint)', padding: '8px 14px', borderRadius: 999, fontSize: 12.5, color: 'var(--accent)', fontWeight: 500, marginTop: 10 }}>
              <span className="loading-dot" /> Membaca sesi recoveriX...
            </div>
          )}
          {uploadError && (
            <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
              {uploadError}
            </div>
          )}
        </div>

        {scanned && scanMeta && (
          <>
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 02</span>
                <h3>{scanMeta.total_sessions} Sesi Ditemukan</h3>
              </div>
              <RecoverixTable records={scanMeta.sessions} emptyLabel="Tidak ada sesi." />
            </div>

            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">STEP 03</span>
                <h3>Konfigurasi</h3>
              </div>
              <div className="sub-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div className="label-sm">Subband</div>
                  <ChipGroupB options={AppConfigBR.SUBBANDS} value={subbands} onChange={setSubbands} />
                </div>
                <div>
                  <div className="label-sm">Fitur</div>
                  <ChipGroupB options={FEATURES_BR} value={features} onChange={setFeatures} />
                </div>
                <div>
                  <div className="label-sm">Channel</div>
                  <ChipGroupB options={scanMeta.channels || []} value={channels} onChange={setChannels} />
                </div>
                <div>
                  <div className="label-sm">Subjek</div>
                  <ChipGroupB options={scanMeta.subjects || []} value={subjects} onChange={setSubjects} />
                </div>
                <div>
                  <div className="label-sm">Skenario</div>
                  <ChipGroupB options={scanMeta.scenarios || []} value={scenarios} onChange={setScenarios} />
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleProcess} disabled={processing}>
                <Icon.Zap /> {processing
                  ? `Memproses... ${sessionsProcessed}/${scanMeta.total_sessions} (${progress}%)`
                  : 'Proses Batch'}
              </button>
              {apiError && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
                  {apiError}
                </div>
              )}
            </div>
          </>
        )}

        {done && results && (
          <>
            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">HASIL</span>
                <h3>Fitur Regular ({results.records.length} record)</h3>
              </div>
              <button
                className="btn btn-secondary" style={{ marginBottom: 12 }}
                onClick={() => handleExport(results.records, `batch_recoverix_features_${Date.now()}.xlsx`)}
                disabled={exporting}
              >
                <Icon.Download /> {exporting ? 'Generating...' : 'Export Excel'}
              </button>
              <RecoverixTable records={results.records} emptyLabel="Tidak ada record fitur." />
            </div>

            <div className="side-section">
              <div className="side-title-row">
                <span className="eyebrow">HASIL</span>
                <h3>ERD Intra-trial ({results.erd_records.length} record)</h3>
              </div>
              <button
                className="btn btn-secondary" style={{ marginBottom: 12 }}
                onClick={() => handleExport(results.erd_records, `batch_recoverix_erd_${Date.now()}.xlsx`)}
                disabled={exporting}
              >
                <Icon.Download /> {exporting ? 'Generating...' : 'Export Excel'}
              </button>
              <RecoverixTable records={results.erd_records} emptyLabel="Tidak ada record ERD." />
            </div>

            {results.errors && results.errors.length > 0 && (
              <div className="side-section">
                <div className="side-title-row">
                  <span className="eyebrow">PERINGATAN</span>
                  <h3>Sesi Gagal ({results.errors.length})</h3>
                </div>
                <RecoverixTable records={results.errors} emptyLabel="Tidak ada error." />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { BatchRecoverixPage });
