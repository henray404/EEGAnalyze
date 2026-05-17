/* global React, Icon */
const { useState: useStateBT, useMemo: useMemoBT, useEffect: useEffectBT } = React;

const _SUBBANDS_BT = [
  { id: 'delta', name: 'Delta' },
  { id: 'theta', name: 'Theta' },
  { id: 'mu', name: 'Mu' },
  { id: 'alpha', name: 'Alpha' },
  { id: 'low_beta', name: 'Low_Beta' },
  { id: 'beta', name: 'Beta' },
  { id: 'high_beta', name: 'High_Beta' },
  { id: 'gamma', name: 'Gamma' },
];

function _aggMean(arr) {
  if (!arr || arr.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of arr) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    if (!isNaN(x)) { sum += x; n++; }
  }
  return n === 0 ? null : sum / n;
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

// ===================== DELTA CHART TAB =====================
function DeltaChartTab({ results, subbands }) {
  const records = results?.records || [];
  const sbNamesPref = subbands.map(id => _SUBBANDS_BT.find(s => s.id === id)?.name).filter(Boolean);
  const sbNamesAvail = _uniqueNonEmpty(records.map(r => r.subband));
  let sbNames = sbNamesPref.filter(sb => sbNamesAvail.includes(sb));
  if (sbNames.length === 0) sbNames = sbNamesAvail;
  const [featureKey, setFeatureKey] = useStateBT('mav');

  const aggregates = useMemoBT(() => {
    const out = {};
    for (const sb of sbNames) {
      const alsVals = records.filter(r => r.subband === sb && r.category === 'ALS').map(r => r[featureKey]);
      const normVals = records.filter(r => r.subband === sb && r.category === 'Normal').map(r => r[featureKey]);
      out[sb] = { als: _aggMean(alsVals), normal: _aggMean(normVals) };
    }
    return out;
  }, [records, sbNames, featureKey]);

  if (records.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat delta chart per subband.');
  }
  if (sbNames.length === 0) {
    return _emptyTab('Belum ada data subband', 'Data hasil batch tidak memiliki subband yang bisa diplot.');
  }

  const allVals = Object.values(aggregates).flatMap(v => [v.als, v.normal]).filter(v => v !== null);
  const axisMax = Math.max(...allVals.map(v => Math.abs(v)), Number.EPSILON) * 1.05;

  const w = 800, h = 320;
  const groupW = (w - 80) / Math.max(sbNames.length, 1);
  const barW = 30;
  const maxH = h - 70;

  return (
    <>
      <div className="ctrl-bar">
        <select value={featureKey} onChange={e => setFeatureKey(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          <option value="mav">Fitur: MAV</option>
          <option value="variance">Fitur: Variance</option>
          <option value="std">Fitur: STD</option>
        </select>
        <span className="spacer" />
        <span className="chip-mini">{records.length} records</span>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="row-between mb-16">
            <div className="row gap-8">
              <Icon.Chart />
              <span style={{ fontWeight: 600 }}>{featureKey.toUpperCase()} · per Subband</span>
            </div>
            <div className="row gap-12" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#B13A4C', marginRight: 5 }} />ALS</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#1F7A52', marginRight: 5 }} />Normal</span>
            </div>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 360 }}>
            <defs>
              <linearGradient id="alsGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C95466" /><stop offset="100%" stopColor="#B13A4C" />
              </linearGradient>
              <linearGradient id="normGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2D9264" /><stop offset="100%" stopColor="#1F7A52" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map(t => (
              <g key={t}>
                <line x1="50" x2={w - 20} y1={20 + maxH * (1 - t)} y2={20 + maxH * (1 - t)} className="gridline" />
                <text x="42" y={24 + maxH * (1 - t)} textAnchor="end" className="axis-text">{_fmt(t * axisMax, 2)}</text>
              </g>
            ))}
            {sbNames.map((sb, gi) => {
              const cx = 70 + gi * groupW + groupW / 2;
              const als = aggregates[sb]?.als ?? 0;
              const norm = aggregates[sb]?.normal ?? 0;
              const alsH = (als / axisMax) * maxH;
              const normH = (norm / axisMax) * maxH;
              return (
                <g key={sb}>
                  <rect x={cx - barW - 4} y={20 + maxH - alsH} width={barW} height={alsH} rx="14" ry="14" fill="url(#alsGrad2)" />
                  <rect x={cx + 4} y={20 + maxH - normH} width={barW} height={normH} rx="14" ry="14" fill="url(#normGrad2)" />
                  <text x={cx} y={h - 24} textAnchor="middle" className="axis-text axis-text-bold">{sb}</text>
                  <text x={cx} y={h - 8} textAnchor="middle" className="axis-text">ALS {_fmt(als, 2)} · N {_fmt(norm, 2)}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </>
  );
}

// ===================== TABEL DELTA =====================
function TabelDeltaTab({ results, subbands }) {
  const records = results?.records || [];
  const sbNames = subbands.map(id => _SUBBANDS_BT.find(s => s.id === id)?.name).filter(Boolean);

  const rows = useMemoBT(() => {
    const out = [];
    const subjectMap = new Map();
    for (const r of records) {
      const key = `${r.category}_${r.subject}_${r.channel}_${r.subband}`;
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          category: r.category, subject: r.subject, channel: r.channel, subband: r.subband,
          mav: [], variance: [], std: [],
        });
      }
      const e = subjectMap.get(key);
      if (typeof r.mav === 'number') e.mav.push(r.mav);
      if (typeof r.variance === 'number') e.variance.push(r.variance);
      if (typeof r.std === 'number') e.std.push(r.std);
    }
    for (const e of subjectMap.values()) {
      if (!sbNames.includes(e.subband)) continue;
      out.push({
        ...e,
        mavMean: _aggMean(e.mav),
        varianceMean: _aggMean(e.variance),
        stdMean: _aggMean(e.std),
      });
    }
    return out;
  }, [records, sbNames]);

  if (records.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat tabel agregasi per subjek.');
  }

  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini">{rows.length} baris (per subjek × channel × subband)</span>
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Cat</th><th>Subject</th><th>Channel</th><th>Subband</th>
                <th className="num">MAV (avg)</th><th className="num">Variance (avg)</th><th className="num">STD (avg)</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={i}>
                  <td><span className={`badge ${r.category === 'ALS' ? 'badge-als' : 'badge-normal'}`}>{r.category}</span></td>
                  <td>{r.subject}</td>
                  <td>{r.channel}</td>
                  <td>{r.subband}</td>
                  <td className="num">{_fmt(r.mavMean)}</td>
                  <td className="num">{_fmt(r.varianceMean)}</td>
                  <td className="num">{_fmt(r.stdMean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && <div className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>Menampilkan 200 baris pertama dari {rows.length}</div>}
        </div>
      </div>
    </>
  );
}

// ===================== HEATMAP =====================
function HeatmapTab({ results, subbands, channels }) {
  const records = results?.records || [];
  const selectedCols = subbands.map(id => _SUBBANDS_BT.find(s => s.id === id)?.name).filter(Boolean);
  const recordSubbands = _uniqueNonEmpty(records.map(r => r.subband));
  let cols = selectedCols.filter(sb => recordSubbands.includes(sb));
  if (cols.length === 0) cols = recordSubbands;

  const recordChannels = _uniqueNonEmpty(records.map(r => r.channel));
  const selectedRows = (channels || []).filter(ch => recordChannels.includes(ch));
  const rows = (selectedRows.length > 0 ? selectedRows : recordChannels).slice(0, 12);

  const cellVals = useMemoBT(() => {
    return rows.map(ch => cols.map(sb => {
      const alsVals = records.filter(r => r.channel === ch && r.subband === sb && r.category === 'ALS').map(r => r.mav);
      const normVals = records.filter(r => r.channel === ch && r.subband === sb && r.category === 'Normal').map(r => r.mav);
      const als = _aggMean(alsVals);
      const norm = _aggMean(normVals);
      if (als === null && norm === null) return null;
      return (als ?? 0) - (norm ?? 0);
    }));
  }, [records, rows, cols]);

  if (records.length === 0 || rows.length === 0 || cols.length === 0) {
    return _emptyTab('Belum ada data heatmap', 'Pilih channel + subband dan proses batch.');
  }

  const flat = cellVals.flat().filter(v => v !== null);
  const maxAbs = Math.max(...flat.map(Math.abs), 0.001);

  return (
    <>
      <div className="ctrl-bar">
        <span className="chip-mini accent">Δ MAV (ALS − Normal)</span>
        <span className="spacer" />
        <div className="row gap-8" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <span>−{_fmt(maxAbs, 2)}</span>
          <span style={{ width: 100, height: 8, borderRadius: 999, background: 'linear-gradient(90deg, #1F7A52, #DDDFFB, #B13A4C)' }} />
          <span>+{_fmt(maxAbs, 2)}</span>
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
                const alpha = 0.08 + (Math.abs(v) / maxAbs) * 0.87;
                const bg = v >= 0 ? `rgba(177, 58, 76, ${alpha})` : `rgba(31, 122, 82, ${alpha})`;
                return (
                  <div key={c} style={{
                    background: bg, borderRadius: 8, padding: '8px 4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10.5, fontWeight: 600, height: 32,
                    color: Math.abs(v) / maxAbs > 0.55 ? '#fff' : 'var(--text-primary)',
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

// ===================== SCATTER =====================
function ScatterTab({ results }) {
  const records = results?.records || [];
  const subbandsAvail = _uniqueNonEmpty(records.map(r => r.subband));
  const [subband, setSubband] = useStateBT('');

  useEffectBT(() => {
    if (subbandsAvail.length === 0) return;
    if (!subbandsAvail.includes(subband)) setSubband(subbandsAvail[0]);
  }, [subbandsAvail, subband]);

  const activeSubband = subbandsAvail.includes(subband) ? subband : (subbandsAvail[0] || '');

  const points = records
    .filter(r => r.subband === activeSubband && typeof r.mav === 'number' && typeof r.variance === 'number')
    .map(r => ({ x: r.mav, y: r.variance, cat: r.category }));

  if (records.length === 0 || points.length === 0) {
    return _emptyTab('Belum ada scatter data', 'Pilih subband yang ada di hasil dan proses batch.');
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const norm = (v, lo, hi) => hi === lo ? 0.5 : (v - lo) / (hi - lo);

  const w = 800, h = 360, pad = 50, innerW = w - pad - 20, innerH = h - pad - 30;

  return (
    <>
      <div className="ctrl-bar">
        <select value={activeSubband} onChange={e => setSubband(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600 }}>
          {subbandsAvail.map(s => <option key={s} value={s}>Subband: {s}</option>)}
        </select>
        <span className="spacer" />
        <span className="chip-mini">{points.length} points</span>
      </div>
      <div style={{ padding: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="row-between mb-16">
            <div className="row gap-8"><Icon.Chart /><span style={{ fontWeight: 600 }}>MAV vs Variance · {activeSubband}</span></div>
            <div className="row gap-12" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#B13A4C', marginRight: 5 }} />ALS</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1F7A52', marginRight: 5 }} />Normal</span>
            </div>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 360 }}>
            {[0.25, 0.5, 0.75, 1].map(t => (
              <g key={t}>
                <line x1={pad} x2={w - 20} y1={20 + innerH * (1 - t)} y2={20 + innerH * (1 - t)} className="gridline" />
                <line x1={pad + innerW * t} x2={pad + innerW * t} y1="20" y2={20 + innerH} className="gridline" />
              </g>
            ))}
            <text x={w - 30} y={20 + innerH + 18} textAnchor="end" className="axis-text">MAV (µV) →</text>
            <text x={pad - 36} y="24" className="axis-text">Var</text>
            {points.map((p, i) => {
              const cx = pad + innerW * norm(p.x, xMin, xMax);
              const cy = 20 + innerH * (1 - norm(p.y, yMin, yMax));
              const isAls = p.cat === 'ALS';
              return (
                <circle key={i} cx={cx} cy={cy} r="6"
                  fill={isAls ? '#B13A4C' : '#1F7A52'}
                  stroke="#fff" strokeWidth="2" opacity="0.85" />
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
function DataTableTab({ results, subbands, onDownloadExcel }) {
  const allRecords = results?.records || [];
  const [page, setPage] = useStateBT(0);
  const [catFilter, setCatFilter] = useStateBT('all');
  const [taskFilter, setTaskFilter] = useStateBT('all');
  const [sbFilter, setSbFilter] = useStateBT('all');
  const pageSize = 50;

  if (allRecords.length === 0) {
    return _emptyTab('Belum ada data', 'Proses batch untuk melihat tabel record.');
  }

  const cats = Array.from(new Set(allRecords.map(r => r.category).filter(Boolean)));
  const tasks = Array.from(new Set(allRecords.map(r => r.task).filter(Boolean)));
  const sbs = Array.from(new Set(allRecords.map(r => r.subband).filter(Boolean)));

  const filtered = allRecords.filter(r =>
    (catFilter === 'all' || r.category === catFilter) &&
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
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setPage(0); }}
          style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5 }}>
          <option value="all">Kategori: All</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
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
          <button className="btn btn-primary" onClick={onDownloadExcel}>
            <Icon.Download /> Excel
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
  const cats = Array.from(new Set(records.map(r => r.category).filter(Boolean)));
  const subjects = Array.from(new Set(records.map(r => r.subject).filter(Boolean)));
  const tasks = Array.from(new Set(records.map(r => r.task).filter(Boolean)));
  const channels = Array.from(new Set(records.map(r => r.channel).filter(Boolean)));
  const sbs = Array.from(new Set(records.map(r => r.subband).filter(Boolean)));
  const errs = results?.errors?.length || 0;
  const processed = results?.processed_files || new Set(records.map(r => r.filename)).size;

  const rows = [
    ['Total records', records.length.toLocaleString()],
    ['Files diproses', `${processed} / ${scanMeta?.total_files || processed}`],
    ['Mode', results?.mode === 'chunk' ? `Chunk ${results.chunk_duration}s` : 'Full Data'],
    ['Kategori', cats.join(', ') || '-'],
    ['Subjek', subjects.length],
    ['Tasks', tasks.join(', ') || '-'],
    ['Channels', channels.length],
    ['Subbands', sbs.join(', ') || '-'],
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

Object.assign(window, { FileListTab, DeltaChartTab, TabelDeltaTab, HeatmapTab, ScatterTab, DataTableTab, RingkasanTab });
