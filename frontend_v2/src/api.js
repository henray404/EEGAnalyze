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

async function _postForm(path, fields) {
  const res = await fetch(_api(path), { method: 'POST', body: _buildForm(fields) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

async function _postJson(path, body) {
  const res = await fetch(_api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

window.Api = {
  // ===== Single File =====
  singleUpload(file) {
    return _postForm('/api/single/upload', { file });
  },
  singleProcess(file, opts) {
    return _postForm('/api/single/process', { file, ...opts });
  },
  singlePlotRaw(file, channels, t_start, t_dur, annotation_filter, annotation_filter_active) {
    return _postForm('/api/single/plot/raw', { file, channels, t_start, t_dur, annotation_filter, annotation_filter_active });
  },
  singlePlotFiltered(file, channels, t_start, t_dur, opts, annotation_filter, annotation_filter_active) {
    return _postForm('/api/single/plot/filtered', { file, channels, t_start, t_dur, annotation_filter, annotation_filter_active, ...opts });
  },
  singlePlotSubband(file, channel, t_start, t_dur, subbands, opts, annotation_filter, annotation_filter_active) {
    return _postForm('/api/single/plot/subband', { file, channel, t_start, t_dur, subbands, annotation_filter, annotation_filter_active, ...opts });
  },
  singlePlotIca(file, opts) {
    return _postForm('/api/single/plot/ica', { file, ...opts });
  },
  singleErd(file, opts) {
    return _postForm('/api/single/erd', { file, ...opts });
  },

  // ===== Batch =====
  batchScan(file) {
    return _postForm('/api/batch/scan', { file });
  },
  batchProcess(file, opts) {
    return _postForm('/api/batch/process', { file, ...opts });
  },
  // Streaming NDJSON: panggil onProgress(processed, total) tiap file selesai,
  // return payload result terakhir. Progress nyata, bukan estimasi.
  async batchProcessStream(file, opts, onProgress, path = '/api/batch/process') {
    const res = await fetch(_api(path), {
      method: 'POST', body: _buildForm({ file, ...opts }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
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
      if (evt.type === 'progress') {
        if (onProgress) onProgress(evt.processed, evt.total);
      } else if (evt.type === 'result') {
        result = evt;
      } else if (evt.type === 'error') {
        throw new Error(evt.detail || 'Batch gagal');
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
    return result;
  },

  // ===== ML =====
  mlUpload(file) {
    return _postForm('/api/ml/upload', { file });
  },
  mlTrain(payload) {
    return _postJson('/api/ml/train', payload);
  },
  mlPredict(file, model_id) {
    return _postForm('/api/ml/predict', { file, model_id });
  },

  // ===== Export =====
  async exportExcel(sheets, filename) {
    const res = await fetch(_api('/api/export/excel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheets, filename }),
    });
    if (!res.ok) throw new Error('Excel export failed');
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
