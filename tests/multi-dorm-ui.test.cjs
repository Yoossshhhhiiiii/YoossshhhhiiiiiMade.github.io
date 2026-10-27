const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const names = { d7: '學七舍', pair1: '男一舍＋女一舍', pair2: '男二舍＋女二舍' };

async function setup({ allowed = ['d7', 'pair1', 'pair2'], writable = true, pending = null } = {}) {
  const dom = new JSDOM(read('index.html'), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => 'blob:backup'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' };
  const snapshots = Object.fromEntries(Object.keys(names).map(id => [id, { dormId: id, dormName: names[id], initialized: true, revision: 0, canWrite: writable, canImport: false, features: { transactionEdit: true }, materials: id === 'd7' ? [{ id: 1, name: '學七原材料', spec: '／個', location: '3樓315', detail: '', stock: 40, alert: 5, version: 1 }] : [], transactions: [], locations: id === 'd7' ? ['3樓315'] : [], archivedMaterials: [] }]));
  const calls = [], ledger = new Set();
  let intercept, authCallback;
  const localBefore = JSON.stringify([{ name: '手機舊資料不匯入' }]);
  w.localStorage.setItem('inventory-materials', localBefore);
  if (pending) w.localStorage.setItem(`inventory-cloud-pending-v1:https://nhunrezwvfwqqappdqij.supabase.co:${user.id}:${pending.id}`, JSON.stringify(pending));
  w.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user } } }), onAuthStateChange: cb => { authCallback = cb; } },
    rpc: async (name, params) => {
      calls.push({ name, params });
      const custom = intercept?.(name, params);
      if (custom) return custom;
      if (name === 'warehouse_dorms') return { data: allowed.map(id => ({ id, name: names[id], canWrite: writable, materialCount: snapshots[id].materials.length, locationCount: snapshots[id].locations.length, lowCount: 0 })), error: null };
      const id = params.p_dorm_id;
      if (!allowed.includes(id)) return { data: null, error: { code: '42501', message: 'WAREHOUSE_ACCESS_DENIED' } };
      if (name === 'warehouse_dorm_mutate' && !ledger.has(params.p_request_id)) {
        if (!writable) return { data: null, error: { code: '42501', message: 'WAREHOUSE_READ_ONLY' } };
        if (params.p_operation === 'add_location') snapshots[id].locations.push(params.p_payload.name);
        if (params.p_operation === 'adjust_stock') snapshots[id].materials[0].stock += params.p_payload.amount;
        snapshots[id].revision++; ledger.add(params.p_request_id);
      }
      return { data: structuredClone(snapshots[id]), error: null };
    } }) };
  w.eval(read('cloud-config.js')); w.eval(read('cloud.js')); w.eval(read('app.js')); await tick(); await tick();
  return { w, calls, snapshots, q: selector => w.document.querySelector(selector), intercept: fn => { intercept = fn; }, logout: () => authCallback('SIGNED_OUT', null), assertLegacy: () => assert.equal(w.localStorage.getItem('inventory-materials'), localBefore) };
}

test('Real multi-dorm UI keeps 學七舍 data, switches to empty stores and scopes every write', async () => {
  const a = await setup();
  const before = structuredClone(a.snapshots.d7);
  assert.equal(a.q('#currentDormName').textContent, '學七舍');
  assert.equal(a.q('#materialCount').textContent, '1');
  a.q('[data-action="minus"]').click(); a.q('#noteInput').value = '未送出';
  a.q('#searchInput').value = '舊篩選';
  await a.w.InventoryCloud.selectDorm('pair1');
  assert(a.q('#modal').classList.contains('hidden'));
  assert.equal(a.q('#searchInput').value, '');
  assert.equal(a.q('#materialCount').textContent, '0');
  assert.equal(a.q('#materialLocation').options.length, 0);
  assert(!a.q('#warehouseEmpty').classList.contains('hidden'));
  assert(a.q('#emptyAddMaterial').disabled);
  await a.w.InventoryCloud.mutate('add_location', { name: '1樓' });
  assert(!a.q('#emptyAddMaterial').disabled);
  assert.equal(a.calls.find(call => call.name === 'warehouse_dorm_mutate').params.p_dorm_id, 'pair1');
  await a.w.InventoryCloud.selectDorm('pair2');
  assert.equal(a.q('#materialLocation').options.length, 0);
  await a.w.InventoryCloud.selectDorm('d7');
  assert.equal(a.q('#materialCount').textContent, '1');
  assert.deepEqual(a.snapshots.d7, before);
  assert(!a.calls.some(call => ['warehouse_snapshot', 'warehouse_mutate'].includes(call.name)), 'New app uses only scoped RPCs');
  a.assertLegacy(); a.w.close();
});

test('Viewer and limited accounts see only server-authorized stores and never expose mock account switching', async () => {
  const reader = await setup({ writable: false });
  for (const id of ['d7', 'pair1', 'pair2']) {
    await reader.w.InventoryCloud.selectDorm(id);
    assert.equal(reader.w.InventoryCloud.canWrite(), false);
    assert(reader.q('#newMaterialButton').classList.contains('hidden'));
    assert(reader.q('#warehouseEmptyActions').classList.contains('hidden'));
    await assert.rejects(reader.w.InventoryCloud.mutate('add_location', { name: '禁止' }), /只能查看/);
  }
  assert(!reader.calls.some(x => x.name === 'warehouse_dorm_mutate'));
  assert(!/切換模擬帳號/.test(reader.w.document.body.textContent));
  reader.w.close();
  for (const id of ['pair1', 'pair2']) {
    const a = await setup({ allowed: [id] });
    assert.equal(a.w.InventoryCloud.status().dormId, id);
    assert.deepEqual([...a.q('#dormOptions').children].map(x => x.dataset.dormId), [id]);
    assert(a.q('#allDormsButton').classList.contains('hidden'));
    assert.equal(await a.w.InventoryCloud.selectDorm('d7'), false);
    assert.equal(a.q('#materialCount').textContent, '0');
    a.assertLegacy(); a.w.close();
  }
});

test('Late responses, sign-out and pending legacy operations cannot move data or retries into a different dorm', async () => {
  const a = await setup();
  let release;
  a.intercept((name, params) => name === 'warehouse_dorm_snapshot' && params.p_dorm_id === 'd7' ? new Promise(resolve => { release = resolve; }) : null);
  const old = a.w.InventoryCloud.refresh(); await tick();
  await a.w.InventoryCloud.selectDorm('pair2');
  release({ data: a.snapshots.d7, error: null }); await old;
  assert.equal(a.q('#currentDormName').textContent, names.pair2);
  assert.equal(a.q('#materialCount').textContent, '0');
  a.logout(); await new Promise(resolve => setTimeout(resolve, 5));
  assert(a.q('#dormControl').classList.contains('hidden')); assert.equal(a.q('#dormOverview').children.length, 0);
  a.assertLegacy(); a.w.close();
  const pending = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-111111111111', operation: 'adjust_stock', payload: { materialId: 1, amount: -1, reason: '維修使用', note: '原版待確認' } };
  const b = await setup({ pending });
  await assert.rejects(b.w.InventoryCloud.selectDorm('pair1'), /待處理/);
  b.q('#cloudRetryButton').click(); await tick(); await tick();
  assert.equal(b.calls.find(x => x.name === 'warehouse_dorm_mutate').params.p_dorm_id, 'd7');
  assert.equal(b.snapshots.d7.materials[0].stock, 39);
  assert.equal(b.snapshots.pair1.revision, 0); assert.equal(b.snapshots.pair2.revision, 0);
  b.assertLegacy(); b.w.close();
});
