/* global React, Icon */
const { useState: useStateMLb, useEffect: useEffectMLb, useRef: useRefMLb } = React;
const ApiMLb = window.Api;

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
const MODELS = [
  {
    id: 'svm',
    name: 'SVM',
    badge: { label: 'KERNEL', cls: 'badge-accent' },
    desc: 'Support Vector Machine dengan kernel non-linear, baik untuk data dengan margin yang jelas.',
    defaults: { kernel: 'rbf', C: 1.0 },
  },
  {
    id: 'rf',
    name: 'Random Forest',
    badge: { label: 'ENSEMBLE', cls: 'badge-normal' },
    desc: 'Ensemble decision tree dengan voting mayoritas, robust terhadap overfitting dan outlier.',
    defaults: { n_estimators: 100, max_depth: 10 },
  },
  {
    id: 'knn',
    name: 'K-Nearest Neighbors',
    badge: { label: 'DISTANCE', cls: 'badge-info', style: { background: '#EEE5F5', color: '#6F3D9E' } },
    desc: 'Klasifikasi berdasarkan k tetangga terdekat, sederhana namun sensitif terhadap skala fitur.',
    defaults: { n_neighbors: 5, metric: 'euclidean' },
  },
  {
    id: 'lr',
    name: 'Logistic Regression',
    badge: { label: 'LINEAR', cls: 'badge-info', style: { background: '#FCEEDC', color: '#B07B1F' } },
    desc: 'Model linear probabilistik, interpretable dan cepat untuk masalah klasifikasi biner.',
    defaults: { C: 1.0, solver: 'lbfgs' },
  },
  {
    id: 'nb',
    name: 'Naive Bayes',
    badge: { label: 'PROBABILISTIC', cls: 'badge-info' },
    desc: 'Klasifikator probabilistik berbasis teorema Bayes dengan asumsi independensi fitur.',
    defaults: {},
  },
];

function HyperEditor({ model, value, onChange }) {
  const v = { ...model.defaults, ...value };
  const setField = (k, x) => onChange({ ...v, [k]: x });

  if (model.id === 'svm') return (
    <>
      <div className="form-row">
        <label>Kernel</label>
        <div className="chip-group">
          {['rbf', 'linear', 'poly'].map(k => (
            <button key={k} className={`chip ${v.kernel === k ? 'selected' : ''}`} onClick={(e) => { e.stopPropagation(); setField('kernel', k); }}>{k}</button>
          ))}
        </div>
      </div>
      <div className="form-row" onClick={e => e.stopPropagation()}>
        <label><span>C (regularization)</span></label>
        <input className="input" type="number" step="0.1" min="0.01" value={v.C} onChange={e => setField('C', parseFloat(e.target.value) || 1.0)} />
      </div>
    </>
  );
  if (model.id === 'rf') return (
    <>
      <div className="form-row" onClick={e => e.stopPropagation()}>
        <label><span>n_estimators</span></label>
        <input className="input" type="number" step="10" min="1" value={v.n_estimators} onChange={e => setField('n_estimators', parseInt(e.target.value) || 100)} />
      </div>
      <div className="form-row" onClick={e => e.stopPropagation()}>
        <label><span>max_depth</span></label>
        <input className="input" type="number" step="1" min="1" value={v.max_depth} onChange={e => setField('max_depth', parseInt(e.target.value) || 10)} />
      </div>
    </>
  );
  if (model.id === 'knn') return (
    <>
      <div className="form-row" onClick={e => e.stopPropagation()}>
        <label><span>n_neighbors</span></label>
        <input className="input" type="number" step="1" min="1" value={v.n_neighbors} onChange={e => setField('n_neighbors', parseInt(e.target.value) || 5)} />
      </div>
      <div className="form-row">
        <label>Metric</label>
        <div className="chip-group">
          {['euclidean', 'manhattan'].map(m => (
            <button key={m} className={`chip ${v.metric === m ? 'selected' : ''}`} onClick={(e) => { e.stopPropagation(); setField('metric', m); }}>{m}</button>
          ))}
        </div>
      </div>
    </>
  );
  if (model.id === 'lr') return (
    <>
      <div className="form-row" onClick={e => e.stopPropagation()}>
        <label><span>C (inverse reg)</span></label>
        <input className="input" type="number" step="0.1" min="0.01" value={v.C} onChange={e => setField('C', parseFloat(e.target.value) || 1.0)} />
      </div>
      <div className="form-row">
        <label>Solver</label>
        <div className="chip-group">
          {['lbfgs', 'liblinear'].map(s => (
            <button key={s} className={`chip ${v.solver === s ? 'selected' : ''}`} onClick={(e) => { e.stopPropagation(); setField('solver', s); }}>{s}</button>
          ))}
        </div>
      </div>
    </>
  );
  return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tidak ada hyperparameter</div>;
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {MODELS.map(m => {
          const isSel = selected.includes(m.id);
          const isExp = expanded[m.id];
          const hyper = hyperOverrides[m.id] || m.defaults;
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
                <span>Hyperparameter</span>
                <span className="coll-chev"><Icon.Chev /></span>
              </div>
              {isExp && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={e => e.stopPropagation()}>
                  <HyperEditor model={m} value={hyper} onChange={(h) => setHyper(m.id, h)} />
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
function StageTrain({ onBack, onNext, dataset, target, featureCols, missingStrategy, normalize, splitPct, selected, hyperOverrides, trainResult, setTrainResult }) {
  const [training, setTraining] = useStateMLb(false);
  const [progress, setProgress] = useStateMLb(0);
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
    setProgress(0);
    const ticker = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 4 + 1, 92));
    }, 250);
    try {
      const payload = {
        dataset_id: dataset.dataset_id,
        target_col: target,
        feature_cols: featureCols,
        missing_strategy: missingStrategy,
        normalize,
        test_size: (100 - splitPct) / 100,
        cv_folds: 5,
        models: selected.map(id => {
          const m = MODELS.find(x => x.id === id);
          return { id, hyper: hyperOverrides[id] || m?.defaults || {} };
        }),
      };
      const data = await ApiMLb.mlTrain(payload);
      setTrainResult(data);
      setProgress(100);
    } catch (e) {
      setError(e.message || 'Gagal training');
    } finally {
      clearInterval(ticker);
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
        <div className="card-hero" style={{ padding: '40px 40px', textAlign: 'center', minHeight: 320, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="hero-deco" style={{ width: 320, height: 320, top: -100, right: -80 }} />
          <div className="hero-deco-2" style={{ width: 200, height: 200, bottom: -100, left: -40 }} />
          <div className="card-hero-inner" style={{ maxWidth: 560, margin: '0 auto' }}>
            <div className="eyebrow">PELATIHAN BERJALAN</div>
            <h2 style={{ margin: '12px 0 24px', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>Melatih {selected.length} model...</h2>
            <div className="progress lg" style={{ background: 'rgba(255,255,255,0.18)', height: 14 }}>
              <div className="progress-bar" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, rgba(255,255,255,0.6), rgba(255,255,255,0.95))' }} />
            </div>
            <div className="row-between" style={{ marginTop: 14, fontSize: 14, fontWeight: 500, opacity: 0.9 }}>
              <span>Cross-validation + fit + evaluasi</span>
              <span style={{ fontWeight: 700 }}>{Math.round(progress)}%</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main data-screen-label="08 ML — Train Error">
        <div className="card card-pad-lg">
          <h3 style={{ margin: 0, fontSize: 18 }}>Gagal Training</h3>
          <p style={{ marginTop: 12, color: 'var(--danger)' }}>{error}</p>
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
          <button className="btn btn-primary" onClick={runTrain} style={{ marginTop: 16 }}>
            <Icon.Rocket /> Mulai Training
          </button>
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

      <div className="card card-pad-lg" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>Perbandingan Model</h3>
        </div>
        <div className="table-wrap">
          <table className="dt">
            <thead><tr>
              <th>Model</th>
              <th className="num">Accuracy</th>
              <th className="num">F1</th>
              <th className="num">Precision</th>
              <th className="num">Recall</th>
              <th className="num">AUC</th>
              <th className="num">CV Mean</th>
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
                  <td className="num">{r.auc === null ? '-' : _fmtML(r.auc)}</td>
                  <td className="num">{r.cv_mean === null ? '-' : _fmtML(r.cv_mean)}</td>
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
