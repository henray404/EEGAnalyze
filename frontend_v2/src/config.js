/* global window */
// Frontend v2 config — exposed as window.AppConfig

window.AppConfig = {
  API_BASE: 'http://localhost:8000',

  SUBBANDS: [
    { id: 'delta',     name: 'Delta',     range: '0.5-4 Hz',  low: 0.5, high: 4 },
    { id: 'theta',     name: 'Theta',     range: '4-8 Hz',    low: 4,   high: 8 },
    { id: 'mu',        name: 'Mu',        range: '8-12 Hz',   low: 8,   high: 12 },
    { id: 'alpha',     name: 'Alpha',     range: '8-13 Hz',   low: 8,   high: 13 },
    { id: 'low_beta',  name: 'Low Beta',  range: '12-16 Hz',  low: 12,  high: 16 },
    { id: 'beta',      name: 'Beta',      range: '13-30 Hz',  low: 13,  high: 30 },
    { id: 'high_beta', name: 'High Beta', range: '20-30 Hz',  low: 20,  high: 30 },
    { id: 'gamma',     name: 'Gamma',     range: '30-49 Hz',  low: 30,  high: 49 },
  ],
  DEFAULT_SUBBANDS: ['delta', 'theta', 'alpha', 'beta', 'gamma'],

  FEATURES: [
    { id: 'mav', name: 'MAV' },
    { id: 'variance', name: 'Variance' },
    { id: 'std', name: 'STD' },
    { id: 'psd', name: 'PSD' },
    { id: 'erd', name: 'ERD' },
    { id: 'band_power', name: 'BandPower' },
  ],
  DEFAULT_FEATURES: ['mav', 'variance', 'std'],

  ICA_METHODS: ['fastica', 'infomax', 'picard'],
  PSD_METHODS: ['welch', 'multitaper'],
  NOTCH_FREQS: [50, 60],

  BP_DEFAULT_LOW: 0.5,
  BP_DEFAULT_HIGH: 49.0,
  BP_DEFAULT_ORDER: 5,

  PSD_DEFAULT_FMIN: 0.0,
  PSD_DEFAULT_FMAX: 49.5,
  PSD_DEFAULT_NFFT: 2048,

  CHUNK_MIN: 0.25,
  CHUNK_MAX: 2.0,
  CHUNK_STEP: 0.25,
  CHUNK_DEFAULT: 0.5,

  FEATURES_BACKEND_MAP: {
    mav: 'mav',
    variance: 'variance',
    std: 'std',
    band_power: 'band_power',
    relative_power: 'relative_power',
    peak_frequency: 'peak_frequency',
    psd: 'band_power',
    erd: 'band_power',
    ers: 'relative_power',
    BandPower: 'band_power',
  },
};
