/* global window, React */
// Panel loading real-time: progress bar nyata + log teks streaming.
// Dipakai semua halaman (single-file, batch, ML) lewat window.ProgressLog.
//
// Props:
//   title    -> eyebrow kecil di atas (mis. "MEMPROSES")
//   subtitle -> judul besar (mis. "Ekstraksi fitur...")
//   logs     -> array { message, level }  (level: info | warn)
//   progress -> 0..100 (bar determinate) atau null (bar indeterminate/animasi)
//   compact  -> true buat versi kecil (plot/upload cepat)
function ProgressLog({ title, subtitle, logs = [], progress = null, compact = false }) {
  const { useRef, useEffect } = React;
  const scrollRef = useRef(null);

  // Auto-scroll ke baris log terbaru tiap kali logs bertambah.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className={`progress-log ${compact ? 'plog-compact' : ''}`}>
      {title && <div className="eyebrow">{title}</div>}
      {subtitle && (
        <h3 className="plog-title">{subtitle}</h3>
      )}

      <div className="plog-bar-wrap">
        <div className={`plog-bar ${pct == null ? 'plog-indeterminate' : ''}`}>
          <div className="plog-bar-fill" style={pct == null ? {} : { width: `${pct}%` }} />
        </div>
        {pct != null && <div className="plog-pct">{pct}%</div>}
      </div>

      {logs.length > 0 && (
        <div className="plog-lines" ref={scrollRef}>
          {logs.map((l, i) => (
            <div key={i} className={`plog-line plog-${l.level || 'info'}`}>
              <span className="plog-caret">›</span>{l.message}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .progress-log { width: 100%; max-width: 640px; margin: 0 auto; text-align: left; }
        .plog-title { margin: 8px 0 18px; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
        .plog-compact .plog-title { font-size: 16px; margin: 4px 0 12px; }
        .plog-bar-wrap { display: flex; align-items: center; gap: 12px; }
        .plog-bar { position: relative; flex: 1; height: 10px; border-radius: 999px; background: var(--secondary-bg, #EEEFFD); overflow: hidden; }
        .plog-compact .plog-bar { height: 6px; }
        .plog-bar-fill { height: 100%; border-radius: 999px; background: var(--accent, #5B65DC); transition: width 0.25s ease; }
        .plog-indeterminate .plog-bar-fill { width: 40%; animation: plogSlide 1.1s ease-in-out infinite; }
        @keyframes plogSlide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
        .plog-pct { font-size: 13px; font-weight: 700; color: var(--accent, #5B65DC); min-width: 40px; text-align: right; }
        .plog-lines {
          margin-top: 16px; max-height: 220px; overflow-y: auto;
          background: var(--page-bg, #FAFAFD); border: 1px solid var(--border, #E8E9F8);
          border-radius: 12px; padding: 12px 14px;
          font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; line-height: 1.7;
        }
        .plog-compact .plog-lines { max-height: 130px; font-size: 11px; }
        .plog-line { color: var(--text-muted, #6B7593); white-space: pre-wrap; word-break: break-word; }
        .plog-line.plog-warn { color: var(--danger, #D84B5A); }
        .plog-caret { color: var(--accent, #5B65DC); margin-right: 8px; font-weight: 700; }
      `}</style>
    </div>
  );
}

window.ProgressLog = ProgressLog;
