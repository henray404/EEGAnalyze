/* global React, Icon */
const { useState: useStateMLb, useEffect: useEffectMLb, useRef: useRefMLb } = React;
const ApiMLb = window.Api;
const ProgressLogMLb = window.ProgressLog;

function PlotlyFig({ figure, minHeight = 360 }) {
  const ref = useRefMLb(null);
  useEffectMLb(() => {
    if (!ref.current || !figure || typeof window.Plotly === 'undefined') return;
    window.Plotly.react(ref.current, figure.data || [], figure.layout || {}, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    });
    return () => { try { window.Plotly.purge(ref.current); } catch {} };
  }, [figure]);
  return <div ref={ref} style={{ width: '100%', minHeight }} />;
}

// ===================== STAGE 3: MODEL SELECTION =====================
/*
 * Tiap model punya `params`: skema deklaratif yang dirender HyperEditor.
 * Sebelumnya editor itu if-chain per model, jadi tiap nambah hyperparameter
 * harus nulis JSX baru, dan Naive Bayes dianggap "tanpa hyperparameter"
 * padahal var_smoothing ada. Tipe: number | int | choice | bool | text.
 */
const MODELS = [
  {
    id: 'hgb',
    name: 'Hist Gradient Boosting',
    badge: { label: 'BOOSTING', cls: 'badge-accent' },
    desc: 'Gradient boosting berbasis histogram. Umumnya paling kuat untuk fitur tabular hasil ekstraksi seperti dataset ini, dan tahan terhadap fitur berskala beda.',
    params: [
      { key: 'learning_rate', label: 'learning_rate', type: 'number', def: 0.1, min: 0.001, max: 1, step: 0.01,
        help: 'Kecil = belajar pelan tapi lebih stabil. Pasangkan dengan max_iter besar.' },
      { key: 'max_iter', label: 'max_iter', type: 'int', def: 200, min: 20, max: 2000, step: 20,
        help: 'Jumlah tahap boosting (pohon).' },
      { key: 'max_depth', label: 'max_depth', type: 'int', def: 6, min: 1, max: 50, step: 1,
        help: 'Kedalaman tiap pohon. Kecil = lebih sederhana.' },
      { key: 'min_samples_leaf', label: 'min_samples_leaf', type: 'int', def: 20, min: 1, max: 200, step: 1,
        help: 'Minimum sampel per daun. Naikkan kalau overfit.' },
      { key: 'l2_regularization', label: 'l2_regularization', type: 'number', def: 0, min: 0, max: 10, step: 0.1,
        help: 'Penalti L2 pada bobot daun.' },
    ],
  },
  {
    id: 'svm',
    name: 'SVM',
    badge: { label: 'KERNEL', cls: 'badge-accent' },
    desc: 'Support Vector Machine dengan kernel non-linear, baik untuk data dengan margin yang jelas.',
    params: [
      { key: 'kernel', label: 'Kernel', type: 'choice', options: ['rbf', 'linear', 'poly'], def: 'rbf',
        help: 'Bentuk batas keputusan. linear = paling cepat, rbf = paling fleksibel.' },
      { key: 'C', label: 'C (regularisasi)', type: 'number', def: 1.0, min: 0.01, max: 1000, step: 0.1,
        help: 'Makin besar = makin ketat mengikuti data latih (risiko overfit).' },
      { key: 'gamma', label: 'Gamma', type: 'choice', options: ['scale', 'auto'], def: 'scale',
        help: 'Jangkauan pengaruh satu sampel. Hanya dipakai kernel rbf/poly.' },
    ],
  },
  {
    id: 'rf',
    name: 'Random Forest',
    badge: { label: 'ENSEMBLE', cls: 'badge-normal' },
    desc: 'Ensemble decision tree dengan voting mayoritas, robust terhadap overfitting dan outlier.',
    params: [
      { key: 'n_estimators', label: 'n_estimators', type: 'int', def: 100, min: 10, max: 1000, step: 10,
        help: 'Jumlah pohon. Lebih banyak = lebih stabil tapi lebih lambat.' },
      { key: 'max_depth', label: 'max_depth', type: 'int', def: 10, min: 1, max: 100, step: 1,
        help: 'Kedalaman maksimum tiap pohon. Kecil = model lebih sederhana.' },
      { key: 'min_samples_leaf', label: 'min_samples_leaf', type: 'int', def: 1, min: 1, max: 50, step: 1,
        help: 'Minimum sampel per daun. Naikkan kalau overfit.' },
      { key: 'max_features', label: 'max_features', type: 'choice', options: ['sqrt', 'log2'], def: 'sqrt',
        help: 'Berapa fitur dipertimbangkan tiap split.' },
    ],
  },
  {
    id: 'et',
    name: 'Extra Trees',
    badge: { label: 'ENSEMBLE', cls: 'badge-normal' },
    desc: 'Seperti Random Forest tapi titik split dipilih acak. Sering lebih tahan fitur berisik dan lebih cepat dilatih.',
    params: [
      { key: 'n_estimators', label: 'n_estimators', type: 'int', def: 200, min: 10, max: 1000, step: 10,
        help: 'Jumlah pohon. Lebih banyak = lebih stabil tapi lebih lambat.' },
      { key: 'max_depth', label: 'max_depth', type: 'int', def: 12, min: 1, max: 100, step: 1,
        help: 'Kedalaman maksimum tiap pohon.' },
      { key: 'min_samples_leaf', label: 'min_samples_leaf', type: 'int', def: 1, min: 1, max: 50, step: 1,
        help: 'Minimum sampel per daun. Naikkan kalau overfit.' },
      { key: 'max_features', label: 'max_features', type: 'choice', options: ['sqrt', 'log2'], def: 'sqrt',
        help: 'Berapa fitur dipertimbangkan tiap split.' },
    ],
  },
  {
    id: 'dt',
    name: 'Decision Tree',
    badge: { label: 'INTERPRETABLE', cls: 'badge-info', style: { background: '#EEE5F5', color: '#6F3D9E' } },
    desc: 'Satu pohon keputusan. Akurasinya biasanya di bawah ensemble, tapi aturannya bisa dibaca langsung — berguna untuk penjelasan di laporan.',
    params: [
      { key: 'criterion', label: 'Criterion', type: 'choice', options: ['gini', 'entropy'], def: 'gini',
        help: 'Ukuran kualitas split.' },
      { key: 'max_depth', label: 'max_depth', type: 'int', def: 6, min: 1, max: 50, step: 1,
        help: 'Kecil = pohon lebih dangkal dan lebih mudah dibaca.' },
      { key: 'min_samples_leaf', label: 'min_samples_leaf', type: 'int', def: 5, min: 1, max: 200, step: 1,
        help: 'Minimum sampel per daun. Menahan pohon tumbuh terlalu spesifik.' },
    ],
  },
  {
    id: 'knn',
    name: 'K-Nearest Neighbors',
    badge: { label: 'DISTANCE', cls: 'badge-info', style: { background: '#EEE5F5', color: '#6F3D9E' } },
    desc: 'Klasifikasi berdasarkan k tetangga terdekat, sederhana namun sensitif terhadap skala fitur.',
    params: [
      { key: 'n_neighbors', label: 'n_neighbors', type: 'int', def: 5, min: 1, max: 100, step: 1,
        help: 'Jumlah tetangga yang ikut voting. Ganjil menghindari seri di kasus biner.' },
      { key: 'metric', label: 'Metric', type: 'choice', options: ['euclidean', 'manhattan'], def: 'euclidean',
        help: 'Cara mengukur jarak antar sampel.' },
      { key: 'weights', label: 'Weights', type: 'choice', options: ['uniform', 'distance'], def: 'uniform',
        help: 'distance = tetangga lebih dekat punya suara lebih besar.' },
    ],
  },
  {
    id: 'lr',
    name: 'Logistic Regression',
    badge: { label: 'LINEAR', cls: 'badge-info', style: { background: '#FCEEDC', color: '#B07B1F' } },
    desc: 'Model linear probabilistik, interpretable dan cepat untuk masalah klasifikasi biner.',
    params: [
      { key: 'C', label: 'C (inverse reg)', type: 'number', def: 1.0, min: 0.01, max: 1000, step: 0.1,
        help: 'Kebalikan kekuatan regularisasi. Kecil = regularisasi kuat.' },
      { key: 'solver', label: 'Solver', type: 'choice', options: ['lbfgs', 'liblinear'], def: 'lbfgs',
        help: 'Algoritma optimasi. liblinear cocok untuk dataset kecil.' },
      { key: 'max_iter', label: 'max_iter', type: 'int', def: 1000, min: 100, max: 5000, step: 100,
        help: 'Batas iterasi. Naikkan kalau muncul peringatan konvergensi.' },
    ],
  },
  {
    id: 'nb',
    name: 'Naive Bayes',
    badge: { label: 'PROBABILISTIC', cls: 'badge-info' },
    desc: 'Klasifikator probabilistik berbasis teorema Bayes dengan asumsi independensi fitur.',
    params: [
      { key: 'var_smoothing', label: 'var_smoothing', type: 'choice',
        options: [1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-5], def: 1e-9,
        format: v => Number(v).toExponential(0),
        help: 'Tambahan varians untuk stabilitas numerik. Naikkan kalau fitur nyaris konstan.' },
    ],
  },
];

/** Nilai default satu model, diturunkan dari skema params. */
function modelDefaults(m) {
  return Object.fromEntries((m?.params || []).map(p => [p.key, p.def]));
}

/** Param yang nilainya beda dari default — dipakai badge & tombol reset. */
function changedParams(m, value) {
  const v = value || {};
  return (m?.params || []).filter(p => p.key in v && v[p.key] !== p.def);
}

/** Jepit nilai numerik ke [min, max] skema; input kosong balik ke default. */
function _clampParam(p, raw) {
  if (raw === '' || raw === null || raw === undefined) return p.def;
  const n = p.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(n)) return p.def;
  if (p.min !== undefined && n < p.min) return p.min;
  if (p.max !== undefined && n > p.max) return p.max;
  return n;
}

function HyperField({ param: p, value, onChange }) {
  const isDefault = value === p.def;
  const stop = e => e.stopPropagation();

  let control;
  if (p.type === 'choice') {
    control = (
      <div className="chip-group">
        {p.options.map(opt => (
          <button key={String(opt)} type="button"
            className={`chip ${value === opt ? 'selected' : ''}`}
            onClick={e => { stop(e); onChange(opt); }}>
            {p.format ? p.format(opt) : String(opt)}
          </button>
        ))}
      </div>
    );
  } else if (p.type === 'bool') {
    control = (
      <button type="button" className={`hp-switch ${value ? 'on' : ''}`}
        onClick={e => { stop(e); onChange(!value); }}
        aria-pressed={!!value}>
        <span className="hp-switch-knob" />
        <span className="hp-switch-text">{value ? 'aktif' : 'nonaktif'}</span>
      </button>
    );
  } else if (p.type === 'text') {
    control = (
      <input className="input" type="text" value={value ?? ''} placeholder={p.placeholder}
        onClick={stop}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(e.target.value.trim() || p.def)} />
    );
  } else {
    control = (
      <input className="input" type="number"
        step={p.step} min={p.min} max={p.max}
        title={`rentang ${p.min} – ${p.max}`}
        value={value ?? ''}
        onClick={stop}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        onBlur={e => onChange(_clampParam(p, e.target.value))} />
    );
  }

  const defText = p.format ? p.format(p.def) : String(p.def);
  // Rentang + default digabung satu baris; sebelumnya help dan rentang jadi dua
  // paragraf terpisah sehingga tiap field makan 4 baris dan panelnya kepanjangan.
  const meta = p.min !== undefined
    ? `${p.min} – ${p.max} · default ${defText}`
    : `default ${defText}`;

  return (
    <div className={`hp-field ${isDefault ? '' : 'dirty'}`} onClick={stop}>
      <div className="hp-field-head">
        <label className="hp-key">{p.label}</label>
        {!isDefault && (
          <button type="button" className="hp-reset" title={`Kembalikan ke ${defText}`}
            onClick={e => { stop(e); onChange(p.def); }}>
            <Icon.Refresh /> reset
          </button>
        )}
      </div>
      {control}
      <p className="hp-meta">{meta}</p>
      {p.help && <p className="hp-help">{p.help}</p>}
    </div>
  );
}

function HyperEditor({ model, value, onChange }) {
  const v = { ...modelDefaults(model), ...value };
  const params = model.params || [];
  if (params.length === 0) {
    return <div className="hp-empty">Model ini tidak punya hyperparameter yang bisa diatur.</div>;
  }
  return (
    <div className="hp-grid">
      {params.map(p => (
        <HyperField key={p.key} param={p} value={v[p.key]}
          onChange={x => onChange({ ...v, [p.key]: x })} />
      ))}
    </div>
  );
}

function StageModels({ onBack, onNext, selected, setSelected, hyperOverrides, setHyperOverrides }) {
  const [expanded, setExpanded] = useStateMLb({});
  const setHyper = (id, hyper) => setHyperOverrides({ ...hyperOverrides, [id]: hyper });

  return (
    <main data-screen-label="07 ML — Models">
      <div className="row-between mb-20">
        <div>
          <span className="eyebrow">PILIH MODEL</span>
          <h3 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 700 }}>Pilih Model untuk Pelatihan</h3>
        </div>
        <span className="chip-mini accent">{selected.length} model dipilih</span>
      </div>

      {/* align-items start, bukan stretch: tanpa ini kartu tetangga di baris
          grid yang sama ikut melar setinggi kartu yang panel hyperparameter-nya
          dibuka, jadi kelihatan seperti ikut ter-expand padahal cuma kotaknya. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {MODELS.map(m => {
          const isSel = selected.includes(m.id);
          const isExp = expanded[m.id];
          const hyper = hyperOverrides[m.id] || modelDefaults(m);
          const changed = changedParams(m, hyperOverrides[m.id]);
          return (
            <div key={m.id}
              className="card card-pad"
              style={{
                border: isSel ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: isSel ? 'linear-gradient(135deg, var(--surface) 60%, var(--accent-tint) 100%)' : 'var(--surface)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => setSelected(isSel ? selected.filter(x => x !== m.id) : [...selected, m.id])}>
              <div className="row-between mb-12">
                <div className="row gap-12">
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    border: '2px solid ' + (isSel ? 'var(--accent)' : 'var(--border-strong)'),
                    background: isSel ? 'var(--accent)' : 'var(--surface)',
                    color: '#fff', display: 'grid', placeItems: 'center',
                  }}>
                    {isSel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                  </div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{m.name}</h3>
                </div>
                <span className={`badge ${m.badge.cls}`} style={m.badge.style}>{m.badge.label}</span>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{m.desc}</p>
              <div
                className={`coll-head mt-16 ${isExp ? 'open' : ''}`}
                style={{ paddingTop: 4 }}
                onClick={(e) => { e.stopPropagation(); setExpanded({ ...expanded, [m.id]: !isExp }); }}
              >
                <span>
                  Hyperparameter
                  <span className="hp-count">{(m.params || []).length}</span>
                  {changed.length > 0 && <span className="hp-changed">{changed.length} diubah</span>}
                </span>
                <span className="coll-chev"><Icon.Chev /></span>
              </div>
              {isExp && (
                <div className="hp-panel" onClick={e => e.stopPropagation()}>
                  <HyperEditor model={m} value={hyper} onChange={(h) => setHyper(m.id, h)} />
                  {changed.length > 0 && (
                    <button type="button" className="btn-ghost hp-reset-all"
                      onClick={e => { e.stopPropagation(); setHyper(m.id, modelDefaults(m)); }}>
                      <Icon.Refresh /> Kembalikan semua ke default
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
        <button className="btn btn-soft" onClick={onBack}><Icon.ArrowLeft /> Kembali</button>
        <button className="btn btn-primary" onClick={onNext} disabled={selected.length === 0}>
          <Icon.Rocket /> Latih Model <Icon.Arrow />
        </button>
      </div>
    </main>
  );
}

// ===================== STAGE 4: TRAIN =====================
function StageTrain({ onBack, onNext, dataset, target, featureCols, missingStrategy, normalize, splitPct, selected, hyperOverrides, groupCol, classWeightBalanced, setClassWeightBalanced, trainResult, setTrainResult }) {
  const [training, setTraining] = useStateMLb(false);
  const [progress, setProgress] = useStateMLb(null);
  const [logs, setLogs] = useStateMLb([]);
  const [error, setError] = useStateMLb(null);
  const [chartTab, setChartTab] = useStateMLb('cm');
  const [cmModelIdx, setCmModelIdx] = useStateMLb(0);
  const triggeredRef = useRefMLb(false);

  const runTrain = async () => {
    if (!dataset || !target || featureCols.length === 0 || selected.length === 0) {
      setError('Konfigurasi tidak lengkap. Kembali ke step sebelumnya.');
      return;
    }
    setTraining(true);
    setError(null);
    setProgress(null);
    setLogs([]);
    try {
      const payload = {
        dataset_id: dataset.dataset_id,
        target_col: target,
        feature_cols: featureCols,
        missing_strategy: missingStrategy,
        normalize,
        test_size: (100 - splitPct) / 100,
        cv_folds: 5,
        group_col: groupCol || null,
        class_weight_balanced: !!classWeightBalanced,
        models: selected.map(id => {
          const m = MODELS.find(x => x.id === id);
          return { id, hyper: hyperOverrides[id] || modelDefaults(m) };
        }),
      };
      // Progres nyata dari backend: bar = model ke-i / N, log per model.
      const data = await ApiMLb.mlTrain(payload, {
        onProgress: (done, total) => setProgress(total > 0 ? Math.round((done / total) * 100) : 0),
        onLog: (message, level) => setLogs(prev => [...prev, { message, level }]),
      });
      setTrainResult(data);
      setProgress(100);
    } catch (e) {
      setError(e.message || 'Gagal training');
    } finally {
      setTraining(false);
    }
  };

  useEffectMLb(() => {
    if (trainResult || triggeredRef.current || training) return;
    triggeredRef.current = true;
    runTrain();
  }, []);

  if (training) {
    return (
      <main data-screen-label="08 ML — Training">
        <div className="card card-pad-lg" style={{ padding: '40px', minHeight: 320 }}>
          <ProgressLogMLb
            title="PELATIHAN BERJALAN"
            subtitle={`Melatih ${selected.length} model...`}
            logs={logs}
            progress={progress}
          />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main data-screen-label="08 ML — Train Error">
        <div className="card card-pad-lg">
          <h3 style={{ margin: 0, fontSize: 18 }}>Gagal Training</h3>
          <p style={{ marginTop: 12, color: 'var(--danger)', lineHeight: 1.6, maxWidth: 720 }}>{error}</p>
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Detail teknis lengkap (request URL, status code, response body) sudah dicatat
            di browser console -- buka DevTools (F12) &gt; tab Console.
          </p>
          <div className="row" style={{ marginTop: 24, gap: 12 }}>
            <button className="btn btn-soft" onClick={onBack}><Icon.ArrowLeft /> Kembali</button>
            <button className="btn btn-primary" onClick={runTrain}><Icon.Refresh /> Coba lagi</button>
          </div>
        </div>
      </main>
    );
  }

  if (!trainResult) {
    return (
      <main data-screen-label="08 ML — Train Ready">
        <div className="card card-pad-lg" style={{ textAlign: 'center' }}>
          <h3>Siap training {selected.length} model</h3>
          {groupCol && (
            <div style={{ margin: '12px auto 0', maxWidth: 480, fontSize: 12.5, color: 'var(--text-muted)' }}>
              Group Column: <strong style={{ color: 'var(--text-primary)' }}>{groupCol}</strong> — split train/test group-aware.
            </div>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={!!classWeightBalanced} onChange={e => setClassWeightBalanced(e.target.checked)} />
            Class weight balanced (bantu kelas minoritas, ubah perilaku model)
          </label>
          <div>
            <button className="btn btn-primary" onClick={runTrain} style={{ marginTop: 16 }}>
              <Icon.Rocket /> Mulai Training
            </button>
          </div>
        </div>
      </main>
    );
  }

  const sortedResults = [...trainResult.results].sort((a, b) => b.accuracy - a.accuracy);
  const best = sortedResults[0];

  const _fmtML = (v, d = 4) => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return Number(v).toFixed(d);
  };

  return (
    <main data-screen-label="08 ML — Train Results">
      <div className="card-hero" style={{ marginBottom: 20 }}>
        <div className="hero-deco" />
        <div className="hero-deco-2" />
        <div className="card-hero-inner row-between">
          <div>
            <div className="eyebrow">MODEL TERBAIK</div>
            <div style={{ fontSize: 36, fontWeight: 700, marginTop: 6, letterSpacing: '-0.02em' }}>{best.name}</div>
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.85 }}>{trainResult.n_train} train · {trainResult.n_test} test · {trainResult.n_features} fitur</div>
            <div className="row gap-12" style={{ marginTop: 16 }}>
              <span style={{ padding: '7px 16px', background: 'rgba(255,255,255,0.18)', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>Accuracy {_fmtML(best.accuracy)}</span>
              <span style={{ padding: '7px 16px', background: 'rgba(255,255,255,0.18)', borderRadius: 999, fontSize: 13, fontWeight: 600 }}>F1 {_fmtML(best.f1)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <Icon.Spark style={{ width: 64, height: 64 }} />
            <button onClick={onNext} className="btn" style={{ background: '#fff', color: 'var(--accent)' }}>
              Use for Predict <Icon.Arrow />
            </button>
          </div>
        </div>
      </div>

      {trainResult.leakage_warning && (
        <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 14, fontSize: 13, lineHeight: 1.55 }}>
          <strong>Peringatan leakage:</strong> {trainResult.leakage_warning}
        </div>
      )}

      <div className="card card-pad-lg" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>Perbandingan Model</h3>
          <span className="chip-mini accent">{trainResult.split_strategy}</span>
        </div>
        {trainResult.group_column && (
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Group Column: <strong style={{ color: 'var(--text-primary)' }}>{trainResult.group_column}</strong>
            {' '}· {trainResult.n_groups_train} grup train · {trainResult.n_groups_test} grup test
            {trainResult.cv_strategy && <> · CV: {trainResult.cv_strategy} ({trainResult.cv_folds ?? '-'} fold)</>}
          </div>
        )}
        <div className="table-wrap">
          <table className="dt">
            <thead><tr>
              <th>Model</th>
              <th className="num">Accuracy</th>
              <th className="num">F1</th>
              <th className="num">Precision</th>
              <th className="num">Recall</th>
              <th className="num">Specificity</th>
              <th className="num">MCC</th>
              <th className="num">AUC</th>
              <th className="num">PR-AUC</th>
              <th className="num">CV Mean ± Std</th>
              {trainResult.group_column && <th className="num">Group Acc / F1</th>}
              <th className="num">Time (s)</th>
            </tr></thead>
            <tbody>
              {sortedResults.map((r, i) => (
                <tr key={r.model_uuid} className={i === 0 ? 'best' : ''}>
                  <td><span className="row gap-8">{i === 0 && <Icon.Star />}<strong>{r.name}</strong></span></td>
                  <td className="num">{_fmtML(r.accuracy)}</td>
                  <td className="num">{_fmtML(r.f1)}</td>
                  <td className="num">{_fmtML(r.precision)}</td>
                  <td className="num">{_fmtML(r.recall)}</td>
                  <td className="num">{_fmtML(r.specificity)}</td>
                  <td className="num">{_fmtML(r.mcc)}</td>
                  <td className="num">{r.auc === null ? '-' : _fmtML(r.auc)}</td>
                  <td className="num">{r.pr_auc === null ? '-' : _fmtML(r.pr_auc)}</td>
                  <td className="num">{r.cv_mean === null ? '-' : `${_fmtML(r.cv_mean, 3)} ± ${_fmtML(r.cv_std, 3)}`}</td>
                  {trainResult.group_column && (
                    <td className="num">{r.group_accuracy === null || r.group_accuracy === undefined ? '-' : `${_fmtML(r.group_accuracy, 3)} / ${_fmtML(r.group_f1, 3)}`}</td>
                  )}
                  <td className="num"><span className="chip-mini">{r.time_seconds}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tabs-pill">
          {[
            { id: 'cm', label: 'Confusion Matrix' },
            { id: 'roc', label: 'ROC Curve' },
            { id: 'fi', label: 'Feature Importance' },
          ].map(t => (
            <button key={t.id} className={`tab-pill ${chartTab === t.id ? 'active' : ''}`} onClick={() => setChartTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {chartTab === 'cm' && (
          <div style={{ padding: 24 }}>
            <div className="chip-group mb-20">
              {sortedResults.map((r, i) => (
                <button key={r.model_uuid} className={`chip ${cmModelIdx === i ? 'selected' : ''}`} onClick={() => setCmModelIdx(i)}>{r.name}</button>
              ))}
            </div>
            {sortedResults[cmModelIdx]?.confusion_matrix?.figure && (
              <PlotlyFig figure={sortedResults[cmModelIdx].confusion_matrix.figure} minHeight={380} />
            )}
          </div>
        )}
        {chartTab === 'roc' && (
          <div style={{ padding: 24 }}>
            {trainResult.roc ? <PlotlyFig figure={trainResult.roc} minHeight={420} /> : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>ROC tidak tersedia (multiclass atau model tanpa predict_proba).</div>
            )}
          </div>
        )}
        {chartTab === 'fi' && (
          <div style={{ padding: 24 }}>
            {sortedResults.find(r => r.feature_importance)?.feature_importance
              ? <PlotlyFig figure={sortedResults.find(r => r.feature_importance).feature_importance} minHeight={400} />
              : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Feature importance hanya tersedia untuk Random Forest.</div>}
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
        <button className="btn btn-soft" onClick={onBack}><Icon.ArrowLeft /> Kembali</button>
        <div className="row gap-12">
          <button className="btn btn-secondary" onClick={runTrain}><Icon.Refresh /> Latih Ulang</button>
          <button className="btn btn-primary" onClick={onNext}>Lanjut ke Prediksi <Icon.Arrow /></button>
        </div>
      </div>
    </main>
  );
}

// ===================== STAGE 5: PREDICT =====================
function StagePredict({ onBack, trainResult }) {
  const [file, setFile] = useStateMLb(null);
  const [selectedModelUuid, setSelectedModelUuid] = useStateMLb(trainResult?.best_model_uuid || '');
  const [predicting, setPredicting] = useStateMLb(false);
  const [error, setError] = useStateMLb(null);
  const [prediction, setPrediction] = useStateMLb(null);
  const fileInputRef = useRefMLb(null);

  const models = trainResult?.results || [];

  useEffectMLb(() => {
    if (trainResult?.best_model_uuid && !selectedModelUuid) {
      setSelectedModelUuid(trainResult.best_model_uuid);
    }
  }, [trainResult]);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPrediction(null);
    setError(null);
  };

  const runPredict = async () => {
    if (!file || !selectedModelUuid) return;
    setPredicting(true);
    setError(null);
    try {
      const data = await ApiMLb.mlPredict(file, selectedModelUuid);
      setPrediction(data);
    } catch (e) {
      setError(e.message || 'Gagal prediksi');
    } finally {
      setPredicting(false);
    }
  };

  const handleDownloadCSV = () => {
    if (!prediction?.predictions) return;
    window.downloadCSV(prediction.predictions, `predictions_${Date.now()}.csv`);
  };

  const handleDownloadExcel = async () => {
    if (!prediction?.predictions) return;
    const fname = `predictions_${Date.now()}.xlsx`;
    try {
      const blob = await ApiMLb.exportExcel(
        [{ name: 'Predictions', records: prediction.predictions }], fname,
      );
      window.downloadBlob(blob, fname);
    } catch (e) {
      setError(e.message || 'Export gagal');
    }
  };

  return (
    <main data-screen-label="09 ML — Predict">
      <div className="split">
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad">
            <div className="card-header">
              <div>
                <span className="eyebrow">STEP 05</span>
                <h3 style={{ margin: '6px 0 0' }}>Upload Data Baru</h3>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            {file ? (
              <div className="file-card">
                <div className="file-card-badge"><Icon.Spreadsheet /></div>
                <div className="file-card-info">
                  <div className="name">{file.name}</div>
                  <div className="meta">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
                <button className="file-card-x" onClick={() => { setFile(null); setPrediction(null); }}><Icon.X /></button>
              </div>
            ) : (
              <div className="dropzone" style={{ padding: '24px 16px' }} onClick={() => fileInputRef.current?.click()}>
                <div className="dz-icon"><Icon.Spreadsheet /></div>
                <div className="dz-title">Drag &amp; drop CSV / Excel</div>
                <div className="dz-sub">Tanpa kolom label</div>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-header">
              <div>
                <span className="eyebrow">MODEL TERLATIH</span>
                <h3 style={{ margin: '6px 0 0' }}>Pilih Model</h3>
              </div>
            </div>
            {models.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Belum ada model terlatih. Kembali ke step Train.</div>
            ) : (
              <select value={selectedModelUuid} onChange={e => setSelectedModelUuid(e.target.value)}
                style={{ width: '100%', padding: '12px 16px', background: 'var(--surface-tint)', borderRadius: 14, border: '1px solid var(--border)', fontSize: 14, fontWeight: 600 }}>
                {models.map(m => (
                  <option key={m.model_uuid} value={m.model_uuid}>{m.name} — Acc {Number(m.accuracy).toFixed(4)}</option>
                ))}
              </select>
            )}
          </div>

          <button className="btn-cta" disabled={!file || !selectedModelUuid || predicting} onClick={runPredict}>
            <Icon.Zap /> {predicting ? 'Memproses...' : 'Jalankan Prediksi'}
          </button>

          {error && (
            <div style={{ padding: '10px 14px', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 12, fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 4 }}>
            <button className="btn btn-soft" onClick={onBack}><Icon.ArrowLeft /> Kembali</button>
          </div>
        </aside>

        <section>
          {!prediction ? (
            <div className="card card-pad-lg" style={{ minHeight: 600, display: 'grid', placeItems: 'center' }}>
              <div className="empty">
                <EmptyArtFunnel />
                <h4>Belum ada prediksi</h4>
                <p>Upload data dan pilih model untuk menjalankan prediksi.</p>
              </div>
            </div>
          ) : (
            <PredictResults prediction={prediction} onDownloadCSV={handleDownloadCSV} onDownloadExcel={handleDownloadExcel} />
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyArtFunnel() {
  return (
    <svg className="empty-art" viewBox="0 0 220 140">
      <path d="M 20 30 L 100 30 L 80 80 L 80 120 L 100 130 L 100 80 L 200 30 L 20 30 Z" fill="none" stroke="#DDDFFB" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="35" cy="42" r="3" fill="#DDDFFB" />
      <circle cx="60" cy="42" r="3" fill="#DDDFFB" />
      <circle cx="120" cy="42" r="3" fill="#DDDFFB" />
      <circle cx="160" cy="42" r="3" fill="#DDDFFB" />
    </svg>
  );
}

function PredictResults({ prediction, onDownloadCSV, onDownloadExcel }) {
  const rows = prediction.predictions || [];
  const summary = prediction.summary || {};
  const total = summary.total || rows.length;
  const labelKeys = Object.keys(summary).filter(k => k !== 'total');

  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="stat-strip">
        <div className="stat-card">
          <div className="label">TOTAL PREDIKSI</div>
          <div className="value value-lg">{total}</div>
        </div>
        {labelKeys.map(k => {
          const v = summary[k];
          const pct = total > 0 ? (v / total * 100).toFixed(1) : '0';
          return (
            <div key={k} className="stat-card">
              <div className="label">{k}</div>
              <div className="value value-lg">{v}</div>
              <span className="trend neutral">{pct}%</span>
            </div>
          );
        })}
        {prediction.avg_confidence !== null && prediction.avg_confidence !== undefined && (
          <div className="stat-card">
            <div className="label">AVG CONFIDENCE</div>
            <div className="value value-lg">{Number(prediction.avg_confidence).toFixed(2)}</div>
          </div>
        )}
      </div>

      <div className="card card-pad-lg">
        <div className="card-header"><h3>Distribusi Prediksi</h3></div>
        <div style={{ height: 28, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'var(--surface-tint)' }}>
          {labelKeys.map(k => {
            const v = summary[k];
            const pct = total > 0 ? (v / total * 100) : 0;
            const bg = k === 'ALS' ? 'var(--als-gradient)' : k === 'Normal' ? 'var(--normal-gradient)' : 'var(--accent)';
            return (
              <div key={k} style={{ width: `${pct}%`, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                {pct >= 8 && `${k} ${pct.toFixed(1)}%`}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="row-between" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Hasil Prediksi · {prediction.model_name}</h3>
          <div className="row gap-8">
            <button className="btn btn-secondary" onClick={onDownloadCSV}><Icon.Download /> CSV</button>
            <button className="btn btn-primary" onClick={onDownloadExcel}><Icon.Download /> Excel</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="dt">
            <thead><tr>
              {cols.map(c => (
                <th key={c} className={typeof rows[0]?.[c] === 'number' && c !== 'row' ? 'num' : ''}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  {cols.map(c => {
                    const v = r[c];
                    if (c === 'prediction') {
                      const cls = v === 'ALS' ? 'badge-als' : v === 'Normal' ? 'badge-normal' : 'badge-accent';
                      return <td key={c}><span className={`badge ${cls}`}>{v}</span></td>;
                    }
                    if (c === 'confidence' && typeof v === 'number') {
                      return (
                        <td key={c}>
                          <span className="row gap-8" style={{ minWidth: 140 }}>
                            <span style={{ width: 60, height: 6, borderRadius: 999, background: 'var(--border)', position: 'relative', overflow: 'hidden' }}>
                              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${v * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
                            </span>
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{(v * 100).toFixed(1)}%</span>
                          </span>
                        </td>
                      );
                    }
                    const isNum = typeof v === 'number';
                    return <td key={c} className={isNum ? 'num' : ''}>{isNum ? v.toFixed(4) : v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 50 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            Menampilkan 50 baris pertama dari {rows.length}. Download untuk hasil lengkap.
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { StageModels, StageTrain, StagePredict });
