/* global window */
// Backend API wrapper — exposed as window.Api

const _api = (path) => `${window.AppConfig.API_BASE}${path}`;

function _buildForm(fields) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) form.append(k, v.join(','));
    else if (v instanceof File || v instanceof Blob) form.append(k, v);
    else form.append(k, String(v));
  });
  return form;
}

// Semua endpoint proses sekarang STREAMING NDJSON (StreamingResponse di backend):
// tiap baris satu event JSON { type: log | progress | result | error }.
// _streamJob() consume stream itu, panggil hooks.onLog / hooks.onProgress
// real-time, dan return payload event 'result' terakhir (tanpa field 'type').
//
// hooks (opsional):
//   onLog(message, level)             -> tiap baris log teks
//   onProgress(processed, total, msg) -> tiap update progress bar
//
// Kalau backend gagal SEBELUM stream mulai (mis. validasi pre-flight
// HTTPException), response-nya JSON biasa non-2xx -> ditangani di cabang !res.ok.
async function _streamJob(path, { fields, jsonBody, hooks = {} } = {}) {
  const url = _api(path);
  const { onLog, onProgress } = hooks;
  const options = jsonBody !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody) }
    : { method: 'POST', body: _buildForm(fields || {}) };

  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    console.error(`[API] Gagal fetch ke ${url}`, networkErr);
    throw new Error(
      `Tidak bisa terhubung ke backend di ${window.AppConfig.API_BASE}. `
      + `Cek: (1) backend server nyala (uvicorn), (2) URL/port di config.js benar, `
      + `(3) tab Network di DevTools (F12) buat lihat request yang gagal. `
      + `Detail browser: ${networkErr.message}`
    );
  }

  if (!res.ok || !res.body) {
    const rawText = await res.text();
    let detail = null;
    try { detail = JSON.parse(rawText).detail; } catch { /* biarkan */ }
    console.error(`[API] HTTP ${res.status} dari ${url}:`, rawText.slice(0, 500));
    throw new Error(detail || `HTTP ${res.status} dari ${url}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;

  const handleLine = (line) => {
    const s = line.trim();
    if (!s) return;
    let evt;
    try { evt = JSON.parse(s); } catch { return; }
    if (evt.type === 'log') {
      if (onLog) onLog(evt.message, evt.level || 'info');
    } else if (evt.type === 'progress') {
      if (onProgress) onProgress(evt.processed, evt.total, evt.message);
      // pesan pada event progress (dari emit.step) juga muncul di panel log.
      if (evt.message && onLog) onLog(evt.message, 'info');
    } else if (evt.type === 'result') {
      result = evt;
    } else if (evt.type === 'error') {
      throw new Error(evt.detail || 'Gagal memproses');
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handleLine(buf);

  if (!result) throw new Error('Tidak ada hasil dari server');
  const { type, ...payload } = result;
  return payload;
}

window.Api = {
  // ===== Single File ===== (semua streaming; arg terakhir `hooks` opsional)
  singleUpload(file, hooks) {
    return _streamJob('/api/single/upload', { fields: { file }, hooks });
  },
  singleProcess(file, opts, hooks) {
    return _streamJob('/api/single/process', { fields: { file, ...opts }, hooks });
  },
  singlePlotRaw(file, channels, t_start, t_dur, annotation_filter, annotation_filter_active, hooks) {
    return _streamJob('/api/single/plot/raw', { fields: { file, channels, t_start, t_dur, annotation_filter, annotation_filter_active }, hooks });
  },
  singlePlotFiltered(file, channels, t_start, t_dur, opts, annotation_filter, annotation_filter_active, hooks) {
    return _streamJob('/api/single/plot/filtered', { fields: { file, channels, t_start, t_dur, annotation_filter, annotation_filter_active, ...opts }, hooks });
  },
  singlePlotSubband(file, channel, t_start, t_dur, subbands, opts, annotation_filter, annotation_filter_active, hooks) {
    return _streamJob('/api/single/plot/subband', { fields: { file, channel, t_start, t_dur, subbands, annotation_filter, annotation_filter_active, ...opts }, hooks });
  },
  singlePlotIca(file, opts, hooks) {
    return _streamJob('/api/single/plot/ica', { fields: { file, ...opts }, hooks });
  },
  singleErd(file, opts, hooks) {
    return _streamJob('/api/single/erd', { fields: { file, ...opts }, hooks });
  },

  // ===== Batch =====
  batchScan(file, hooks) {
    return _streamJob('/api/batch/scan', { fields: { file }, hooks });
  },
  // Streaming NDJSON: hooks.onProgress(processed, total) tiap file/sesi selesai,
  // hooks.onLog(msg) tiap baris log. Return payload result terakhir.
  batchProcessStream(file, opts, hooks, path = '/api/batch/process') {
    return _streamJob(path, { fields: { file, ...opts }, hooks });
  },

  // ===== ML =====
  mlUpload(file, hooks) {
    return _streamJob('/api/ml/upload', { fields: { file }, hooks });
  },
  mlTrain(payload, hooks) {
    return _streamJob('/api/ml/train', { jsonBody: payload, hooks });
  },
  mlPredict(file, model_id, hooks) {
    return _streamJob('/api/ml/predict', { fields: { file, model_id }, hooks });
  },

  // ===== Export =====
  async exportExcel(sheets, filename) {
    const url = _api('/api/export/excel');
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets, filename }),
      });
    } catch (networkErr) {
      console.error(`[API] Gagal fetch ke ${url}`, networkErr);
      throw new Error(`Tidak bisa terhubung ke backend di ${window.AppConfig.API_BASE}. Detail: ${networkErr.message}`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error(`[API] HTTP ${res.status} dari ${url}:`, data);
      throw new Error(data.detail || `Excel export gagal (HTTP ${res.status})`);
    }
    return res.blob();
  },

  async health() {
    try {
      const res = await fetch(_api('/health'));
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  },
};

window.downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Pisah records jadi list of sheets per scenario untuk export Excel multi-tab.
// Jika records tidak punya field scenario (mis. single file upload), kembalikan
// satu sheet dengan nama fallback.
window.recordsToScenarioSheets = (records, fallbackName = 'Features') => {
  if (!records || !records.length) return [];
  const hasScenario = 'scenario' in records[0]
    && records.some(r => r.scenario != null && String(r.scenario).trim() !== '');
  if (!hasScenario) return [{ name: fallbackName, records }];

  const groups = new Map();
  for (const rec of records) {
    const raw = rec.scenario;
    const key = (raw == null || String(raw).trim() === '') ? 'unknown' : String(raw);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([name, recs]) => ({ name, records: recs }));
};

window.downloadCSV = (records, filename) => {
  if (!records || !records.length) return;
  // Union semua key (bukan cuma records[0]) supaya record heterogen tidak
  // kehilangan kolom yang cuma muncul di baris selain yang pertama.
  const headers = [];
  const seen = new Set();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
  }
  const rows = [headers.join(',')];
  for (const rec of records) {
    rows.push(headers.map(h => {
      const v = rec[h];
      if (v == null) return '';
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  window.downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
};
