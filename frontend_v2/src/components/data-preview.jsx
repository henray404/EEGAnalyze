/* global React, Icon, colKind, fmtColNum, COL_KIND_LABEL */
/*
 * Data preview — tabel preview dataset di Step 01 ML.
 *
 * Tabel lama nge-dump 15 kolom x 20 baris apa adanya: float 19 digit, sel
 * kosong tak terlihat, header tanpa konteks. Di sini tiap kolom dikasih peran
 * (target / group / fitur), angka dipendekin, sel kosong ditandai, header
 * sticky, dan ada filter + paginasi biar bisa dibaca.
 */
const { useState: useStateDP, useMemo: useMemoDP } = React;

const ROLE_LABEL = { target: 'target', group: 'group', feature: 'fitur', ignored: 'tidak dipakai' };

function DataPreview({ dataset, target, groupCol, featureCols }) {
  const [pageSize, setPageSize] = useStateDP(10);
  const [page, setPage] = useStateDP(0);
  const [q, setQ] = useStateDP('');
  const [usedOnly, setUsedOnly] = useStateDP(false);

  const allCols = dataset?.columns || [];
  const featSet = new Set(featureCols || []);

  const roleOf = (name) => {
    if (name === target) return 'target';
    if (name === groupCol) return 'group';
    if (featSet.has(name)) return 'feature';
    return 'ignored';
  };

  const usedCols = allCols.filter(c => roleOf(c.name) !== 'ignored');
  const cols = usedOnly ? usedCols : allCols;
  const nIgnored = allCols.length - usedCols.length;

  const rows = useMemoDP(() => {
    const all = dataset?.preview || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(needle)));
  }, [dataset, q]);

  const nPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, nPages - 1);
  const start = curPage * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const cell = (c, raw) => {
    const empty = raw === '' || raw === null || raw === undefined || raw === 'nan' || raw === 'NaN';
    if (empty) return <span className="dpv-null" title="Nilai kosong">—</span>;
    if (colKind(c) === 'numeric') return <span title={String(raw)}>{fmtColNum(raw)}</span>;
    if (c.name === target) {
      const cls = raw === 'ALS' ? 'badge-als' : raw === 'Normal' ? 'badge-normal' : 'badge-accent';
      return <span className={`badge ${cls}`}>{raw}</span>;
    }
    return <span>{raw}</span>;
  };

  return (
    <div className="dpv">
      <div className="dpv-toolbar">
        <div className="dpv-search">
          <Icon.Search />
          <input value={q} placeholder="Filter baris preview..."
            onChange={e => { setQ(e.target.value); setPage(0); }} />
          {q && <button type="button" className="cs-search-x" onClick={() => setQ('')}><Icon.X /></button>}
        </div>

        <div className="dpv-tools">
          {nIgnored > 0 && (
            <button type="button" className={`dpv-toggle ${usedOnly ? 'on' : ''}`}
              onClick={() => setUsedOnly(v => !v)}>
              <span className={`dpv-toggle-box ${usedOnly ? 'on' : ''}`}>{usedOnly && <Icon.Check />}</span>
              Sembunyikan {nIgnored} kolom tak terpakai
            </button>
          )}
          <label className="dpv-pagesize">
            Baris
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </label>
        </div>
      </div>

      <div className="dpv-legend">
        <span className="dpv-legend-item"><i className="dot role-target" /> target</span>
        {groupCol && <span className="dpv-legend-item"><i className="dot role-group" /> group</span>}
        <span className="dpv-legend-item"><i className="dot role-feature" /> fitur ({featSet.size})</span>
        {nIgnored > 0 && <span className="dpv-legend-item"><i className="dot role-ignored" /> tidak dipakai ({nIgnored})</span>}
        <span className="dpv-legend-note">
          {cols.length} kolom ditampilkan · preview {dataset?.preview?.length || 0} baris pertama dari {(dataset?.n_rows || 0).toLocaleString()}
        </span>
      </div>

      <div className="dpv-scroll">
        <table className="dpv-table">
          <thead>
            <tr>
              <th className="dpv-idx">#</th>
              {cols.map(c => {
                const role = roleOf(c.name);
                return (
                  <th key={c.name} className={`role-${role} ${colKind(c) === 'numeric' ? 'num' : ''}`}>
                    <span className="dpv-th-name">{c.name}</span>
                    <span className="dpv-th-sub">
                      <span className={`kind-badge kind-${colKind(c)}`}>{COL_KIND_LABEL[colKind(c)]}</span>
                      {role !== 'ignored' && <span className={`role-badge role-${role}`}>{ROLE_LABEL[role]}</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td className="dpv-empty" colSpan={cols.length + 1}>Tidak ada baris cocok filter itu.</td></tr>
            )}
            {pageRows.map((r, i) => (
              <tr key={start + i}>
                <td className="dpv-idx">{start + i + 1}</td>
                {cols.map(c => (
                  <td key={c.name} className={`role-${roleOf(c.name)} ${colKind(c) === 'numeric' ? 'num' : ''}`}>
                    {cell(c, r[c.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dpv-foot">
        <span>
          Menampilkan {rows.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, rows.length)} dari {rows.length} baris preview
          {q ? ' (terfilter)' : ''}
        </span>
        <div className="dpv-pager">
          <button type="button" className="btn-ghost" disabled={curPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <Icon.ArrowLeft /> Sebelumnya
          </button>
          <span className="dpv-page-label">{curPage + 1} / {nPages}</span>
          <button type="button" className="btn-ghost" disabled={curPage >= nPages - 1} onClick={() => setPage(p => Math.min(nPages - 1, p + 1))}>
            Berikutnya <Icon.Arrow />
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DataPreview });
