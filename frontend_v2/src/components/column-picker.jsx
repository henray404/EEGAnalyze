/* global React, Icon */
/*
 * Column picker — dropdown target/group + daftar fitur untuk Step 01 ML.
 *
 * Native <select> cuma bisa nampilin satu baris teks per opsi, jadi user harus
 * nebak isi kolom dari namanya. Komponen ini nampilin tipe, jumlah unique,
 * missing, dan contoh nilai tiap kolom, plus search buat dataset lebar.
 */
const { useState: useStateCP, useRef: useRefCP, useEffect: useEffectCP, useMemo: useMemoCP } = React;

const COL_KIND_LABEL = {
  numeric: 'numerik',
  categorical: 'teks',
  boolean: 'boolean',
  datetime: 'tanggal',
};

/** Kind kolom; fallback ke is_numeric buat payload backend versi lama. */
function colKind(c) {
  return c.kind || (c.is_numeric ? 'numeric' : 'categorical');
}

/** Angka panjang (mis. 0.0000045782) jadi pendek tapi tetap informatif. */
function fmtColNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e6 || a < 1e-4) return n.toExponential(2);
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return String(Number(n.toFixed(3)));
  return String(Number(n.toPrecision(3)));
}

/** Ringkasan satu baris buat ditempel di bawah nama kolom. */
function colMetaLine(c) {
  const bits = [`${(c.n_unique ?? 0).toLocaleString()} unique`];
  if (c.n_missing > 0) bits.push(`${c.n_missing.toLocaleString()} kosong`);
  if (colKind(c) === 'numeric' && c.min !== null && c.min !== undefined) {
    bits.push(`${fmtColNum(c.min)} … ${fmtColNum(c.max)}`);
  } else if (c.sample_values && c.sample_values.length) {
    bits.push(c.sample_values.slice(0, 3).join(', '));
  }
  return bits.join(' · ');
}

function KindBadge({ c }) {
  const k = colKind(c);
  return <span className={`kind-badge kind-${k}`} title={c.dtype}>{COL_KIND_LABEL[k] || k}</span>;
}

// ===================== SEARCHABLE COLUMN DROPDOWN =====================
function ColumnSelect({
  columns, value, onChange, disabled,
  placeholder = '— pilih kolom —',
  emptyLabel = null,          // kalau diisi, ada opsi "kosongkan" di paling atas
  recommend = null,           // fn(col) -> string|null, label saran (mis. "cocok jadi target")
  searchPlaceholder = 'Cari kolom...',
}) {
  const [open, setOpen] = useStateCP(false);
  const [q, setQ] = useStateCP('');
  const [hi, setHi] = useStateCP(0);
  const rootRef = useRefCP(null);
  const inputRef = useRefCP(null);
  const listRef = useRefCP(null);

  const cols = columns || [];
  const selected = cols.find(c => c.name === value) || null;

  const filtered = useMemoCP(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cols;
    return cols.filter(c => c.name.toLowerCase().includes(needle)
      || (c.sample_values || []).some(v => String(v).toLowerCase().includes(needle)));
  }, [cols, q]);

  // Opsi datar (termasuk baris "kosongkan") supaya index highlight konsisten.
  const options = emptyLabel ? [null, ...filtered] : filtered;

  useEffectCP(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffectCP(() => {
    if (!open) return;
    setQ('');
    const idx = (emptyLabel ? [null, ...cols] : cols).findIndex(o => o && o.name === value);
    setHi(idx < 0 ? 0 : idx);
    inputRef.current?.focus();
  }, [open]);

  useEffectCP(() => {
    const el = listRef.current?.querySelector('.cs-opt.hi');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (col) => { onChange(col ? col.name : ''); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options.length) pick(options[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className={`cs ${disabled ? 'disabled' : ''}`} ref={rootRef}>
      <button type="button" className={`cs-trigger ${open ? 'open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); } }}>
        <span className="cs-trigger-main">
          {selected ? (
            <>
              <span className="cs-trigger-head">
                <span className="cs-name">{selected.name}</span>
                <KindBadge c={selected} />
              </span>
              <span className="cs-meta">{colMetaLine(selected)}</span>
            </>
          ) : (
            <span className="cs-placeholder">{disabled ? 'Upload dataset dulu' : placeholder}</span>
          )}
        </span>
        <span className="cs-chev"><Icon.ChevDown /></span>
      </button>

      {open && (
        <div className="cs-pop">
          <div className="cs-search">
            <Icon.Search />
            <input ref={inputRef} value={q} placeholder={searchPlaceholder}
              onChange={e => { setQ(e.target.value); setHi(0); }}
              onKeyDown={onKeyDown} />
            {q && <button type="button" className="cs-search-x" onClick={() => { setQ(''); inputRef.current?.focus(); }}><Icon.X /></button>}
          </div>
          <div className="cs-list" ref={listRef} role="listbox">
            {options.length === 0 && <div className="cs-none">Tidak ada kolom cocok pencarian itu.</div>}
            {options.map((c, i) => {
              if (c === null) {
                return (
                  <div key="__empty" role="option" aria-selected={!value}
                    className={`cs-opt cs-opt-empty ${hi === i ? 'hi' : ''} ${!value ? 'sel' : ''}`}
                    onMouseEnter={() => setHi(i)} onClick={() => pick(null)}>
                    <span className="cs-opt-name muted">{emptyLabel}</span>
                    {!value && <span className="cs-check"><Icon.Check /></span>}
                  </div>
                );
              }
              const tip = recommend ? recommend(c) : null;
              return (
                <div key={c.name} role="option" aria-selected={c.name === value}
                  className={`cs-opt ${hi === i ? 'hi' : ''} ${c.name === value ? 'sel' : ''}`}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(c)}>
                  <div className="cs-opt-body">
                    <div className="cs-opt-head">
                      <span className="cs-opt-name">{c.name}</span>
                      <KindBadge c={c} />
                      {tip && <span className="kind-badge kind-hint">{tip}</span>}
                      {c.n_missing > 0 && <span className="kind-badge kind-warn">{c.missing_pct != null ? `${c.missing_pct}%` : c.n_missing} kosong</span>}
                    </div>
                    <div className="cs-opt-meta">{colMetaLine(c)}</div>
                  </div>
                  {c.name === value && <span className="cs-check"><Icon.Check /></span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== FEATURE PICKER =====================
/** Prefix sebelum separator pertama; dipakai buat kelompokin mav/variance/std. */
function _featPrefix(name) {
  const m = String(name).split(/[_.\-\s]/)[0];
  return m || name;
}

function FeaturePicker({ columns, selected, onChange, disabled }) {
  const [q, setQ] = useStateCP('');
  const cols = columns || [];
  const sel = selected || [];
  const selSet = new Set(sel);

  const filtered = useMemoCP(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cols;
    return cols.filter(c => c.name.toLowerCase().includes(needle));
  }, [cols, q]);

  // Grup per prefix cuma kalau memang mengurangi kebisingan (dataset lebar
  // dengan nama berpola mav / mav_encoded / variance / ...).
  const groups = useMemoCP(() => {
    if (filtered.length <= 6) return [{ key: '', cols: filtered }];
    const map = new Map();
    for (const c of filtered) {
      const k = _featPrefix(c.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    if (map.size < 2 || map.size > filtered.length - 1) return [{ key: '', cols: filtered }];
    return [...map.entries()].map(([key, cs]) => ({ key, cols: cs }));
  }, [filtered]);

  const toggle = (name) => onChange(selSet.has(name) ? sel.filter(x => x !== name) : [...sel, name]);
  const toggleGroup = (gcols) => {
    const names = gcols.map(c => c.name);
    const allOn = names.every(n => selSet.has(n));
    onChange(allOn ? sel.filter(n => !names.includes(n))
      : Array.from(new Set([...sel, ...names])));
  };

  const allNames = cols.map(c => c.name);
  const nMissing = cols.filter(c => selSet.has(c.name) && c.n_missing > 0).length;

  return (
    <div className="feat-picker">
      <div className="feat-toolbar">
        <div className="feat-search">
          <Icon.Search />
          <input value={q} placeholder="Cari kolom fitur..." disabled={disabled}
            onChange={e => setQ(e.target.value)} />
          {q && <button type="button" className="cs-search-x" onClick={() => setQ('')}><Icon.X /></button>}
        </div>
        <div className="feat-actions">
          <button type="button" className="btn-ghost-accent" disabled={disabled} onClick={() => onChange([...allNames])}>Semua</button>
          <button type="button" className="btn-ghost" disabled={disabled} onClick={() => onChange([])}>Kosongkan</button>
          <button type="button" className="btn-ghost" disabled={disabled}
            onClick={() => onChange(allNames.filter(n => !selSet.has(n)))}>Balik</button>
        </div>
      </div>

      <div className="feat-list">
        {cols.length === 0 && (
          <div className="feat-empty">{disabled ? 'Upload dataset dulu.' : 'Tidak ada kolom numerik selain target/group.'}</div>
        )}
        {cols.length > 0 && filtered.length === 0 && (
          <div className="feat-empty">Tidak ada kolom cocok pencarian itu.</div>
        )}
        {groups.map(g => (
          <div className="feat-group" key={g.key || '__all'}>
            {g.key && (
              <div className="feat-group-head">
                <span className="feat-group-name">{g.key}</span>
                <span className="feat-group-count">{g.cols.filter(c => selSet.has(c.name)).length}/{g.cols.length}</span>
                <button type="button" className="feat-group-toggle" onClick={() => toggleGroup(g.cols)}>
                  {g.cols.every(c => selSet.has(c.name)) ? 'lepas semua' : 'pilih semua'}
                </button>
              </div>
            )}
            {g.cols.map(c => {
              const on = selSet.has(c.name);
              return (
                <button type="button" key={c.name} className={`feat-row ${on ? 'on' : ''}`}
                  onClick={() => toggle(c.name)}>
                  <span className={`feat-check ${on ? 'on' : ''}`}>{on && <Icon.Check />}</span>
                  <span className="feat-body">
                    <span className="feat-head">
                      <span className="feat-name">{c.name}</span>
                      {c.n_missing > 0 && <span className="kind-badge kind-warn">{c.missing_pct != null ? `${c.missing_pct}%` : c.n_missing} kosong</span>}
                    </span>
                    <span className="feat-meta">{colMetaLine(c)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="feat-foot">
        <span><strong>{sel.length}</strong> dari {cols.length} kolom dipilih</span>
        {nMissing > 0 && (
          <span className="feat-foot-warn">
            <Icon.Info /> {nMissing} kolom terpilih punya nilai kosong — ditangani di Step 02.
          </span>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ColumnSelect, FeaturePicker, KindBadge, colKind, colMetaLine, fmtColNum, COL_KIND_LABEL });
