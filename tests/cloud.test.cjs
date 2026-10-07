const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dependencies = process.env.WAREHOUSE_TEST_DEPENDENCIES;
const { JSDOM } = require(dependencies ? path.join(dependencies, 'jsdom') : 'jsdom');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const cloud = fs.readFileSync(path.join(__dirname, '../cloud.js'), 'utf8');
const cloudConfig = fs.readFileSync(path.join(__dirname, '../cloud-config.js'), 'utf8');
const session = { user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' } };
const phone = { materials: [{ id: 1, name: '手機材料', spec: '管件／個', stock: 9, alert: 2, location: '3樓315', detail: '' }],
  transactions: [{ materialId: 1, materialName: '手機材料', unit: '個', amount: 1, type: '減少', time: new Date().toISOString(), reason: '維修使用', note: '315' }], locations: ['3樓315'] };
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ authenticated = true, initialized = true, sdk = true, legacy = phone } = {}) {
  const dom = new JSDOM(html, { url: 'https://yoossshhhhiiiii.github.io/YoossshhhhiiiiiMade.github.io/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => 'blob:backup'; w.URL.revokeObjectURL = () => {};
  const downloads = [];
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  const raw = {
    'inventory-materials': JSON.stringify(legacy.materials),
    'inventory-transactions': JSON.stringify(legacy.transactions),
    'inventory-locations': JSON.stringify(legacy.locations)
  };
  for (const [key, value] of Object.entries(raw)) w.localStorage.setItem(key, value);
  w.localStorage.setItem('inventory-first-floor-photo-import-2026-09-29-v1', 'done');
  let server = { initialized, revision: initialized ? 1 : 0, canImport: true, materials: initialized ? [{ ...phone.materials[0], stock: 12, version: 1 }] : [], locations: initialized ? ['3樓315'] : [], transactions: [] };
  let callback;
  let handler;
  const calls = [];
  const ledger = new Map();
  const client = {
    auth: {
      getSession: async () => ({ data: { session: authenticated ? session : null }, error: null }),
      onAuthStateChange: cb => { callback = cb; },
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null })
    },
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (handler) return handler(name, params);
      if (name === 'warehouse_mutate') {
        if (!ledger.has(params.p_request_id)) {
          const payload = params.p_payload;
          if (params.p_operation === 'adjust_stock') {
            server.materials[0].stock += payload.amount;
            server.materials[0].version++;
            server.transactions.push({ ...phone.transactions[0], amount: Math.abs(payload.amount), type: payload.amount > 0 ? '增加' : '減少', note: payload.note, reason: payload.reason });
          } else if (params.p_operation === 'import_phone') {
            server = { ...payload, canImport: true, initialized: true, revision: server.revision, materials: payload.materials.map(item => ({ ...item, version: 1 })) };
          } else if (params.p_operation === 'add_location') server.locations.push(payload.name);
          else if (params.p_operation === 'save_material') server.materials.push({ id: 2, name: payload.name, spec: `${payload.category}／${payload.unit}`, stock: payload.stock, alert: payload.alert, location: payload.location, detail: payload.detail, version: 1 });
          server.revision++; ledger.set(params.p_request_id, true);
        }
      }
      return { data: structuredClone(server), error: null };
    }
  };
  if (sdk) w.supabase = { createClient: () => client };
  w.eval(cloudConfig); w.eval(cloud); w.eval(app);
  const q = selector => w.document.querySelector(selector);
  const click = selector => { assert(q(selector), selector); q(selector).click(); };
  const change = (selector, value, type = 'change') => {
    q(selector).value = value; q(selector).dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  const assertLegacy = () => { for (const [key, value] of Object.entries(raw)) assert.equal(w.localStorage.getItem(key), value, 'Cloud mode must not overwrite legacy data'); };
  return { dom, w, q, click, change, calls, downloads, assertLegacy,
    handler: value => { handler = value; }, server: () => server, callback: value => callback('SIGNED_OUT', value) };
}

test('Cloud mode preserves original device data, blocks signed-out edits, handles SDK failure', async () => {
  const a = setup({ authenticated: false }); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  assert(a.q('#newMaterialButton').disabled);
  assert(!a.q('#cloudLoginForm').classList.contains('hidden'));
  a.click('#backupDeviceButton'); assert.equal(a.downloads.length, 1); a.assertLegacy(); a.w.close();
  const b = setup({ sdk: false }); await tick();
  assert(b.q('#newMaterialButton').disabled); assert(b.q('#cloudLoginButton').disabled);
  b.click('#backupDeviceButton'); assert.equal(b.downloads.length, 1); b.assertLegacy(); b.w.close();
});

test('Phone import requires current backup and explicit device confirmation, preserves history and stock', async () => {
  const a = setup({ initialized: false }); await tick();
  assert.equal(a.q('#materialCount').textContent, '1', 'Legacy preview only after authorized login');
  assert(a.q('#newMaterialButton').disabled); assert(a.q('#cloudImportButton').disabled);
  a.q('#confirmPhoneImport').checked = true; a.q('#confirmSavedBackup').checked = true;
  a.q('#confirmSavedBackup').dispatchEvent(new a.w.Event('change'));
  assert(a.q('#cloudImportButton').disabled, 'Checkboxes alone are not enough');
  a.click('#backupDeviceButton'); assert(!a.q('#cloudImportButton').disabled);
  a.click('#cloudImportButton'); await tick();
  const request = a.calls.find(call => call.params?.p_operation === 'import_phone');
  assert.equal(request.params.p_payload.materials[0].stock, 9);
  assert.equal(request.params.p_payload.transactions[0].note, '315');
  assert(request.params.p_payload.locations.includes('3樓315'));
  assert.equal(a.q('#materialCount').textContent, '1'); assert(!a.q('#newMaterialButton').disabled);
  assert(a.q('#cloudImportPanel').classList.contains('hidden')); a.assertLegacy(); a.w.close();
  const b = setup({ initialized: false }); await tick(); b.click('#backupDeviceButton');
  b.w.localStorage.setItem('inventory-materials', JSON.stringify([{ ...phone.materials[0], stock: 10 }]));
  b.q('#confirmPhoneImport').checked = true; b.q('#confirmSavedBackup').checked = true;
  b.q('#confirmSavedBackup').dispatchEvent(new b.w.Event('change'));
  b.click('#cloudImportButton'); await tick();
  assert.match(b.q('#cloudDetail').textContent, /重新下載備份/);
  assert(!b.calls.some(call => call.name === 'warehouse_mutate')); b.w.close();
});

test('Cloud adjustments are confirmed before UI changes; lost response retries same UUID; offline never falls back to local writes', async () => {
  const a = setup(); await tick(); assert.equal(a.q('.stock-number').textContent, '12');
  let response;
  a.handler((name, params) => name === 'warehouse_snapshot'
    ? Promise.resolve({ data: structuredClone(a.server()), error: null })
    : new Promise(resolve => { response = resolve; }));
  a.click('[data-action="minus"]'); a.change('#noteInput', '315'); a.click('#confirmAdjustment');
  assert.equal(a.q('.stock-number').textContent, '12', 'No optimistic decrement');
  assert(a.q('#confirmAdjustment').disabled); a.click('#confirmAdjustment');
  assert.equal(a.calls.filter(call => call.name === 'warehouse_mutate').length, 1, 'Double click cannot send twice');
  const first = a.calls.find(call => call.name === 'warehouse_mutate');
  a.server().materials[0].stock = 11; a.server().revision++;
  response({ data: null, error: { message: 'Failed to fetch', code: '' } }); await tick();
  assert(!a.q('#cloudRetryButton').classList.contains('hidden')); assert(a.q('#newMaterialButton').disabled);
  a.handler(async (name, params) => ({ data: structuredClone(a.server()), error: null }));
  a.click('#cloudRetryButton'); await tick();
  const last = a.calls.filter(call => call.name === 'warehouse_mutate').at(-1);
  assert.equal(last.params.p_request_id, first.params.p_request_id);
  assert.equal(a.q('.stock-number').textContent, '11');
  assert(a.q('#modal').classList.contains('hidden'), 'Recovered request closes the old adjustment form');
  assert(!a.q('#newMaterialButton').disabled); a.assertLegacy();
  a.w.dispatchEvent(new a.w.Event('offline')); assert(a.q('#newMaterialButton').disabled);
  await assert.rejects(a.w.InventoryCloud.mutate('adjust_stock', { materialId: 1, amount: -1 }), /尚未異動/);
  a.assertLegacy(); a.w.close();
});

test('Logout clears displayed cloud inventory, revocation hides cloud data, import validation rejects bad/orphaned data', async () => {
  const a = setup(); await tick(); a.click('#cloudLogoutButton'); await tick();
  assert.equal(a.q('#materialCount').textContent, '0'); assert(a.q('#newMaterialButton').disabled); a.assertLegacy(); a.w.close();
  const b = setup(); await tick();
  b.handler(async () => ({ data: null, error: { code: '42501', message: 'WAREHOUSE_ACCESS_DENIED' } }));
  await b.w.InventoryCloud.refresh(); assert.equal(b.q('#materialCount').textContent, '0'); assert(b.q('#newMaterialButton').disabled);
  assert.throws(() => b.w.InventoryCloud.validateImport({ ...phone, materials: [{ ...phone.materials[0], stock: -1 }] }), /格式或數量/);
  assert.throws(() => b.w.InventoryCloud.validateImport({ ...phone, transactions: [{ ...phone.transactions[0], materialId: 99 }] }), /對應材料/);
  const payload = b.w.InventoryCloud.validateImport(phone);
  assert.equal(payload.materials[0].stock, 9); assert.equal(payload.transactions[0].note, '315'); b.assertLegacy(); b.w.close();
});

test('Existing local-only functionality and intro remain available when cloud config is not loaded', () => {
  const dom = new JSDOM(html, { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.INVENTORY_CLOUD_CONFIG = { enabled: false };
  dom.window.eval(app); const doc = dom.window.document;
  assert.equal(doc.querySelector('#materialCount').textContent, '43');
  assert.equal(doc.querySelectorAll('.material-card').length, 5);
  doc.querySelector('[data-action="minus"]').click(); doc.querySelector('#confirmAdjustment').click();
  assert.equal(JSON.parse(dom.window.localStorage.getItem('inventory-transactions')).length, 1);
  assert.equal(doc.querySelector('#summaryPanel').nextElementSibling.id, 'todayPanel');
  assert.equal(doc.querySelector('#todayPanel').nextElementSibling.id, 'inventoryPanel'); dom.window.close();
});

test('Missing config or missing cloud module fails closed instead of generating or modifying local stock', async () => {
  for (const includeCloud of [false, true]) {
    const dom = new JSDOM(html, { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    const original = JSON.stringify(phone.materials);
    w.localStorage.setItem('inventory-materials', original);
    if (includeCloud) w.eval(cloud);
    w.eval(app); await tick();
    assert(w.document.querySelector('#newMaterialButton').disabled);
    assert.equal(w.document.querySelector('#materialCount').textContent, '0');
    assert.equal(w.localStorage.getItem('inventory-materials'), original);
    assert.equal(w.localStorage.getItem('inventory-first-floor-photo-import-2026-09-29-v1'), null, 'No photo seed migration in cloud mode');
    w.close();
  }
});

test('Cloud location and material forms retain optional detail, pagination, room-number notes and date statistics', async () => {
  const a = setup(); await tick();
  a.click('#addLocationFromFilter'); a.change('#newLocationName', '2樓201'); a.q('#locationForm').requestSubmit(); await tick();
  assert.equal(a.q('#locationFilter').value, '2樓201');
  assert(a.calls.some(call => call.params?.p_operation === 'add_location'));
  a.click('#newMaterialButton');
  for (const [id, value] of Object.entries({ materialName: '新雲端材料', materialCategory: '維修', materialUnit: '個', materialStock: '5', materialAlert: '2', materialLocation: '2樓201', materialDetail: '' })) a.change(`#${id}`, value);
  a.q('#materialForm').requestSubmit(); await tick();
  assert.match(a.q('#materialList').textContent, /新雲端材料/);
  assert.equal(a.calls.find(call => call.params?.p_operation === 'save_material').params.p_payload.detail, '');
  a.change('#locationFilter', '3樓315'); a.click('[data-action="minus"]'); a.change('#noteInput', '315'); a.click('#confirmAdjustment'); await tick();
  assert.match(a.q('#todayTransactions').textContent, /維修使用/);
  assert.match(a.q('#todayTransactions').textContent, /315/);
  a.click('[data-view="stats"]'); assert.match(a.q('#rangeTransactions').textContent, /315/);
  assert.equal(a.q('#noteInput').placeholder, '可輸入寢室號碼');
  a.change('#statsStartDate', '2026-12-31'); a.change('#statsEndDate', '2026-01-01'); assert(!a.q('#statsRangeError').classList.contains('hidden'));
  a.assertLegacy(); a.w.close();
});

test('Signing out in another tab during an in-flight write never restores private cloud data', async () => {
  const a = setup(); await tick();
  let response;
  a.handler(() => new Promise(resolve => { response = resolve; }));
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment');
  a.callback(null); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(a.q('#materialCount').textContent, '0');
  response({ data: structuredClone(a.server()), error: null }); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  assert(a.q('#newMaterialButton').disabled); a.assertLegacy(); a.w.close();
});

test('Malformed success and permission failure keep uncertain retry identity; no fallback or private display after revocation', async () => {
  const a = setup(); await tick();
  a.handler(async () => ({ data: { initialized: true }, error: null }));
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment'); await tick();
  const request = a.calls.find(call => call.name === 'warehouse_mutate');
  assert(!a.q('#cloudRetryButton').classList.contains('hidden')); assert(a.q('#newMaterialButton').disabled);
  a.handler(async () => ({ data: null, error: { code: '42501', message: 'WAREHOUSE_ACCESS_DENIED' } }));
  a.click('#cloudRetryButton'); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  assert(!a.q('#cloudRetryButton').classList.contains('hidden'), 'Revocation cannot discard identity of a previously uncertain operation');
  a.handler(async () => ({ data: structuredClone(a.server()), error: null }));
  a.click('#cloudRetryButton'); await tick();
  assert.equal(a.calls.filter(call => call.name === 'warehouse_mutate').at(-1).params.p_request_id, request.params.p_request_id);
  assert(!a.q('#newMaterialButton').disabled); a.assertLegacy(); a.w.close();
});
