/* global React, Icon */
const { useState: useStateBT, useMemo: useMemoBT } = React;

const _SUBBANDS_BT = [
  { id: 'delta',     name: 'Delta' },
  { id: 'theta',     name: 'Theta' },
  { id: 'mu',        name: 'Mu' },
  { id: 'alpha',     name: 'Alpha' },
  { id: 'low_beta',  name: 'Low_Beta' },
  { id: 'beta',      name: 'Beta' },
  { id: 'high_beta', name: 'High_Beta' },
  { id: 'gamma',     name: 'Gamma' },
];

function _numStats(arr) {
  const nums = [];
  for (const v of arr) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    if (!isNaN(x)) nums.push(x);
  }
  if (nums.length === 0) return null;
  const n = nums.length;
  const sum = nums.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return { count: n, mean, std, min: nums.reduce((a, b) => a < b ? a : b, Infinity), max: nums.reduce((a, b) => a > b ? a : b, -Infinity) };
}

function _aggMean(arr) {
  const s = _numStats(arr);
  return s ? s.mean : null;
}

function _fmt(v, digits = 3) {
  if (v === null || v === undefined || isNaN(v)) return '-';
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  return v.toFixed(digits);
}

function _uniqueNonEmpty(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function _emptyTab(title, sub) {
  return (
    <div className="canvas">
      <div className="empty">
        <h4>{title}</h4>
        <p>{sub}</p>
      </div>
    </div>
  );
}

function _detectFeatureCols(records) {
  if (!records || records.length === 0) return [];
  const exclude = new Set([
    'category', 'subject', 'subject_name', 'scenario', 'event', 'run',
    'run_date', 'run_time', 'session', 'filename', 'task', 'channel', 'subband',
    'chunk', 'chunk_idx', 'chunk_start', 'chunk_end', 'occurrence', 'onset', 'duration',
  ]);
  // Scan beberapa record (bukan cuma record[0]) supaya kolom fitur tetap
  // terdeteksi walau nilai di record pertama kebetulan null/NaN.
  const sampleN = Math.min(records.length, 200);
  const cols = [];
  const seen = new Set();
  for (let i = 0; i < sampleN; i++) {
    const rec = records[i];
    if (!rec) continue;
    for (const k of Object.keys(rec)) {
      if (seen.has(k) || exclude.has(k)) continue;
      const v = rec[k];
      if (typeof v === 'number' && !Number.isNaN(v)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

function _resolveSubbandNames(records, subbandsPref) {
  const recordSubbands = _uniqueNonEmpty(records.map(r => r.subband));
  const prefNames = subbandsPref.map(id => _SUBBANDS_BT.find(s => s.id === id)?.name).filter(Boolean);
  let names = prefNames.filter(sb => recordSubbands.includes(sb));
  if (names.length === 0) names = recordSubbands;
  return names;
}

// ===================== FILE LIST TAB =====================
function FileListTab({ results }) {
  const records = results?.records || [];
  const errors = results?.errors || [];

  const fileMap = new Map();
  for (const r of records) {
    const key = r.filename || '?';
    if (!fileMap.has(key)) {
      fileMap.set(key, {
        filename: key,
        category: r.category || '-',
        subject: r.subject || '-',
        scenario: r.scenario || '-',
        n: 0,
      });
    }
    fileMap.get(key).n++;
  }
  const rows = Array.from(fileMap.values()).sort((a, b) => a.filename.localeCompare(b.filename));

  if (rows.length === 0 && errors.length === 0) {
    return _emptyTab('Belum ada file', 'Upload dan proses ZIP untuk melihat daftar file.');
  }

  return (
    <div style={{ padding: 24 }}>
      <div className="row mb-16">
        <span className="chip-mini">{rows.length} file diproses</span>
        {errors.length > 0 && <span className="chip-mini" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}>{errors.length} error</span>}
      </div>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Filename</th><th>Category</th><th>Subject</th><th>Scenario</th>
              <th className="num">Records</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}><span className="row gap-8"><Icon.File /> {r.filename}</span></td>
                <td><span className={`badge ${r.category === 'ALS' ? 'badge-als' : r.category === 'Normal' ? 'badge-normal' : 'badge-accent'}`}>{r.category}</span></td>
                <td>{r.subject}</td>
                <td>{r.scenario}</td>
                <td className="num">{r.n}</td>
                <td>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--success-tint)', color: 'var(--success)', display: 'inline-grid', placeItems: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                </td>
              </tr>
            ))}
            {errors.map((e, i) => (
              <tr key={`e${i}`}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{e.file}</td>
                <td colSpan="3" style={{ color: 'var(--danger)', fontSize: 12 }}>{e.error}</td>
                <td className="num">-</td>
                <td>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--danger-tint)', color: 'var(--danger)', display: 'inline-grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>!</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== CHART TAB (bar per subband, pure mean ± std) =====================
function ChartTab({ results, subbands }) {
  const records = results?.records || [];
  const featureCols = _detectFeatureCols(records);
  const sbNames = _resolveSubbandNames(records, subbands);
  const [feature, setFeature] = useStateBT(featureCols[0] || 'mav');
  const activeFeature = featureCols.includes(feature) ? feature : (featureCols[0] || 'mav');

  const statsBySubband = useMemoBT(() => {
    const out = {};
    for (const sb of sbNames) {
      const vals = records.filter(r => r.subband === sb).map(r => r[activeFeature]);
      out[sb] = _numStats(vals);
    }
    return out;
  }, [records, sbNames, activeFeature]);

  if (records.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat chart fitur per subband.');
  }
  if (sbNames.length === 0 || featureCols.length === 0) {
    return _emptyTab('Belum ada fitur', 'Tidak ada kolom fitur numerik atau subband di hasil batch.');
  }

  const meansForChart = sbNames.map(sb => statsBySubband[sb]?.mean ?? 0);
  const maxAbs = meansForChart.reduce((a, b) => Math.abs(b) > a ? Math.abs(b) : a, Number.EPSILON);

  const w = 800, h = 320;
  const groupW = (w - 80) / Math.max(sbNames.length, 1);
  const barW = Math.min(48, groupW * 0.6);
  const maxH = h - 70;

  return (
    <>
      <div className="ctrl-bar">
        <select value={activeFeature} onChange={e => setFeature(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          {featureCols.map(f => <option key={f} value={f}>Fitur: {f}</option>)}
        </select>
        <span className="spacer" />
        <span className="chip-mini">{records.length} records · {sbNames.length} subband</span>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="row-between mb-16">
            <div className="row gap-8">
              <Icon.Chart />
              <span style={{ fontWeight: 600 }}>{activeFeature.toUpperCase()} per Subband</span>
            </div>
            <span className="chip-mini accent">mean ± std (whisker)</span>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 360 }}>
            <defs>
              <linearGradient id="ctG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7B83E5" /><stop offset="100%" stopColor="#5B65DC" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map(t => (
              <g key={t}>
                <line x1="50" x2={w - 20} y1={20 + maxH * (1 - t)} y2={20 + maxH * (1 - t)} className="gridline" />
                <text x="42" y={24 + maxH * (1 - t)} textAnchor="end" className="axis-text">{_fmt(t * maxAbs, 2)}</text>
              </g>
            ))}
            {sbNames.map((sb, gi) => {
              const cx = 70 + gi * groupW + groupW / 2;
              const s = statsBySubband[sb] || { mean: 0, std: 0 };
              const v = s.mean ?? 0;
              const bH = Math.abs(v / maxAbs) * maxH;
              const y = v >= 0 ? 20 + maxH - bH : 20 + maxH;
              const std = s.std ?? 0;
              const stdH = Math.min((std / maxAbs) * maxH, maxH);
              const yTop = Math.max(20, y - stdH);
              const yBot = Math.min(20 + maxH, y + stdH);
              return (
                <g key={sb}>
                  <rect x={cx - barW / 2} y={y} width={barW} height={bH} rx="14" ry="14" fill="url(#ctG)" />
                  <line x1={cx} x2={cx} y1={yTop} y2={yBot} stroke="#3A45A8" strokeWidth="2" strokeLinecap="round" />
                  <line x1={cx - 6} x2={cx + 6} y1={yTop} y2={yTop} stroke="#3A45A8" strokeWidth="2" strokeLinecap="round" />
                  <line x1={cx - 6} x2={cx + 6} y1={yBot} y2={yBot} stroke="#3A45A8" strokeWidth="2" strokeLinecap="round" />
                  <text x={cx} y={h - 24} textAnchor="middle" className="axis-text axis-text-bold">{sb}</text>
                  <text x={cx} y={h - 8} textAnchor="middle" className="axis-text">μ={_fmt(v, 3)} ±{_fmt(std, 3)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </>
  );
}

// ===================== TABEL TAB (aggregation per subject × channel × subband) =====================
function TabelTab({ results, subbands }) {
  const records = results?.records || [];
  const featureCols = _detectFeatureCols(records);
  const sbNames = _resolveSubbandNames(records, subbands);

  const rows = useMemoBT(() => {
    const out = [];
    const groupMap = new Map();
    for (const r of records) {
      const key = `${r.subject ?? '-'}__${r.channel ?? '-'}__${r.subband ?? '-'}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          subject: r.subject || '-',
          channel: r.channel || '-',
          subband: r.subband || '-',
          category: r.category || '-',
          buckets: Object.fromEntries(featureCols.map(f => [f, []])),
        });
      }
      const g = groupMap.get(key);
      for (const f of featureCols) {
        if (typeof r[f] === 'number') g.buckets[f].push(r[f]);
      }
    }
    for (const g of groupMap.values()) {
      if (sbNames.length > 0 && !sbNames.includes(g.subband)) continue;
      const row = {
        subject: g.subject,
        channel: g.channel,
        subband: g.subband,
        category: g.category,
      };
      for (const f of featureCols) row[`${f}_mean`] = _aggMean(g.buckets[f]);
      out.push(row);
    }
    return out;
  }, [records, sbNames, featureCols]);

  if (records.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat tabel agregasi per subjek.');
  }
  if (featureCols.length === 0) {
    return _emptyTab('Belum ada fitur', 'Tidak ada kolom fitur numerik untuk agregasi.');
  }

  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini">{rows.length} baris (per subjek × channel × subband)</span>
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={() => window.downloadCSV(rows, `batch_aggregate_${Date.now()}.csv`)}>
          <Icon.Download /> CSV
        </button>
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Cat</th><th>Subject</th><th>Channel</th><th>Subband</th>
                {featureCols.map(f => <th key={f} className="num">{f} (mean)</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => (
                <tr key={i}>
                  <td><span className={`badge ${r.category === 'ALS' ? 'badge-als' : r.category === 'Normal' ? 'badge-normal' : 'badge-accent'}`}>{r.category}</span></td>
                  <td>{r.subject}</td>
                  <td>{r.channel}</td>
                  <td><span className="badge badge-accent">{r.subband}</span></td>
                  {featureCols.map(f => <td key={f} className="num">{_fmt(r[`${f}_mean`])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && <div className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>Menampilkan 300 baris pertama dari {rows.length}. Download CSV untuk lengkap.</div>}
        </div>
      </div>
    </>
  );
}

// ===================== HEATMAP TAB (channel × subband, pure mean) =====================
function HeatmapTab({ results, subbands, channels }) {
  const records = results?.records || [];
  const featureCols = _detectFeatureCols(records);
  const [feature, setFeature] = useStateBT(featureCols[0] || 'mav');
  const activeFeature = featureCols.includes(feature) ? feature : (featureCols[0] || 'mav');

  const cols = _resolveSubbandNames(records, subbands);
  const recordChannels = _uniqueNonEmpty(records.map(r => r.channel));
  const selectedRows = (channels || []).filter(ch => recordChannels.includes(ch));
  const rows = (selectedRows.length > 0 ? selectedRows : recordChannels).slice(0, 16);

  const cellVals = useMemoBT(() => {
    return rows.map(ch => cols.map(sb => {
      const vals = records.filter(r => r.channel === ch && r.subband === sb).map(r => r[activeFeature]);
      return _aggMean(vals);
    }));
  }, [records, rows, cols, activeFeature]);

  if (records.length === 0 || rows.length === 0 || cols.length === 0) {
    return _emptyTab('Belum ada data heatmap', 'Pilih channel + subband dan proses batch.');
  }
  if (featureCols.length === 0) {
    return _emptyTab('Belum ada fitur', 'Tidak ada kolom fitur numerik untuk heatmap.');
  }

  const flat = cellVals.flat().filter(v => v !== null);
  const minV = flat.reduce((a, b) => a < b ? a : b, Infinity);
  const maxV = flat.reduce((a, b) => a > b ? a : b, -Infinity);
  const span = (maxV - minV) || 1;

  return (
    <>
      <div className="ctrl-bar">
        <select value={activeFeature} onChange={e => setFeature(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          {featureCols.map(f => <option key={f} value={f}>Fitur: {f}</option>)}
        </select>
        <span className="spacer" />
        <div className="row gap-8" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span>{_fmt(minV, 2)}</span>
          <span style={{ width: 100, height: 8, borderRadius: 999, background: 'linear-gradient(90deg, #EEEFFD, #7B83E5, #3A45A8)' }} />
          <span>{_fmt(maxV, 2)}</span>
        </div>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${cols.length}, 1fr)`, gap: 4, marginBottom: 6 }}>
            <div />
            {cols.map(c => <div key={c} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c}</div>)}
          </div>
          {rows.map((r, ri) => (
            <div key={r} style={{ display: 'grid', gridTemplateColumns: `80px repeat(${cols.length}, 1fr)`, gap: 4, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{r}</div>
              {cols.map((c, ci) => {
                const v = cellVals[ri][ci];
                if (v === null) return <div key={c} style={{ background: 'var(--surface-tint)', borderRadius: 8, height: 32 }} />;
                const t = (v - minV) / span;
                const alpha = 0.12 + t * 0.83;
                const bg = `rgba(91, 101, 220, ${alpha})`;
                return (
                  <div key={c} style={{
                    background: bg, borderRadius: 8, padding: '8px 4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10.5, fontWeight: 600, height: 32,
                    color: t > 0.55 ? '#fff' : 'var(--text-primary)',
                  }}>{_fmt(v, 2)}</div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ===================== SCATTER TAB (any X vs any Y, color by subband) =====================
function ScatterTab({ results }) {
  const records = results?.records || [];
  const featureCols = _detectFeatureCols(records);
  const subbandsAvail = _uniqueNonEmpty(records.map(r => r.subband));
  const [xKey, setXKey] = useStateBT(featureCols[0] || 'mav');
  const [yKey, setYKey] = useStateBT(featureCols[1] || featureCols[0] || 'variance');
  const [sbFilter, setSbFilter] = useStateBT('all');

  const activeX = featureCols.includes(xKey) ? xKey : (featureCols[0] || 'mav');
  const activeY = featureCols.includes(yKey) ? yKey : (featureCols[1] || featureCols[0] || 'variance');

  const points = records
    .filter(r => (sbFilter === 'all' || r.subband === sbFilter)
      && typeof r[activeX] === 'number' && typeof r[activeY] === 'number')
    .map(r => ({ x: r[activeX], y: r[activeY], sb: r.subband }));

  if (records.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat scatter plot.');
  }
  if (featureCols.length < 2 && featureCols.length < 1) {
    return _emptyTab('Belum ada fitur', 'Butuh minimal 1 kolom fitur numerik untuk scatter.');
  }
  if (points.length === 0) {
    return _emptyTab('Tidak ada titik', 'Pilih X/Y fitur lain atau subband yang ada datanya.');
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = xs.reduce((a, b) => a < b ? a : b, Infinity);
  const xMax = xs.reduce((a, b) => a > b ? a : b, -Infinity);
  const yMin = ys.reduce((a, b) => a < b ? a : b, Infinity);
  const yMax = ys.reduce((a, b) => a > b ? a : b, -Infinity);
  const norm = (v, lo, hi) => hi === lo ? 0.5 : (v - lo) / (hi - lo);

  const sbColors = ['#5B65DC', '#7B83E5', '#4A53C0', '#8E96EE', '#3A45A8', '#A1A7F2', '#6F3D9E', '#B07B1F'];
  const sbColorMap = {};
  subbandsAvail.forEach((sb, i) => { sbColorMap[sb] = sbColors[i % sbColors.length]; });

  const w = 800, h = 360, pad = 50, innerW = w - pad - 20, innerH = h - pad - 30;

  return (
    <>
      <div className="ctrl-bar">
        <select value={activeX} onChange={e => setXKey(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          {featureCols.map(f => <option key={f} value={f}>X: {f}</option>)}
        </select>
        <select value={activeY} onChange={e => setYKey(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          {featureCols.map(f => <option key={f} value={f}>Y: {f}</option>)}
        </select>
        <select value={sbFilter} onChange={e => setSbFilter(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5 }}>
          <option value="all">Subband: All</option>
          {subbandsAvail.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <span className="chip-mini">{points.length} points</span>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="row-between mb-16">
            <div className="row gap-8"><Icon.Chart /><span style={{ fontWeight: 600 }}>{activeX} vs {activeY}</span></div>
            <div className="row gap-12" style={{ fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              {subbandsAvail.map(s => (
                <span key={s}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: sbColorMap[s], marginRight: 5 }} />{s}</span>
              ))}
            </div>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 360 }}>
            {[0.25, 0.5, 0.75, 1].map(t => (
              <g key={t}>
                <line x1={pad} x2={w - 20} y1={20 + innerH * (1 - t)} y2={20 + innerH * (1 - t)} className="gridline" />
                <line x1={pad + innerW * t} x2={pad + innerW * t} y1="20" y2={20 + innerH} className="gridline" />
              </g>
            ))}
            <text x={w - 30} y={20 + innerH + 18} textAnchor="end" className="axis-text">{activeX} →</text>
            <text x={pad - 36} y="24" className="axis-text">{activeY}</text>
            {points.map((p, i) => {
              const cx = pad + innerW * norm(p.x, xMin, xMax);
              const cy = 20 + innerH * (1 - norm(p.y, yMin, yMax));
              return (
                <circle key={i} cx={cx} cy={cy} r="5"
                  fill={sbColorMap[p.sb] || '#5B65DC'}
                  stroke="#fff" strokeWidth="1.5" opacity="0.8" />
              );
            })}
          </svg>
          <div className="row gap-12 mt-12" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span>X range: [{_fmt(xMin)}, {_fmt(xMax)}]</span>
            <span>Y range: [{_fmt(yMin)}, {_fmt(yMax)}]</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ===================== DATA TABLE =====================
function DataTableTab({ results, subbands, onDownloadExcel, exporting }) {
  const allRecords = results?.records || [];
  const [page, setPage] = useStateBT(0);
  const [taskFilter, setTaskFilter] = useStateBT('all');
  const [sbFilter, setSbFilter] = useStateBT('all');
  const pageSize = 50;

  if (allRecords.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat tabel record.');
  }

  const tasks = Array.from(new Set(allRecords.map(r => r.task).filter(Boolean)));
  const sbs = Array.from(new Set(allRecords.map(r => r.subband).filter(Boolean)));

  const filtered = allRecords.filter(r =>
    (taskFilter === 'all' || r.task === taskFilter) &&
    (sbFilter === 'all' || r.subband === sbFilter),
  );

  const cols = filtered.length > 0 ? Object.keys(filtered[0]) : Object.keys(allRecords[0]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <>
      <div className="ctrl-bar">
        <select value={taskFilter} onChange={e => { setTaskFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5 }}>
          <option value="all">Task: All</option>
          {tasks.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sbFilter} onChange={e => { setSbFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5 }}>
          <option value="all">Subband: All</option>
          {sbs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <span className="chip-mini">{filtered.length} records</span>
      </div>
      <div style={{ padding: 24 }}>
        <div className="row mb-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => window.downloadCSV(filtered, `batch_records_${Date.now()}.csv`)}>
            <Icon.Download /> CSV
          </button>
          <button className="btn btn-primary" onClick={onDownloadExcel} disabled={exporting}>
            <Icon.Download /> {exporting ? 'Generating...' : 'Excel'}
          </button>
        </div>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="dt">
            <thead><tr>
              {cols.map(c => (
                <th key={c} className={typeof filtered[0]?.[c] === 'number' ? 'num' : ''}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={safePage * pageSize + i}>
                  {cols.map(c => {
                    const v = r[c];
                    const isNum = typeof v === 'number';
                    if (c === 'category') return <td key={c}><span className={`badge ${v === 'ALS' ? 'badge-als' : v === 'Normal' ? 'badge-normal' : 'badge-accent'}`}>{v}</span></td>;
                    if (c === 'subband') return <td key={c}><span className="badge badge-accent">{v}</span></td>;
                    return <td key={c} className={isNum ? 'num' : ''} style={c === 'filename' ? { fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 } : {}}>
                      {isNum ? _fmt(v) : (v ?? '-')}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button className="chip chip-mini" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>‹ Prev</button>
            <span>Hal <span className="page-label">{safePage + 1}</span> / {totalPages}</span>
            <button className="chip chip-mini" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}>Next ›</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ===================== RINGKASAN =====================
function RingkasanTab({ results, scanMeta }) {
  const records = results?.records || [];
  if (records.length === 0) {
    return _emptyTab('Belum ada ringkasan', 'Proses batch untuk melihat ringkasan akhir.');
  }
  const subjects = _uniqueNonEmpty(records.map(r => r.subject));
  const tasks = _uniqueNonEmpty(records.map(r => r.task));
  const channels = _uniqueNonEmpty(records.map(r => r.channel));
  const sbs = _uniqueNonEmpty(records.map(r => r.subband));
  const featureCols = _detectFeatureCols(records);
  const errs = results?.errors?.length || 0;
  const processed = results?.processed_files || new Set(records.map(r => r.filename)).size;

  const rows = [
    ['Total records', records.length.toLocaleString()],
    ['Files diproses', `${processed} / ${scanMeta?.total_files || processed}`],
    ['Mode', results?.mode === 'chunk' ? `Chunk ${results.chunk_duration}s` : 'Full Data'],
    ['Subjek', subjects.length],
    ['Tasks', tasks.join(', ') || '-'],
    ['Channels', channels.length],
    ['Subbands', sbs.join(', ') || '-'],
    ['Fitur', featureCols.join(', ') || '-'],
    ['Errors', errs],
  ];

  return (
    <div style={{ padding: 28 }}>
      <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 600 }}>Ringkasan Batch</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 720 }}>
        {rows.map(([l, v]) => (
          <div key={l} className="row-between" style={{ background: 'var(--surface-tint)', borderRadius: 12, padding: '14px 18px' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{l}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== ENCODING TAB =====================
function EncodingTab({ results, onDownloadEncoding, onDownloadEncodingExcel, exporting }) {
  const enc = results?.encoding_records || [];
  const [taskF, setTaskF] = useStateBT('all');
  const [sbF, setSbF] = useStateBT('all');
  const [chF, setChF] = useStateBT('all');
  const [page, setPage] = useStateBT(0);
  const pageSize = 50;

  if (enc.length === 0) {
    return _emptyTab('Belum ada encoding', 'Proses batch dengan mode Chunk untuk melihat chain encoding.');
  }

  const tasks    = _uniqueNonEmpty(enc.map(r => r.task));
  const subbands = _uniqueNonEmpty(enc.map(r => r.subband));
  const channels = _uniqueNonEmpty(enc.map(r => r.channel));
  const hasOccurrence = enc.some(r => r.occurrence != null);

  // detect chain feature columns (chain_mav_sequence, chain_mav_ratio, etc.)
  const firstRow = enc[0] || {};
  const chainFeats = Array.from(new Set(
    Object.keys(firstRow)
      .filter(k => k.endsWith('_sequence'))
      .map(k => k.replace('_sequence', '').replace('chain_', ''))
  ));

  const filtered = enc.filter(r =>
    (taskF === 'all' || r.task === taskF) &&
    (sbF   === 'all' || r.subband === sbF) &&
    (chF   === 'all' || r.channel === chF)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const selStyle = { padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5 };

  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini accent">Chain Encoding</span>
        <select value={taskF} onChange={e => { setTaskF(e.target.value); setPage(0); }} style={selStyle}>
          <option value="all">Task: All</option>
          {tasks.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sbF} onChange={e => { setSbF(e.target.value); setPage(0); }} style={selStyle}>
          <option value="all">Subband: All</option>
          {subbands.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={chF} onChange={e => { setChF(e.target.value); setPage(0); }} style={selStyle}>
          <option value="all">Channel: All</option>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="spacer" />
        <span className="chip-mini">{filtered.length} rows</span>
        <button className="btn btn-secondary" onClick={onDownloadEncoding} disabled={enc.length === 0}>
          <Icon.Download /> CSV
        </button>
        {onDownloadEncodingExcel && (
          <button className="btn btn-primary" onClick={onDownloadEncodingExcel} disabled={enc.length === 0 || exporting}>
            <Icon.Download /> {exporting ? 'Generating...' : 'Excel'}
          </button>
        )}
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Category</th>
                <th>Subject</th>
                <th>Task</th>
                {hasOccurrence && <th>Occurrence</th>}
                <th>Channel</th>
                <th>Subband</th>
                {chainFeats.map(f => (
                  <React.Fragment key={f}>
                    <th>{f} sequence</th>
                    <th className="num">{f} ratio</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.category ?? '-'}</td>
                  <td>{r.subject ?? '-'}</td>
                  <td>{r.task ?? '-'}</td>
                  {hasOccurrence && <td>{r.occurrence ?? '-'}</td>}
                  <td>{r.channel}</td>
                  <td><span className="badge badge-accent">{r.subband}</span></td>
                  {chainFeats.map(f => (
                    <React.Fragment key={f}>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, letterSpacing: 1 }}>
                        {r[`chain_${f}_sequence`] ?? '-'}
                      </td>
                      <td className="num">
                        {r[`chain_${f}_ratio`] != null ? (r[`chain_${f}_ratio`] * 100).toFixed(1) + '%' : '-'}
                      </td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={5 + (hasOccurrence ? 1 : 0) + chainFeats.length * 2} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
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
      </div>
    </>
  );
}

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

Object.assign(window, { FileListTab, ChartTab, TabelTab, HeatmapTab, ScatterTab, DataTableTab, RingkasanTab, EncodingTab });
