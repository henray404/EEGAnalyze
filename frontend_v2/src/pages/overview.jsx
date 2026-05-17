/* global React, Icon */
const { useState, useEffect, useRef } = React;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  });
}

function CountUp({ end, duration = 1200, suffix = '' }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const tick = (t) => {
            const k = Math.min(1, (t - start) / duration);
            const eased = 1 - Math.pow(1 - k, 3);
            setVal(Math.round(end * eased));
            if (k < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.3 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [end, duration]);
  return <span ref={ref}>{val}<span className="suffix">{suffix}</span></span>;
}

function HeroWave() {
  const w = 1600, h = 200, mid = h / 2;
  const pts = [], pts2 = [];
  for (let x = 0; x <= w; x += 8) {
    const y = mid + Math.sin(x * 0.012) * 18 + Math.sin(x * 0.04 + 1.2) * 8 + Math.sin(x * 0.09 + 2) * 4;
    pts.push(`${x},${y.toFixed(1)}`);
    const y2 = mid + Math.sin(x * 0.008 + 0.8) * 22 + Math.sin(x * 0.05 + 0.4) * 6;
    pts2.push(`${x},${y2.toFixed(1)}`);
  }
  return (
    <svg className="hero-wave" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path className="s2" d={`M${pts2.join(' L')}`} />
      <path d={`M${pts.join(' L')}`} />
    </svg>
  );
}

function MiniSignal() {
  const w = 320, h = 80;
  const lines = [0.3, 0.5, 0.72].map((y, i) => {
    const pts = [];
    for (let x = 0; x <= w; x += 5) {
      const yy = h * y + Math.sin(x * 0.06 + i) * 5 + Math.sin(x * 0.18 + i) * 3;
      pts.push(`${x},${yy.toFixed(1)}`);
    }
    return pts.join(' L');
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, marginBottom: 12 }}>
      {lines.map((d, i) => (
        <path key={i} d={`M${d}`} fill="none"
          stroke={i === 1 ? '#5B65DC' : 'rgba(91,101,220,0.35)'}
          strokeWidth={i === 1 ? '2' : '1.4'}
          strokeLinecap="round" />
      ))}
    </svg>
  );
}

function MiniBars() {
  const bars = [
    [22, 38], [40, 28], [55, 64], [32, 22], [60, 52]
  ];
  return (
    <svg viewBox="0 0 320 80" preserveAspectRatio="none" style={{ width: '100%', height: 60, marginBottom: 12 }}>
      {bars.map(([a, b], i) => (
        <g key={i} transform={`translate(${20 + i * 60}, 0)`}>
          <rect x="0" y={70 - a} width="20" height={a + 4} rx="6" ry="6" fill="rgba(91,101,220,0.35)" />
          <rect x="24" y={70 - b} width="20" height={b + 4} rx="6" ry="6" fill="#5B65DC" />
        </g>
      ))}
    </svg>
  );
}

function MiniConfusion() {
  return (
    <svg viewBox="0 0 320 80" preserveAspectRatio="none" style={{ width: '100%', height: 60, marginBottom: 12 }}>
      <g transform="translate(96, 4)">
        <rect x="0" y="0" width="60" height="32" rx="6" fill="rgba(31,122,82,0.20)" />
        <rect x="68" y="0" width="60" height="32" rx="6" fill="rgba(177,58,76,0.18)" />
        <rect x="0" y="40" width="60" height="32" rx="6" fill="rgba(177,58,76,0.18)" />
        <rect x="68" y="40" width="60" height="32" rx="6" fill="rgba(31,122,82,0.20)" />
        <text x="30" y="22" textAnchor="middle" fill="#1F7A52" fontWeight="700" fontSize="13">112</text>
        <text x="98" y="22" textAnchor="middle" fill="#B13A4C" fontWeight="700" fontSize="13">8</text>
        <text x="30" y="62" textAnchor="middle" fill="#B13A4C" fontWeight="700" fontSize="13">6</text>
        <text x="98" y="62" textAnchor="middle" fill="#1F7A52" fontWeight="700" fontSize="13">118</text>
      </g>
    </svg>
  );
}

function OverviewPage({ go }) {
  useReveal();

  return (
    <main data-screen-label="01 Overview">
      <section className="hero-section">
        <div className="hero-blob b1" />
        <div className="hero-blob b2" />
        <HeroWave />
        <div className="page" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="hero-inner">
            <span className="hero-badge">
              <span className="badge-dot-icon"><Icon.Wave /></span>
              EEG Signal Analysis · Clinical Grade
            </span>
            <h1 className="hero-h1">
              <span className="line1">Analisis Sinyal EEG</span>
              <span className="line2">Lebih Cepat. Lebih Akurat.</span>
            </h1>
            <p className="hero-sub">
              Platform analisis EEG berbasis web untuk mendukung deteksi ALS pada subjek. Upload file EDF, proses sinyal, latih model klasifikasi, dan visualisasikan hasilnya secara interaktif.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-primary" onClick={() => go('single')}>
                Mulai Analisis <Icon.Arrow />
              </button>
              <button className="btn btn-soft" onClick={() => {
                document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}>
                Lihat Cara Kerja <Icon.ArrowDown />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="page" style={{ paddingTop: 24 }}>
        <div className="row-between mb-20 reveal">
          <div>
            <div className="eyebrow">Mode Analisis</div>
            <h2 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Pilih Modul</h2>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>3 modul utama · single, batch, dan machine learning</div>
        </div>

        <div className="fgrid">
          <button className="fcard reveal reveal-1" onClick={() => go('single')}>
            <div className="ficon"><Icon.Wave /></div>
            <h3>Single File Analysis</h3>
            <p>Upload satu file EDF dan analisis sinyal secara interaktif. Lihat sinyal mentah, subband, dan fitur statistik.</p>
            <MiniSignal />
            <div className="ftags">
              <span className="ftag">EDF / TXT</span>
              <span className="ftag">5 Subband</span>
              <span className="ftag">Live</span>
            </div>
            <span className="fcta">Mulai <Icon.Arrow /></span>
          </button>

          <button className="fcard reveal reveal-2" onClick={() => go('batch')}>
            <div className="ficon"><Icon.Layers /></div>
            <h3>Batch Analysis</h3>
            <p>Upload dataset ZIP berisi banyak file EDF. Proses paralel dan analisis delta ALS vs Normal.</p>
            <MiniBars />
            <div className="ftags">
              <span className="ftag">ZIP</span>
              <span className="ftag">Multi-thread</span>
              <span className="ftag">Delta</span>
            </div>
            <span className="fcta">Mulai <Icon.Arrow /></span>
          </button>

          <button className="fcard featured reveal reveal-3" onClick={() => go('ml')}>
            <div className="ficon"><Icon.Brain /></div>
            <h3>Machine Learning</h3>
            <p>Latih model klasifikasi (SVM, Random Forest, Logistic) untuk membedakan ALS vs Normal pada data fitur.</p>
            <MiniConfusion />
            <div className="ftags">
              <span className="ftag">5 Model</span>
              <span className="ftag">5 Stage</span>
              <span className="ftag">Predict</span>
            </div>
            <span className="fcta">Mulai <Icon.Arrow /></span>
          </button>
        </div>

        <section className="section" id="how-it-works">
          <div className="reveal">
            <div className="eyebrow" style={{ textAlign: 'center', display: 'block' }}>Alur Kerja</div>
            <h2>Cara Penggunaan</h2>
            <p className="sub">Tiga langkah singkat untuk membawa data EEG Anda dari file mentah ke insight klinis.</p>
          </div>
          <div className="steps-row">
            <div className="step-card reveal reveal-1">
              <div className="step-num">STEP 01</div>
              <div className="step-icon"><Icon.Upload /></div>
              <h4>Upload File</h4>
              <p>Drop file EDF atau ZIP dataset Anda. Auto-detect format, channel, dan annotations.</p>
            </div>
            <div className="step-arrow reveal reveal-2">
              <svg viewBox="0 0 60 14" preserveAspectRatio="none">
                <path d="M2 7 H50" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="3 4" strokeLinecap="round" />
                <path d="M46 3 L52 7 L46 11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="step-card reveal reveal-2">
              <div className="step-num">STEP 02</div>
              <div className="step-icon"><Icon.Sliders /></div>
              <h4>Konfigurasi &amp; Proses</h4>
              <p>Pilih subband, parameter filter, dan jalankan pemrosesan paralel.</p>
            </div>
            <div className="step-arrow reveal reveal-3">
              <svg viewBox="0 0 60 14" preserveAspectRatio="none">
                <path d="M2 7 H50" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="3 4" strokeLinecap="round" />
                <path d="M46 3 L52 7 L46 11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="step-card reveal reveal-3">
              <div className="step-num">STEP 03</div>
              <div className="step-icon"><Icon.Chart /></div>
              <h4>Lihat Hasil</h4>
              <p>Visualisasi sinyal, fitur statistik, analisis delta, dan prediksi model klasifikasi.</p>
            </div>
          </div>
        </section>

        <section style={{ padding: '24px 0 56px' }} className="reveal">
          <div className="center-stats">
            <div className="center-stat">
              <div className="num"><CountUp end={5} /></div>
              <div className="lbl">Subband EEG</div>
              <div className="meta">Delta · Theta · Alpha · Beta · Gamma</div>
            </div>
            <div className="center-stat">
              <div className="num"><CountUp end={3} /></div>
              <div className="lbl">Fitur Statistik</div>
              <div className="meta">MAV · Variance · STD</div>
            </div>
            <div className="center-stat">
              <div className="num"><CountUp end={5} /></div>
              <div className="lbl">Model Klasifikasi</div>
              <div className="meta">SVM · RF · KNN · LR · NB</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

Object.assign(window, { OverviewPage });
