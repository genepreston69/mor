// Vanilla Node test for buildSharePointPayload (schema v2).
// Run: `node tests/payload.test.js` (exit code 1 on failure).
//
// Loads the dashboard <script> block out of index.html, stubs DOM /
// localStorage / Web Crypto / navigator, and exercises the builder.

'use strict';

const fs   = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { TextEncoder } = require('util');

// ----- Browser globals (stubbed) ---------------------------------------------

global.TextEncoder = TextEncoder;

// Node 19+ exposes globalThis.crypto with .subtle.digest already; if missing,
// fall back to a hash shim. Use defineProperty to avoid getter-only errors.
if (!global.crypto || !global.crypto.subtle) {
  Object.defineProperty(global, 'crypto', {
    value: {
      subtle: {
        digest: async (alg, data) => {
          if (!/sha-256/i.test(alg)) throw new Error('unsupported alg ' + alg);
          const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
          return Uint8Array.from(nodeCrypto.createHash('sha256').update(buf).digest()).buffer;
        },
      },
    },
    configurable: true,
    writable: true,
  });
}

if (!global.navigator) {
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'node-test-runner/1.0' },
    configurable: true,
    writable: true,
  });
}

function makeStubEl() {
  return {
    textContent: '', value: '', innerHTML: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelectorAll: () => [], querySelector: () => null,
    getAttribute: () => null, setAttribute: () => {},
    appendChild: () => {}, remove: () => {}, focus: () => {},
  };
}

global.document = {
  addEventListener: () => {},
  getElementById: () => makeStubEl(),
  querySelectorAll: () => [],
  querySelector: () => makeStubEl(),
  createElement: () => makeStubEl(),
  body: { appendChild: () => {} },
};

global.window = {};
global.alert  = () => {};
global.fetch  = () => Promise.reject(new Error('fetch unused in tests'));
global.FileReader = function () {};
global.XLSX = {};

global.localStorage = (() => {
  const store = {};
  return {
    getItem:    k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
})();

// ----- Load the dashboard script body ----------------------------------------

const html  = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lines = html.split('\n');
let scriptStart = -1, scriptEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (scriptStart === -1 && /^<script>\s*$/.test(lines[i]) && /let DATA = \{\};/.test(lines[i + 1] || '')) {
    scriptStart = i + 1;
  } else if (scriptStart !== -1 && /^<\/script>\s*$/.test(lines[i])) {
    scriptEnd = i;
    break;
  }
}
if (scriptStart < 0 || scriptEnd < 0) throw new Error('Could not locate dashboard <script> block');

// Drop top-level initializers that touch real DOM elements not stubbed
const trimmed = lines.slice(scriptStart, scriptEnd)
  .filter(l =>
    !/^document\.getElementById\('staffed-beds-input'\)/.test(l) &&
    !/^loadStored\(\)/.test(l) &&
    !/^render\(\)/.test(l)
  )
  .join('\n');

// ----- Test runner -----------------------------------------------------------

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else      { fail++; console.error('  FAIL  ' + name); }
}

function resetData(obj) {
  // eslint-disable-next-line no-undef
  for (const k of Object.keys(DATA)) delete DATA[k];
  // eslint-disable-next-line no-undef
  Object.assign(DATA, obj);
}

const harness = trimmed + `

;module.exports = {
  buildSharePointPayload,
  bumpSeq,
  getCurrentSeq,
  CYCLES,
  VOLUME_THRESHOLDS,
  DASHBOARD_VERSION,
  SCHEMA_VERSION,
  setData: (obj) => {
    for (const k of Object.keys(DATA)) delete DATA[k];
    Object.assign(DATA, obj);
  },
  setCycleStorage: (c) => localStorage.setItem('mor_cycle', c),
  clearStorage: () => localStorage.clear(),
  setAudit: (name, role) => {
    localStorage.setItem('mor_submitted_by', name);
    localStorage.setItem('mor_submitted_role', role);
  },
};
`;

// Compile via Function constructor with a module shim
const moduleShim = { exports: {} };
const fn = new Function('module', 'exports', 'globalThis', harness);
fn(moduleShim, moduleShim.exports, global);
const api = moduleShim.exports;

(async () => {
  // ---- Test 1: payload shape across all four cycles --------------------------
  for (const cycle of api.CYCLES) {
    api.clearStorage();
    api.setCycleStorage(cycle);
    api.setData({
      facility: 'Acme Hospital',
      period:   'April 2026',
      net_revenue: { mar_act: 100, mar_bud: 95, mar_var: 5 },
      deck: { volume: [{ label: 'ADC', act: 30, bud: 31, var: -1, var_pct: -0.03 }] },
      categories: [],
    });
    const p = await api.buildSharePointPayload();
    assert(p.schema_version === api.SCHEMA_VERSION, cycle + ': schema_version === 2');
    assert(p.cycle === cycle, cycle + ': cycle echoed');
    assert(typeof p.submission_id === 'string' && /^[0-9a-f]{64}$/.test(p.submission_id),
      cycle + ': submission_id is 64-char sha256 hex');
    assert(p.submission_sequence === 1, cycle + ': submission_sequence === 1 on first build');
    assert(p.audit && typeof p.audit.dashboard_version === 'string' && p.audit.dashboard_version.length > 0,
      cycle + ': audit.dashboard_version present');
  }

  // ---- Test 2: deterministic submission_id + sequence ------------------------
  api.clearStorage();
  api.setCycleStorage('FCST02');
  api.setData({ facility: 'F', period: 'P' });
  const a = await api.buildSharePointPayload();
  const b = await api.buildSharePointPayload();
  assert(a.submission_id === b.submission_id, 'submission_id deterministic across rebuilds');
  assert(a.submission_sequence === 1 && b.submission_sequence === 1,
    'submission_sequence is the next-to-issue value, idempotent across rebuilds');

  api.bumpSeq(a.facility, a.period, a.cycle, a.submission_sequence);
  const c = await api.buildSharePointPayload();
  assert(c.submission_id === a.submission_id, 'submission_id stable after sequence bump');
  assert(c.submission_sequence === 2, 'submission_sequence increments by 1 after a successful submit');

  // ---- Test 3: ADC count threshold (regression of the v1 bug) ---------------
  api.clearStorage();
  api.setData({
    facility: 'F', period: 'P',
    deck: { volume: [{ label: 'ADC', act: 27, bud: 30, var: -3, var_pct: -0.10 }] },
  });
  const adcOver = (await api.buildSharePointPayload()).volume.find(v => v.label === 'ADC');
  assert(adcOver.requires_note === true, 'ADC var=-3 -> requires_note: true (v1 bug regression)');
  assert(adcOver.threshold === 2 && adcOver.threshold_unit === 'count',
    'ADC threshold echoed as 2/count');

  api.setData({
    facility: 'F', period: 'P',
    deck: { volume: [{ label: 'ADC', act: 29, bud: 30, var: -1, var_pct: -0.0333 }] },
  });
  const adcUnder = (await api.buildSharePointPayload()).volume.find(v => v.label === 'ADC');
  assert(adcUnder.requires_note === false, 'ADC var=-1 -> requires_note: false');

  // ---- Test 4: LOS percentage threshold -------------------------------------
  api.setData({
    facility: 'F', period: 'P',
    deck: { volume: [{ label: 'LOS', act: 9.0, bud: 9.6, var: -0.6, var_pct: -0.0625 }] },
  });
  const losOver = (await api.buildSharePointPayload()).volume.find(v => v.label === 'LOS');
  assert(losOver.requires_note === true, 'LOS var_pct=-0.0625 -> requires_note: true');
  assert(losOver.threshold === 0.05 && losOver.threshold_unit === 'pct',
    'LOS threshold echoed as 0.05/pct');

  api.setData({
    facility: 'F', period: 'P',
    deck: { volume: [{ label: 'LOS', act: 9.4, bud: 9.6, var: -0.2, var_pct: -0.02 }] },
  });
  const losUnder = (await api.buildSharePointPayload()).volume.find(v => v.label === 'LOS');
  assert(losUnder.requires_note === false, 'LOS var_pct=-0.02 -> requires_note: false');

  // ---- Test 5: Occupancy pct + audit fields ---------------------------------
  api.setData({
    facility: 'F', period: 'P',
    deck: { volume: [
      { label: 'Occupancy',  act: 0.82, bud: 0.86, var: -0.04, var_pct: -0.0465 },
      { label: 'Admissions', act: 95,   bud: 110,  var: -15,   var_pct: -0.136 },
    ]},
  });
  api.setAudit('Gene Preston', 'Facility CFO');
  const p5 = await api.buildSharePointPayload();
  const occ = p5.volume.find(v => v.label === 'Occupancy');
  const adm = p5.volume.find(v => v.label === 'Admissions');
  assert(occ.requires_note === true && occ.threshold === 0.03 && occ.threshold_unit === 'pct',
    'Occupancy var_pct=-0.0465 -> requires_note: true; threshold pct/0.03');
  assert(adm.requires_note === true && adm.threshold === 10 && adm.threshold_unit === 'count',
    'Admissions var=-15 -> requires_note: true; threshold count/10');
  assert(p5.audit.submitted_by === 'Gene Preston' && p5.audit.submitted_role === 'Facility CFO',
    'audit.submitted_by + submitted_role surfaced from localStorage');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
