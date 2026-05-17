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
  singlePlotRaw(file, channels, t_start, t_dur, annotation_filter) {
    return _postForm('/api/single/plot/raw', { file, channels, t_start, t_dur, annotation_filter });
  },
  singlePlotFiltered(file, channels, t_start, t_dur, opts, annotation_filter) {
    return _postForm('/api/single/plot/filtered', { file, channels, t_start, t_dur, annotation_filter, ...opts });
  },
  singlePlotSubband(file, channel, t_start, t_dur, subbands, opts, annotation_filter) {
    return _postForm('/api/single/plot/subband', { file, channel, t_start, t_dur, subbands, annotation_filter, ...opts });
  },
  singlePlotIca(file, opts) {
    return _postForm('/api/single/plot/ica', { file, ...opts });
  },

  // ===== Batch =====
  batchScan(file) {
    return _postForm('/api/batch/scan', { file });
  },
  batchProcess(file, opts) {
    return _postForm('/api/batch/process', { file, ...opts });
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

window.downloadCSV = (records, filename) => {
  if (!records || !records.length) return;
  const headers = Object.keys(records[0]);
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
