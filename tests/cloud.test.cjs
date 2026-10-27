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

test('Account actions use the four preview SVG icons without changing their real actions', async () => {
  const a = setup(); await tick();
  const expected = [
    ['cloudRefreshButton', '#icon-sync'], ['cloudLogoutButton', '#icon-logout'],
    ['backupDeviceButton', '#icon-device-download'], ['backupCloudButton', '#icon-cloud-download']
  ];
  for (const [id, icon] of expected) {
    const svg = a.q(`#${id} > svg.account-action-icon`);
    assert(svg, `${id} needs a consistent SVG icon`);
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(svg.querySelector('use').getAttribute('href'), icon);
    assert(a.q(icon), `${icon} must resolve to an existing SVG symbol`);
  }
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.account-action > \.account-action-icon \{ width: 20px; height: 20px; flex: 0 0 20px; stroke-width: 1\.5;/);
  a.click('#accountButton'); a.click('#cloudRefreshButton'); await tick();
  a.click('#accountButton'); a.click('#cloudLogoutButton'); a.click('#cancelLogout');
  assert.equal(a.authCalls.length, 0); a.assertLegacy(); a.w.close();
});

test('Location cards and all dropdowns sort floors descending, east before west, and B1 last without changing stored data', async () => {
  const a = setup(); await tick();
  const original = ['10樓東', '10樓西', '11樓東', '11樓西', '12樓東', '12樓西', '1樓', '2樓東', '2樓西', '3樓315', '3樓東', '3樓西', '4樓東', '4樓西', '5樓東', '5樓西', '6樓東', '6樓西', '7樓東', '7樓西', '8樓東', '8樓西', '9樓東', '9樓西', 'B1變電站'];
  a.server().locations = original.slice();
  const before = structuredClone(a.server());
  await a.w.InventoryCloud.refresh();
  const expected = [];
  for (let floor = 12; floor >= 2; floor--) {
    expected.push(`${floor}樓東`, `${floor}樓西`);
    if (floor === 3) expected.push('3樓315');
  }
  expected.push('1樓', 'B1變電站');
  assert.deepEqual([...a.q('#warehouseLocations').children].map(card => card.dataset.location), expected);
  assert.deepEqual([...a.q('#locationFilter').options].map(option => option.value), ['全部位置', ...expected]);
  assert.deepEqual([...a.q('#materialLocation').options].map(option => option.value), expected);
  assert.deepEqual([...a.q('#deleteLocationSelect').options].map(option => option.value), ['', ...expected]);
  a.click('#newMaterialButton'); assert.equal(a.q('#materialLocation').value, '12樓東');
  a.change('#materialLocation', '3樓315'); await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#materialLocation').value, '3樓315', 'Sync keeps an unsaved location selection');
  a.click('#materialModal [data-close-material-modal]'); a.click('[data-action="edit"]');
  assert.equal(a.q('#materialLocation').value, '3樓315', 'Editing preserves the saved material location');
  assert.deepEqual(a.server(), before, 'Sorting never changes stock, history, stored location order or revision');
  assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  a.assertLegacy(); a.w.close();
});

test('Location sorting places added rooms numerically within their floor and handles basements and unknown names', async () => {
  const a = setup(); await tick();
  a.server().locations = ['備品庫10', 'B2機房', '3樓315', '1樓', '3樓西', '備品庫2', 'B1變電站', '12樓西', '3樓東', '3樓302', '12樓東'];
  const original = a.server().locations.slice(); await a.w.InventoryCloud.refresh();
  assert.deepEqual([...a.q('#materialLocation').options].map(option => option.value),
    ['12樓東', '12樓西', '3樓東', '3樓西', '3樓302', '3樓315', '1樓', 'B1變電站', 'B2機房', '備品庫2', '備品庫10']);
  assert.deepEqual(a.server().locations, original);
  assert(![...a.q('#locationFilter').options].some(option => option.value === '11樓東'), 'No absent default location is re-added');
  a.assertLegacy(); a.w.close();
});

test('Account popover exposes four real actions; logout requires confirmation and keeps backups', async () => {
  const a = setup(); await tick();
  assert(a.q('#cloudPanel').classList.contains('hidden'));
  assert(!a.q('#accountControl').classList.contains('hidden'));
  a.click('#accountButton'); assert.equal(a.q('#accountButton').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...a.q('#accountPopover').querySelectorAll('.account-action')].map(button => button.id), ['cloudRefreshButton', 'cloudLogoutButton', 'backupDeviceButton', 'backupCloudButton']);
  assert.match(a.q('#accountStatus').textContent, /雲端已連線/); assert.match(a.q('#accountLastSync').textContent, /上次同步/);
  const reads = a.calls.length; a.click('#cloudRefreshButton'); await tick(); assert(a.calls.length > reads);
  a.click('#backupDeviceButton'); a.click('#backupCloudButton'); assert.equal(a.downloads.length, 2);
  assert(a.q('#cloudPanel').classList.contains('hidden'), 'Routine downloads do not restore the large account card');
  a.click('#cloudLogoutButton'); assert(!a.q('#logoutModal').classList.contains('hidden'));
  assert.equal(a.w.document.activeElement.id, 'cancelLogout'); a.click('#cancelLogout');
  assert.equal(a.authCalls.length, 0); assert.equal(a.q('#materialCount').textContent, '1');
  a.click('#accountButton'); a.click('#cloudLogoutButton'); a.click('#confirmLogout'); await tick();
  assert.equal(a.authCalls[0].signOut.scope, 'local');
  assert(a.q('#accountControl').classList.contains('hidden')); assert(!a.q('#cloudLoginForm').classList.contains('hidden'));
  a.assertLegacy(); a.w.close();
});

test('Material delete cancellation retains unsaved fields; confirmed archive preserves usage and statistics', async () => {
  const a = setup(); await tick();
  a.click('#newMaterialButton'); assert(a.q('#deleteMaterialButton').classList.contains('hidden'));
  a.click('#materialModal [data-close-material-modal]');
  a.click('[data-action="minus"]'); a.change('#noteInput', '315'); a.click('#confirmAdjustment'); await tick();
  const beforeHistory = structuredClone(a.server().transactions);
  a.click('[data-action="edit"]'); a.change('#materialName', '尚未儲存名稱'); a.click('#deleteMaterialButton');
  assert.equal(a.q('#deleteMaterialName').textContent, '手機材料', 'Confirmation uses saved identity');
  assert.equal(a.w.document.activeElement.id, 'cancelDeleteMaterial');
  a.click('#cancelDeleteMaterial'); assert.equal(a.q('#materialName').value, '尚未儲存名稱');
  assert.equal(a.w.document.activeElement.id, 'deleteMaterialButton');
  assert(!a.calls.some(call => call.params?.p_operation === 'archive_material'));
  a.click('#deleteMaterialButton'); a.click('#confirmDeleteMaterial'); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  assert(a.q('#deleteMaterialModal').classList.contains('hidden'));
  assert.equal(a.server().archivedMaterials[0].stock, 11);
  assert.deepEqual(a.server().transactions, beforeHistory); assert.match(a.q('#todayTransactions').textContent, /手機材料/);
  assert.equal(a.q('#monthlyUsage').textContent, '1');
  a.click('[data-view="stats"]'); assert.match(a.q('#rangeTransactions').textContent, /315/);
  a.click('#deleteLocationFromFilter'); a.change('#deleteLocationSelect', '3樓315');
  assert(a.q('#confirmDeleteLocation').disabled); assert.match(a.q('#deleteLocationSummary').textContent, /封存/);
  a.assertLegacy(); a.w.close();
});

test('Stale archive, offline archive and unknown-result retry never remove or duplicate material optimistically', async () => {
  const a = setup(); await tick(); a.click('[data-action="edit"]');
  a.server().materials[0].version++; a.server().revision++; await a.w.InventoryCloud.refresh();
  a.click('#deleteMaterialButton'); assert(a.q('#deleteMaterialModal').classList.contains('hidden'));
  a.click('#materialModal [data-close-material-modal]'); a.click('[data-action="edit"]'); a.click('#deleteMaterialButton');
  a.w.dispatchEvent(new a.w.Event('offline')); assert(a.q('#confirmDeleteMaterial').disabled);
  assert(!a.q('#cloudPanel').classList.contains('hidden'), 'Offline state remains visible outside the popover');
  await a.w.InventoryCloud.refresh();
  let resolve;
  a.handler((name) => name === 'warehouse_snapshot' ? Promise.resolve({ data: structuredClone(a.server()), error: null }) : new Promise(r => { resolve = r; }));
  a.click('#confirmDeleteMaterial'); a.click('#confirmDeleteMaterial');
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'archive_material').length, 1);
  assert.equal(a.q('#materialCount').textContent, '1'); assert(a.q('#cancelDeleteMaterial').disabled);
  const request = a.calls.find(call => call.params?.p_operation === 'archive_material');
  a.server().archivedMaterials = [{ ...a.server().materials[0], archivedAt: new Date().toISOString() }]; a.server().materials = []; a.server().revision++;
  resolve({ data: null, error: { message: 'Failed to fetch' } }); await tick();
  assert(!a.q('#cloudPanel').classList.contains('hidden')); assert(!a.q('#cloudRetryButton').classList.contains('hidden'));
  a.handler(async () => ({ data: structuredClone(a.server()), error: null }));
  a.click('#cloudRetryButton'); await tick();
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'archive_material').at(-1).params.p_request_id, request.params.p_request_id);
  assert.equal(a.q('#materialCount').textContent, '0'); assert(a.q('#deleteMaterialModal').classList.contains('hidden'));
  a.assertLegacy(); a.w.close();
});

test('Statistics calendar ranges include leap months, year-crossing Monday weeks, DST and year bounds', async () => {
  const a = setup(); await tick();
  const range = (mode, value) => JSON.parse(JSON.stringify(a.w.statsPeriodRange(mode, value)));
  assert.deepEqual(range('month', '2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(range('month', '2025-02'), { start: '2025-02-01', end: '2025-02-28' });
  assert.deepEqual(range('month', '2026-12'), { start: '2026-12-01', end: '2026-12-31' });
  assert.deepEqual(range('month', '0001-01'), { start: '0001-01-01', end: '0001-01-31' });
  assert.deepEqual(range('week', '2025-01-01'), { start: '2024-12-30', end: '2025-01-05' });
  assert.deepEqual(range('week', '2025-01-05'), { start: '2024-12-30', end: '2025-01-05' });
  assert.deepEqual(range('week', '2025-01-06'), { start: '2025-01-06', end: '2025-01-12' });
  assert.deepEqual(range('week', '2026-03-08'), { start: '2026-03-02', end: '2026-03-08' });
  for (const [mode, value] of [['month',''], ['month','2026-13'], ['month','2026-2'], ['month','0000-01'], ['week','2025-02-29'], ['week','2026-02-30'], ['week','bad']]) assert.equal(a.w.statsPeriodRange(mode, value), null);
  a.w.close();
});

test('Statistics month/week navigation preserves custom dates and filters material, reason, note without mutations', async () => {
  const a = setup(); await tick();
  const event = (day, amount, type, note) => ({ id: a.w.crypto.randomUUID(), materialId: 1, materialName: '手機材料', unit: '個', amount, type, reason: type === '增加' ? '入庫補貨' : '維修使用', note, time: new Date(`${day}T12:00:00`).toISOString(), version: 1, editHistory: [] });
  a.server().transactions = [event('2024-12-29', 10, '減少', '周前排除'), event('2024-12-30', 2, '減少', '跨年周'), event('2025-01-05', 3, '減少', '周末315'), event('2025-01-05', 4, '增加', '補貨'), event('2025-01-06', 7, '減少', '下周'), event('2025-02-01', 8, '減少', '次月')];
  await a.w.InventoryCloud.refresh(); a.click('#statsButton');
  const beforeStock = a.server().materials[0].stock;
  a.change('#statsMonthInput', '2025-01');
  assert.equal(a.q('#statsStartDate').value, '2025-01-01'); assert.equal(a.q('#statsEndDate').value, '2025-01-31');
  assert.equal(a.q('#statsHeading').textContent, '月統計');
  assert.match(a.q('#usageBreakdown').textContent, /10 個/); assert.equal(a.q('#rangeUsage').textContent, '2 筆'); assert.equal(a.q('#rangeRestock').textContent, '1 筆');
  assert.match(a.q('#rangeTransactions').textContent, /周末315/); assert.match(a.q('#rangeTransactions').textContent, /入庫補貨/); assert.doesNotMatch(a.q('#rangeTransactions').textContent, /跨年周|次月/);
  a.click('#statsPreviousPeriod'); assert.equal(a.q('#statsMonthInput').value, '2024-12');
  a.click('#statsNextPeriod'); assert.equal(a.q('#statsMonthInput').value, '2025-01');
  a.click('[data-stats-mode="week"]'); a.change('#statsWeekInput', '2025-01-01');
  assert.equal(a.q('#statsHeading').textContent, '周統計');
  assert.equal(a.q('#statsStartDate').value, '2024-12-30'); assert.equal(a.q('#statsEndDate').value, '2025-01-05');
  assert.match(a.q('#usageBreakdown').textContent, /5 個/); assert.match(a.q('#statsPeriodLabel').textContent, /週一至週日/);
  assert.doesNotMatch(a.q('#rangeTransactions').textContent, /周前排除|下周/);
  a.click('#statsNextPeriod'); assert.equal(a.q('#statsStartDate').value, '2025-01-06'); assert.equal(a.q('#statsEndDate').value, '2025-01-12'); assert.match(a.q('#usageBreakdown').textContent, /7 個/);
  a.click('[data-stats-mode="custom"]'); a.change('#statsStartDate', '2025-01-05'); a.change('#statsEndDate', '2025-01-06');
  assert.match(a.q('#usageBreakdown').textContent, /10 個/);
  a.click('[data-stats-mode="month"]'); a.click('[data-stats-mode="custom"]');
  assert.equal(a.q('#statsStartDate').value, '2025-01-05'); assert.equal(a.q('#statsEndDate').value, '2025-01-06');
  a.change('#statsStartDate', '2025-02-02'); assert(!a.q('#statsRangeError').classList.contains('hidden'));
  a.click('[data-stats-mode="month"]'); a.change('#statsMonthInput', '0001-01'); assert(a.q('#statsPreviousPeriod').disabled);
  a.change('#statsMonthInput', '9999-12'); assert(a.q('#statsNextPeriod').disabled);
  a.change('#statsMonthInput', ''); assert(!a.q('#statsRangeError').classList.contains('hidden')); assert(a.q('#statsNextPeriod').disabled);
  a.click('#statsCurrentPeriod'); assert(a.q('#statsRangeError').classList.contains('hidden'));
  assert.equal(a.server().materials[0].stock, beforeStock); assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  assert(!a.q('#rangeTransactions [data-edit-transaction]'));
  a.assertLegacy(); a.w.close();
});

test('Statistics details show five newest records per page while totals and history cover the full range', async () => {
  const a = setup(); await tick();
  const event = n => ({ id: a.w.crypto.randomUUID(), materialId: 1, materialName: `材料${n}`, unit: '個', amount: n,
    type: n % 3 === 0 ? '增加' : '減少', reason: n % 3 === 0 ? '入庫補貨' : '維修使用', note: `房號${n}`,
    time: new Date(2026, 0, 6, 10, n).toISOString(), version: 1, editHistory: [] });
  const records = Array.from({ length: 9 }, (_, i) => event(i + 1));
  records[3].editHistory = [{ time: records[3].time, before: { amount: 3, type: '減少', reason: '維修使用', note: '原備註' }, after: { amount: 4, type: '減少', reason: '維修使用', note: '房號4', version: 2 } }];
  records[3].version = 2;
  a.server().transactions = [4, 1, 9, 7, 2, 8, 3, 5, 6].map(n => records[n - 1]);
  const original = structuredClone(a.server());
  await a.w.InventoryCloud.refresh(); a.click('#statsButton'); a.change('#statsMonthInput', '2026-01');
  const names = () => [...a.q('#rangeTransactions').querySelectorAll('.transaction-main strong')].map(node => node.textContent);
  assert.deepEqual(names(), ['材料9', '材料8', '材料7', '材料6', '材料5']);
  assert.equal(a.q('#rangeCount').textContent, '（9 筆）');
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 1／2 頁 · 共 9 筆');
  assert(a.q('#previousStatsTransactionsPage').disabled); assert(!a.q('#nextStatsTransactionsPage').disabled);
  assert.equal(a.q('#rangeUsage').textContent, '6 筆'); assert.equal(a.q('#rangeRestock').textContent, '3 筆');
  assert.match(a.q('#usageBreakdown').textContent, /27 個/);
  a.click('#nextStatsTransactionsPage');
  assert.deepEqual(names(), ['材料4', '材料3', '材料2', '材料1']);
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 2／2 頁 · 共 9 筆');
  assert(a.q('#nextStatsTransactionsPage').disabled); assert(!a.q('#previousStatsTransactionsPage').disabled);
  assert.match(a.q('#rangeTransactions').textContent, /房號4/); assert.match(a.q('#rangeTransactions').textContent, /入庫補貨/);
  a.q('#rangeTransactions details').open = true;
  await a.w.InventoryCloud.refresh();
  assert.deepEqual(names(), ['材料4', '材料3', '材料2', '材料1']);
  assert(a.q('#rangeTransactions details').open, 'Sync keeps the current page and expanded visible audit');
  assert.match(a.q('#usageBreakdown').textContent, /27 個/, 'Changing pages never changes all-range totals');
  a.click('#previousStatsTransactionsPage'); assert.deepEqual(names(), ['材料9', '材料8', '材料7', '材料6', '材料5']);
  a.click('#nextStatsTransactionsPage'); a.click('[data-stats-mode="week"]'); a.change('#statsWeekInput', '2026-01-06');
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 1／2 頁 · 共 9 筆');
  a.click('#nextStatsTransactionsPage'); a.click('[data-stats-mode="custom"]');
  a.change('#statsStartDate', '2026-01-06'); a.change('#statsEndDate', '2026-01-06');
  assert.deepEqual(names(), ['材料9', '材料8', '材料7', '材料6', '材料5']);
  a.click('#nextStatsTransactionsPage'); a.change('#statsEndDate', '2026-01-05');
  assert(a.q('#statsTransactionsPagination').classList.contains('hidden'));
  assert.equal(names().length, 0); assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 1／1 頁 · 共 0 筆');
  assert.deepEqual(a.server(), original); assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  a.assertLegacy(); a.w.close();
});

test('Statistics pagination handles empty and exact page boundaries without missing or duplicate records', async () => {
  for (const size of [0, 1, 5, 6, 10, 11]) {
    const a = setup(); await tick();
    const records = Array.from({ length: size }, (_, i) => ({ id: a.w.crypto.randomUUID(), materialId: 1, materialName: `紀錄${i + 1}`, unit: '個', amount: 1, type: '減少', reason: '維修使用', note: '', time: new Date(2026, 0, 6, 10, i).toISOString(), version: 1, editHistory: [] }));
    a.server().transactions = records.concat([{ ...records[0], materialId: 1, time: 'invalid', amount: 1 }, { ...records[0], materialId: 1, time: new Date(2026, 1, 1, 12).toISOString(), amount: 1 }]);
    await a.w.InventoryCloud.refresh(); a.click('#statsButton'); a.change('#statsMonthInput', '2026-01');
    assert.equal(a.q('#statsTransactionsPagination').classList.contains('hidden'), size <= 5);
    assert.equal(a.q('#rangeCount').textContent, `（${size} 筆）`);
    const visited = [];
    do {
      const names = [...a.q('#rangeTransactions').querySelectorAll('.transaction-main strong')].map(node => node.textContent);
      assert(names.length <= 5); visited.push(...names);
      if (a.q('#nextStatsTransactionsPage').disabled) break;
      a.click('#nextStatsTransactionsPage');
    } while (true);
    assert.deepEqual(visited, records.slice().reverse().map(record => record.materialName));
    assert.equal(new Set(visited).size, size);
    assert(!a.calls.some(call => call.name === 'warehouse_mutate')); a.assertLegacy(); a.w.close();
  }
});

test('Statistics sync clamps a removed last page and logout clears all paginated records', async () => {
  const a = setup(); await tick();
  a.server().transactions = Array.from({ length: 11 }, (_, i) => ({ id: a.w.crypto.randomUUID(), materialId: 1, materialName: `紀錄${i + 1}`, unit: '個', amount: 1, type: '減少', reason: '維修使用', note: '', time: new Date(2026, 0, 6, 10, i).toISOString(), version: 1, editHistory: [] }));
  await a.w.InventoryCloud.refresh(); a.click('#statsButton'); a.change('#statsMonthInput', '2026-01');
  a.click('#nextStatsTransactionsPage'); a.click('#nextStatsTransactionsPage');
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 3／3 頁 · 共 11 筆');
  a.server().transactions = a.server().transactions.slice(0, 7); await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 2／2 頁 · 共 7 筆');
  assert.equal(a.q('#rangeTransactions').querySelectorAll('.transaction-card').length, 2);
  a.callback(null); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(a.q('#rangeTransactions').querySelectorAll('.transaction-card').length, 0);
  assert(a.q('#statsTransactionsPagination').classList.contains('hidden'));
  assert.equal(a.q('#statsTransactionsPageStatus').textContent, '第 1／1 頁 · 共 0 筆');
  a.assertLegacy(); a.w.close();
});

test('Today edit occupies its own central grid cell and remains bound to the same event', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment'); await tick();
  const card = a.q('#todayTransactions .transaction-card-editable');
  const button = card.querySelector('[data-edit-transaction]');
  assert.equal(button.parentElement, card); assert(card.querySelector('.transaction-content .transaction-note'));
  assert(card.querySelector(':scope > .transaction-amount')); assert(!card.querySelector('.transaction-tools'));
  a.click('#todayTransactions [data-edit-transaction]'); assert(!a.q('#transactionEditModal').classList.contains('hidden'));
  a.click('#closeTransactionEdit'); assert(a.q('#transactionEditModal').classList.contains('hidden'));
  a.assertLegacy(); a.w.close();
});

test('Today edit corrects the original event by its difference, updates totals, keeps time, and retains audit', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]'); a.change('#stepValue', '3', 'input'); a.change('#noteInput', '315'); a.click('#confirmAdjustment'); await tick();
  const original = structuredClone(a.server().transactions[0]);
  assert.equal(a.server().materials[0].stock, 9);
  assert.equal(a.q('#monthlyUsage').textContent, '3');
  assert(a.q('#todayTransactions [data-edit-transaction]'));
  assert(!a.q('#rangeTransactions [data-edit-transaction]'), 'Only today receives edit buttons');
  a.click('#todayTransactions [data-edit-transaction]');
  assert.equal(a.q('#transactionEditQuantity').value, '3'); assert.equal(a.q('#transactionEditNote').value, '315');
  assert(a.q('#saveTransactionEdit').disabled, 'Unchanged drafts cannot create meaningless corrections');
  assert.equal(a.w.document.activeElement.id, 'closeTransactionEdit');
  a.change('#transactionEditQuantity', '2', 'input'); a.change('#transactionEditNote', '316', 'input');
  assert.match(a.q('#transactionEditAfter').textContent, /10/); assert.match(a.q('#transactionEditDelta').textContent, /補回庫存 1 個/);
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'edit_transaction').length, 0, 'Preview never writes');
  a.click('#saveTransactionEdit'); await tick();
  const edited = a.server().transactions[0];
  assert.equal(a.server().materials[0].stock, 10); assert.equal(a.server().transactions.length, 1);
  assert.equal(edited.amount, 2); assert.equal(edited.note, '316'); assert.equal(edited.time, original.time); assert.equal(edited.id, original.id);
  assert.equal(edited.editHistory.length, 1); assert.equal(edited.editHistory[0].before.note, '315');
  assert.equal(a.q('#monthlyUsage').textContent, '2'); assert.match(a.q('#todayTransactions').textContent, /已修正 1 次/);
  a.q('#todayTransactions details').open = true; await a.w.InventoryCloud.refresh();
  assert(a.q('#todayTransactions details').open, 'Periodic refresh preserves an opened audit history');
  assert.match(a.q('#rangeTransactions').textContent, /316/); assert(a.q('#transactionEditModal').classList.contains('hidden'));
  a.click('#todayTransactions [data-edit-transaction]'); a.change('#transactionEditQuantity', '8', 'input');
  a.click('#closeTransactionEdit'); assert.equal(a.server().materials[0].stock, 10); assert.equal(edited.editHistory.length, 1);
  a.assertLegacy(); a.w.close();
});

test('Today edit switches signed direction, prevents invalid numbers and revalidates other-device stock or event changes', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]'); a.change('#stepValue', '3', 'input'); a.click('#confirmAdjustment'); await tick();
  a.click('#todayTransactions [data-edit-transaction]');
  for (const quantity of ['', '0', '-1', '1.5', 'x', '1e2', '2147483648', '13']) {
    a.change('#transactionEditQuantity', quantity, 'input'); assert(a.q('#saveTransactionEdit').disabled, quantity);
    a.q('#transactionEditForm').dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true }));
  }
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'edit_transaction').length, 0);
  a.change('#transactionEditQuantity', '4', 'input'); a.change('#transactionEditReason', '入庫補貨');
  assert.match(a.q('#transactionEditAfter').textContent, /16/); assert.match(a.q('#transactionEditDelta').textContent, /補回庫存 7 個/);
  a.click('#saveTransactionEdit'); await tick();
  assert.equal(a.server().materials[0].stock, 16); assert.equal(a.server().transactions[0].type, '增加'); assert.equal(a.q('#monthlyUsage').textContent, '0');
  a.click('#todayTransactions [data-edit-transaction]'); a.change('#transactionEditQuantity', '5', 'input');
  a.server().materials[0].stock = 2147483647; await a.w.InventoryCloud.refresh();
  assert(a.q('#saveTransactionEdit').disabled); assert.match(a.q('#transactionEditError').textContent, /範圍/);
  a.server().materials[0].stock = 1; await a.w.InventoryCloud.refresh();
  a.change('#transactionEditQuantity', '1', 'input');
  assert(a.q('#saveTransactionEdit').disabled); assert.match(a.q('#transactionEditError').textContent, /不足/);
  a.change('#transactionEditQuantity', '4', 'input'); a.change('#transactionEditNote', '新備註', 'input');
  a.server().transactions[0].version++; await a.w.InventoryCloud.refresh();
  assert(a.q('#saveTransactionEdit').disabled); assert.match(a.q('#transactionEditError').textContent, /其他裝置/);
  assert.equal(a.q('#transactionEditNote').value, '新備註', 'Conflict does not silently replace draft');
  a.server().materials = []; await a.w.InventoryCloud.refresh();
  assert(a.q('#saveTransactionEdit').disabled); assert.match(a.q('#transactionEditError').textContent, /封存/);
  a.assertLegacy(); a.w.close();
});

test('Today edit never writes optimistically; pending retry uses one identity and signs out safely', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment'); await tick();
  a.click('#todayTransactions [data-edit-transaction]'); a.change('#transactionEditNote', '316', 'input');
  let response;
  a.handler(name => name === 'warehouse_snapshot' ? Promise.resolve({ data: structuredClone(a.server()), error: null }) : new Promise(resolve => { response = resolve; }));
  a.click('#saveTransactionEdit');
  for (const id of ['transactionEditQuantity', 'transactionEditReason', 'transactionEditNote', 'saveTransactionEdit', 'closeTransactionEdit']) assert(a.q(`#${id}`).disabled, id);
  a.click('#closeTransactionEdit'); assert(!a.q('#transactionEditModal').classList.contains('hidden'));
  assert.equal(a.server().transactions[0].note, '');
  a.callback(null); await new Promise(resolve => setTimeout(resolve, 5));
  assert(a.q('#transactionEditModal').classList.contains('hidden')); assert.equal(a.q('#transactionEditNote').value, '');
  response({ data: null, error: { message: 'session changed', code: '' } }); await tick();
  assert.equal(a.q('#materialCount').textContent, '0'); a.assertLegacy(); a.w.close();

  const b = setup(); await tick();
  b.click('[data-action="minus"]'); b.change('#stepValue', '3', 'input'); b.click('#confirmAdjustment'); await tick();
  b.click('#todayTransactions [data-edit-transaction]'); b.change('#transactionEditQuantity', '2', 'input');
  b.handler((name, params) => {
    if (name === 'warehouse_snapshot') return Promise.resolve({ data: structuredClone(b.server()), error: null });
    if (params.p_operation === 'edit_transaction') {
      if (b.server().transactions[0].version === 1) { b.server().transactions[0].version = 2; b.server().transactions[0].amount = 2; b.server().materials[0].stock = 10; b.server().revision++; }
      return Promise.resolve({ data: null, error: { message: 'Failed to fetch', code: '' } });
    }
  });
  b.click('#saveTransactionEdit'); await tick();
  assert(!b.q('#transactionEditModal').classList.contains('hidden')); assert(b.q('#saveTransactionEdit').disabled);
  const initialRequest = b.calls.filter(call => call.params?.p_operation === 'edit_transaction')[0];
  assert.equal(b.q('#transactionEditBefore').textContent, '9 個', 'Lost response does not optimistically show corrected stock');
  b.handler(() => Promise.resolve({ data: structuredClone(b.server()), error: null }));
  b.click('#cloudRetryButton'); await tick();
  const retry = b.calls.filter(call => call.params?.p_operation === 'edit_transaction').at(-1);
  assert.equal(retry.params.p_request_id, initialRequest.params.p_request_id);
  assert.equal(b.q('#transactionEditModal').classList.contains('hidden'), true); assert.equal(b.server().materials[0].stock, 10);
  b.assertLegacy(); b.w.close();
});

test('Older cloud databases disable transaction editing without fallback or permission changes', async () => {
  const a = setup({ transactionEdit: false }); await tick();
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment'); await tick();
  const button = a.q('#todayTransactions [data-edit-transaction]');
  assert(button.disabled); assert.match(button.title, /尚未啟用/);
  a.click('#todayTransactions [data-edit-transaction]'); assert(a.q('#transactionEditModal').classList.contains('hidden'));
  assert(!a.calls.some(call => call.params?.p_operation === 'edit_transaction')); a.assertLegacy(); a.w.close();
});

test('Local legacy transaction correction retains event time and audit across reload', async () => {
  const dom = new JSDOM(html, { url: 'https://preview.example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.document.documentElement.dataset.storageMode = 'local';
  w.localStorage.setItem('inventory-materials', JSON.stringify(phone.materials));
  w.localStorage.setItem('inventory-transactions', JSON.stringify(phone.transactions));
  w.localStorage.setItem('inventory-first-floor-photo-import-2026-09-29-v1', 'done');
  w.eval(app);
  w.document.querySelector('[data-edit-transaction]').click();
  const input = w.document.getElementById('transactionEditQuantity'); input.value = '2'; input.dispatchEvent(new w.Event('input'));
  w.document.getElementById('saveTransactionEdit').click(); await tick();
  const saved = JSON.parse(w.localStorage.getItem('inventory-transactions'));
  assert.equal(JSON.parse(w.localStorage.getItem('inventory-materials'))[0].stock, 8);
  assert.equal(saved[0].time, phone.transactions[0].time); assert.equal(saved[0].version, 2); assert.equal(saved[0].editHistory.length, 1);
  const reloaded = new JSDOM(html, { url: 'https://preview.example.test/', runScripts: 'outside-only' });
  reloaded.window.document.documentElement.dataset.storageMode = 'local';
  for (const key of ['inventory-materials', 'inventory-transactions', 'inventory-first-floor-photo-import-2026-09-29-v1']) reloaded.window.localStorage.setItem(key, w.localStorage.getItem(key));
  reloaded.window.eval(app); assert.match(reloaded.window.document.getElementById('todayTransactions').textContent, /已修正 1 次/);
  w.close(); reloaded.window.close();
});

function setup({ authenticated = true, initialized = true, sdk = true, legacy = phone,
  accountSession = session, authError = null, configOverride = null, transactionEdit = true, canWrite = true } = {}) {
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
  let server = { initialized, revision: initialized ? 1 : 0, canImport: canWrite, canWrite, features: { transactionEdit }, materials: initialized ? [{ ...phone.materials[0], stock: 12, version: 1 }] : [], locations: initialized ? ['3樓315'] : [], transactions: [] };
  let callback;
  let handler;
  const calls = [];
  const authCalls = [];
  const ledger = new Map();
  const client = {
    auth: {
      getSession: async () => ({ data: { session: authenticated ? accountSession : null }, error: null }),
      onAuthStateChange: cb => { callback = cb; },
      signInWithPassword: async credentials => {
        authCalls.push(credentials);
        return { data: { session: authError ? null : accountSession }, error: authError };
      },
      signOut: async options => { authCalls.push({ signOut: options }); return { error: null }; }
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
            server.transactions.push({ ...phone.transactions[0], id: w.crypto.randomUUID(), version: 1, editHistory: [], amount: Math.abs(payload.amount), type: payload.amount > 0 ? '增加' : '減少', note: payload.note, reason: payload.reason });
          } else if (params.p_operation === 'edit_transaction') {
            const record = server.transactions.find(record => record.id === payload.transactionId);
            if (!record) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_TRANSACTION_NOT_FOUND' } };
            if (record.version !== payload.version) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_TRANSACTION_EDIT_CONFLICT' } };
            const item = server.materials.find(item => item.id === record.materialId);
            if (!item) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_MATERIAL_NOT_FOUND' } };
            const type = payload.reason === '入庫補貨' ? '增加' : '減少';
            const delta = (type === '增加' ? payload.quantity : -payload.quantity) - (record.type === '增加' ? record.amount : -record.amount);
            if (item.stock + delta < 0) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_INSUFFICIENT_STOCK' } };
            const before = { amount: record.amount, type: record.type, reason: record.reason, note: record.note, version: record.version };
            const after = { amount: payload.quantity, type, reason: payload.reason, note: payload.note, version: record.version + 1 };
            record.editHistory.push({ time: new Date().toISOString(), before, after, stockBefore: item.stock, stockAfter: item.stock + delta });
            Object.assign(record, after); item.stock += delta; item.version++;
          } else if (params.p_operation === 'import_phone') {
            server = { ...payload, canImport: true, canWrite, initialized: true, revision: server.revision, features: { transactionEdit }, materials: payload.materials.map(item => ({ ...item, version: 1 })), transactions: payload.transactions.map(record => ({ ...record, id: w.crypto.randomUUID(), version: 1, editHistory: [] })) };
          } else if (params.p_operation === 'add_location') server.locations.push(payload.name);
          else if (params.p_operation === 'delete_location') {
            if (server.materials.some(item => item.location === payload.name)) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_LOCATION_IN_USE' } };
            server.locations = server.locations.filter(name => name !== payload.name);
          } else if (params.p_operation === 'save_material') {
            const item = server.materials.find(item => item.id === payload.id);
            const metadata = { name: payload.name, spec: `${payload.category}／${payload.unit}`, alert: payload.alert, location: payload.location, detail: payload.detail };
            if (item) Object.assign(item, metadata, { version: item.version + 1 });
            else server.materials.push({ id: Math.max(0, ...server.materials.map(item => item.id)) + 1, ...metadata, stock: payload.stock, version: 1 });
          } else if (params.p_operation === 'archive_material') {
            const item = server.materials.find(item => item.id === payload.id);
            if (!item) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_MATERIAL_NOT_FOUND' } };
            if (item.version !== payload.version) return { data: null, error: { code: 'P0001', message: 'WAREHOUSE_EDIT_CONFLICT' } };
            server.archivedMaterials ||= [];
            server.archivedMaterials.push({ ...item, version: item.version + 1, archivedAt: new Date().toISOString() });
            server.materials = server.materials.filter(candidate => candidate.id !== item.id);
          }
          server.revision++; ledger.set(params.p_request_id, true);
        }
      }
      return { data: structuredClone(server), error: null };
    }
  };
  if (sdk) w.supabase = { createClient: () => client };
  w.eval(cloudConfig);
  w.INVENTORY_CLOUD_CONFIG = { ...w.INVENTORY_CLOUD_CONFIG, multiDorm: false };
  if (configOverride) w.INVENTORY_CLOUD_CONFIG = { ...w.INVENTORY_CLOUD_CONFIG, ...configOverride };
  w.eval(cloud); w.eval(app);
  const q = selector => w.document.querySelector(selector);
  const click = selector => { assert(q(selector), selector); q(selector).click(); };
  const change = (selector, value, type = 'change') => {
    q(selector).value = value; q(selector).dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  const assertLegacy = () => { for (const [key, value] of Object.entries(raw)) assert.equal(w.localStorage.getItem(key), value, 'Cloud mode must not overwrite legacy data'); };
  return { dom, w, q, click, change, calls, authCalls, downloads, assertLegacy,
    handler: value => { handler = value; }, server: () => server, callback: value => callback('SIGNED_OUT', value) };
}

test('Read-only username can view all inventory, locations, history and statistics without mutation controls or RPC writes', async () => {
  const a = setup({ canWrite: false, accountSession: { user: { ...session.user, email: 'viewer01@nhunrezwvfwqqappdqij.warehouse.invalid' } } }); await tick();
  a.server().materials.push({ ...a.server().materials[0], id: 2, name: '另一位置材料', location: '12樓東' });
  a.server().locations.push('12樓東');
  a.server().transactions = [{ ...phone.transactions[0], id: a.w.crypto.randomUUID(), version: 1, editHistory: [] }];
  const baseline = structuredClone(a.server()); await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#cloudAccount').textContent, 'viewer01');
  assert.match(a.q('#accountStatus').textContent, /唯讀帳號/);
  assert(!a.q('#readOnlyNotice').classList.contains('hidden')); assert(!a.w.InventoryCloud.canWrite());
  assert.equal(a.q('#materialCount').textContent, '2'); assert.equal(a.q('#warehouseLocations').children.length, 2);
  for (const id of ['newMaterialButton', 'addLocationFromPage', 'addLocationFromFilter', 'addLocationFromForm', 'deleteLocationFromPage', 'deleteLocationFromFilter']) {
    assert(a.q(`#${id}`).disabled); assert(a.q(`#${id}`).classList.contains('hidden'));
  }
  for (const button of a.w.document.querySelectorAll('#materialList [data-action], #todayTransactions [data-edit-transaction]')) {
    assert(button.disabled); assert(button.classList.contains('hidden'));
  }
  a.change('#locationFilter', '12樓東'); assert.match(a.q('#materialList').textContent, /另一位置材料/);
  a.change('#locationFilter', '全部位置'); a.change('#searchInput', '手機材料', 'input');
  assert.match(a.q('#materialList').textContent, /手機材料/); assert(!a.q('#materialList').textContent.includes('另一位置材料'));
  a.click('#statsButton'); assert.equal(a.q('#rangeCount').textContent, '（1 筆）'); assert.match(a.q('#rangeTransactions').textContent, /315/);
  for (const operation of ['adjust_stock', 'save_material', 'archive_material', 'add_location', 'delete_location', 'edit_transaction', 'import_phone']) {
    await assert.rejects(a.w.InventoryCloud.mutate(operation, {}), /只能查看/);
  }
  a.click('#backupCloudButton'); assert.equal(a.downloads.length, 1, 'Downloading a copy does not change warehouse data');
  assert.deepEqual(a.server(), baseline); assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  assert.equal(a.w.InventoryCloud.status().pending.length, 0); a.assertLegacy(); a.w.close();
});

test('Missing or malformed write permission fails closed while preserving readable data', async () => {
  for (const value of [undefined, null, 'true', 1]) {
    const a = setup(); await tick(); a.server().canWrite = value; await a.w.InventoryCloud.refresh();
    assert(!a.w.InventoryCloud.canWrite()); assert(a.q('#newMaterialButton').disabled);
    assert.equal(a.q('#materialCount').textContent, '1'); assert(!a.q('#cloudPanel').classList.contains('hidden'));
    assert.match(a.q('#cloudStatus').textContent, /權限設定尚未完成/);
    await assert.rejects(a.w.InventoryCloud.mutate('adjust_stock', {}), /權限尚未確認/);
    assert(!a.calls.some(call => call.name === 'warehouse_mutate')); a.assertLegacy(); a.w.close();
  }
});

test('Changing a writer to read-only closes unsaved drafts, preserves inventory, and never falls back to local data', async () => {
  for (const control of ['[data-action="minus"]', '[data-action="edit"]', '#addLocationFromFilter', '#deleteLocationFromFilter']) {
    const a = setup(); await tick(); a.click(control);
    a.server().canWrite = false; const baseline = structuredClone(a.server()); await a.w.InventoryCloud.refresh();
    for (const id of ['modal', 'materialModal', 'locationModal', 'deleteLocationModal', 'transactionEditModal']) assert(a.q(`#${id}`).classList.contains('hidden'));
    assert.equal(a.q('.app-shell').inert, false); assert(!a.w.InventoryCloud.canWrite());
    assert.deepEqual(a.server(), baseline); assert(!a.calls.some(call => call.name === 'warehouse_mutate')); a.assertLegacy(); a.w.close();
  }
  const a = setup({ canWrite: false, initialized: false }); await tick();
  a.server().canImport = true; await a.w.InventoryCloud.refresh();
  assert(a.q('#cloudImportPanel').classList.contains('hidden'));
  await assert.rejects(a.w.InventoryCloud.mutate('import_phone', {}), /只能查看/); a.assertLegacy(); a.w.close();
});

test('Server read-only denial settles a definitely absent request without clearing readable stock or retaining unsafe retries', async () => {
  const a = setup(); await tick(); const baseline = structuredClone(a.server());
  a.handler(name => name === 'warehouse_snapshot' ? Promise.resolve({ data: structuredClone(a.server()), error: null })
    : Promise.resolve({ data: null, error: { code: '42501', message: 'WAREHOUSE_READ_ONLY' } }));
  await assert.rejects(a.w.InventoryCloud.mutate('adjust_stock', { materialId: 1, amount: -1, reason: '維修使用', note: '' }), /只能查看/);
  assert.equal(a.w.InventoryCloud.status().pending.length, 0); assert.equal(a.w.InventoryCloud.status().mode, 'ready');
  assert.equal(a.q('#materialCount').textContent, '1'); assert(!a.w.InventoryCloud.canWrite());
  assert(!a.q('#readOnlyNotice').classList.contains('hidden')); assert.deepEqual(a.server(), baseline); a.assertLegacy(); a.w.close();
});

test('A downgraded writer can confirm a previously committed exact request without allowing any new writes', async () => {
  const a = setup(); await tick(); let receipt;
  a.handler((name, params) => {
    if (name === 'warehouse_snapshot') return Promise.resolve({ data: structuredClone(a.server()), error: null });
    if (!receipt) {
      receipt = params.p_request_id; a.server().materials[0].stock--; a.server().revision++; a.server().canWrite = false;
      return Promise.resolve({ data: null, error: { message: 'Failed to fetch', code: '' } });
    }
    assert.equal(params.p_request_id, receipt);
    return Promise.resolve({ data: structuredClone(a.server()), error: null });
  });
  await assert.rejects(a.w.InventoryCloud.mutate('adjust_stock', { materialId: 1, amount: -1, reason: '維修使用', note: '' }), /尚未確認/);
  await a.w.InventoryCloud.refresh(); assert.equal(a.w.InventoryCloud.status().pending.length, 1);
  assert(!a.w.InventoryCloud.canWrite()); await assert.rejects(a.w.InventoryCloud.mutate('add_location', {}), /只能查看/);
  const baseline = structuredClone(a.server()); a.click('#cloudRetryButton'); await tick();
  assert.equal(a.w.InventoryCloud.status().pending.length, 0); assert.equal(a.q('.stock-number').textContent, '11');
  assert.deepEqual(a.server(), baseline); a.assertLegacy(); a.w.close();
});

test('Adjustment preview validates direct quantity, cancels safely, and submits reason-aligned cloud changes', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]');
  assert.equal(a.q('#modalTitle').textContent, '手機材料');
  assert.equal(a.q('#adjustmentBefore').textContent, '12');
  assert.equal(a.q('#adjustmentAfter').textContent, '11');
  assert.equal(a.q('#confirmAdjustment').textContent, '確認領用 1 個');
  assert.equal(a.q('#accountControl').parentElement.className, 'window-tools');
  assert(!a.q('#modal').contains(a.q('#accountControl')), 'Account controls remain on the main page');
  assert.equal(a.q('#adjustmentClose').getAttribute('aria-label'), '關閉視窗，取消本次異動');
  assert.equal(a.q('.app-shell').inert, true);
  assert.equal(a.w.document.activeElement.id, 'adjustmentBack', 'Opening must not summon the input keyboard');
  a.change('#stepValue', '3', 'input'); a.change('#noteInput', '315');
  assert.equal(a.q('#adjustmentAfter').textContent, '9');
  a.click('#adjustmentClose');
  assert(a.q('#modal').classList.contains('hidden'));
  assert.equal(a.server().materials[0].stock, 12);
  assert.equal(a.q('#accountControl').parentElement.className, 'window-tools');
  assert.equal(a.q('.app-shell').inert, false);
  assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  a.click('[data-action="minus"]');
  for (const value of ['', '0', '-1', '1.5', 'abc', '1e2', '2147483648', '13']) {
    a.change('#stepValue', value, 'input');
    assert(a.q('#confirmAdjustment').disabled, value);
    assert.equal(a.q('#adjustmentAfter').textContent, '待確認');
    a.q('#adjustmentForm').dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true }));
    assert(!a.calls.some(call => call.name === 'warehouse_mutate'), value);
  }
  a.change('#stepValue', '13', 'input'); a.change('#reasonSelect', '入庫補貨');
  assert.equal(a.q('#adjustmentQuantityLabel').textContent, '補貨數量');
  assert.equal(a.q('#adjustmentAfter').textContent, '25');
  assert(!a.q('#confirmAdjustment').disabled);
  a.change('#stepValue', '3', 'input'); a.change('#noteInput', '315');
  a.click('#confirmAdjustment'); await tick();
  const request = a.calls.find(call => call.name === 'warehouse_mutate');
  assert.equal(request.params.p_payload.amount, 3);
  assert.equal(request.params.p_payload.reason, '入庫補貨');
  assert.equal(request.params.p_payload.note, '315');
  assert.equal(a.server().materials[0].stock, 15);
  a.click('[data-action="plus"]'); a.change('#reasonSelect', '維修使用');
  a.change('#stepValue', '2', 'input'); a.click('#confirmAdjustment'); await tick();
  const deduction = a.calls.filter(call => call.name === 'warehouse_mutate').at(-1);
  assert.equal(deduction.params.p_payload.amount, -2);
  assert.equal(deduction.params.p_payload.reason, '維修使用');
  assert.equal(deduction.params.p_payload.note, '', 'Notes stay optional');
  assert.equal(a.server().materials[0].stock, 13);
  a.assertLegacy(); a.w.close();
});

test('Open adjustment revalidates the latest snapshot, empty units, unset alert, zero stock and stock overflow', async () => {
  const a = setup(); await tick();
  a.click('[data-action="minus"]'); a.change('#stepValue', '10', 'input');
  a.server().materials[0].stock = 4; await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#adjustmentBefore').textContent, '4');
  assert(a.q('#confirmAdjustment').disabled, 'Cannot use the stock captured when the modal was opened');
  assert.match(a.q('#adjustmentError').textContent, /4 個/);
  a.server().materials[0].spec = '／'; a.server().materials[0].alert = null;
  a.server().materials[0].stock = 0; await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#adjustmentThreshold').textContent, '尚未設定警戒值');
  assert([...a.w.document.querySelectorAll('.adjustment-unit')].every(element => element.textContent === ''));
  a.change('#reasonSelect', '入庫補貨'); a.change('#stepValue', '1', 'input');
  assert.equal(a.q('#adjustmentAfter').textContent, '1'); assert(!a.q('#confirmAdjustment').disabled);
  a.click('#increaseStep'); assert.equal(a.q('#stepValue').value, '2');
  a.click('#decreaseStep'); assert.equal(a.q('#stepValue').value, '1'); assert(a.q('#decreaseStep').disabled);
  a.server().materials[0].stock = 2147483647; await a.w.InventoryCloud.refresh();
  assert(a.q('#confirmAdjustment').disabled); assert.match(a.q('#adjustmentError').textContent, /過大/);
  a.change('#reasonSelect', '維修使用'); assert(!a.q('#confirmAdjustment').disabled);
  a.server().materials = []; await a.w.InventoryCloud.refresh();
  assert(a.q('#confirmAdjustment').disabled); assert.match(a.q('#adjustmentError').textContent, /移除/);
  a.assertLegacy(); a.w.close();
});

test('Adjustment X closes consumption and restocking drafts without writes, resets drafts, and preserves account controls', async () => {
  const a = setup(); await tick();
  const originalAccountParent = a.q('#accountControl').parentElement;
  for (const action of ['minus', 'plus']) {
    const selector = `[data-action="${action}"]`;
    const trigger = a.q(selector);
    trigger.focus(); a.click(selector);
    assert.equal(a.q('#stepValue').value, '1');
    assert.equal(a.q('#noteInput').value, '');
    a.change('#stepValue', '3', 'input'); a.change('#noteInput', '315');
    a.click('#adjustmentClose'); await tick();
    assert(a.q('#modal').classList.contains('hidden'));
    assert.equal(a.q('.app-shell').inert, false);
    assert(!a.w.document.body.classList.contains('adjustment-open'));
    assert.equal(a.w.document.activeElement, trigger);
    assert.equal(a.q('#accountControl').parentElement, originalAccountParent);
    assert.equal(a.server().materials[0].stock, 12);
    assert.equal(a.server().transactions.length, 0);
  }
  a.click('[data-action="minus"]');
  a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(a.q('#modal').classList.contains('hidden'), 'Escape still closes the modal');
  a.click('#accountButton'); assert(!a.q('#accountPopover').classList.contains('hidden'));
  a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(a.q('#accountPopover').classList.contains('hidden'), 'Main page account menu still works');
  assert(!a.calls.some(call => call.name === 'warehouse_mutate'));
  a.assertLegacy(); a.w.close();
});

test('Adjustment submission locks its draft until server confirmation and auth revocation clears it', async () => {
  const a = setup(); await tick();
  let response;
  a.handler((name) => name === 'warehouse_snapshot'
    ? Promise.resolve({ data: structuredClone(a.server()), error: null })
    : new Promise(resolve => { response = resolve; }));
  a.click('[data-action="minus"]'); a.click('#confirmAdjustment');
  for (const id of ['stepValue', 'noteInput', 'reasonSelect', 'decreaseStep', 'increaseStep', 'adjustmentBack', 'adjustmentClose', 'confirmAdjustment']) assert(a.q(`#${id}`).disabled, id);
  a.click('#adjustmentClose'); assert(!a.q('#modal').classList.contains('hidden'));
  a.click('#adjustmentBack'); assert(!a.q('#modal').classList.contains('hidden'));
  a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!a.q('#modal').classList.contains('hidden'));
  a.callback(null); await new Promise(resolve => setTimeout(resolve, 5));
  assert(a.q('#modal').classList.contains('hidden'), 'Revocation cannot leave old material visible');
  assert.equal(a.q('.app-shell').inert, false);
  assert.equal(a.q('#accountControl').parentElement.className, 'window-tools');
  response({ data: null, error: { message: 'session changed', code: '' } }); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  a.assertLegacy(); a.w.close();
});

test('Cloud mode preserves original device data, blocks signed-out edits, handles SDK failure', async () => {
  const a = setup({ authenticated: false }); await tick();
  assert.equal(a.q('#materialCount').textContent, '0');
  assert(a.q('#newMaterialButton').disabled);
  assert(a.q('#deleteLocationFromFilter').disabled);
  assert(a.q('#confirmDeleteLocation').disabled);
  assert(!a.q('#cloudLoginForm').classList.contains('hidden'));
  a.click('#backupDeviceButton'); assert.equal(a.downloads.length, 1); a.assertLegacy(); a.w.close();
  const b = setup({ sdk: false }); await tick();
  assert(b.q('#newMaterialButton').disabled); assert(b.q('#cloudLoginButton').disabled);
  b.click('#backupDeviceButton'); assert.equal(b.downloads.length, 1); b.assertLegacy(); b.w.close();
});

test('Email login remains compatible and username login uses Auth, not a password lookup or new access grant', async () => {
  const email = setup({ authenticated: false }); await tick();
  email.change('#cloudEmail', ' Owner@Example.Test '); email.change('#cloudPassword', ' fixture password ');
  email.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.equal(email.authCalls.length, 1);
  assert.equal(email.authCalls[0].email, 'owner@example.test');
  assert.equal(email.authCalls[0].password, ' fixture password ', 'Passwords must not be trimmed or normalized');
  assert.equal(email.q('#cloudAccount').textContent, 'owner@example.test');
  assert.equal(email.q('#cloudPassword').value, ''); email.assertLegacy(); email.w.close();

  const internalEmail = 'ntnu7@nhunrezwvfwqqappdqij.warehouse.invalid';
  const a = setup({ authenticated: false, accountSession: { user: { ...session.user, email: internalEmail } } }); await tick();
  a.server().canImport = false;
  a.change('#cloudEmail', ' NTNU7 '); a.change('#cloudPassword', 'fixture-password');
  a.q('#cloudLoginForm').requestSubmit(); a.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.equal(a.authCalls.length, 1, 'Cannot submit concurrent logins');
  assert.equal(a.authCalls[0].email, internalEmail);
  assert.equal(a.q('#cloudAccount').textContent, 'ntnu7');
  assert.equal(a.q('#cloudEmail').type, 'text', 'Native email validation must not block usernames');
  assert(a.q('#cloudLoginHelp').classList.contains('hidden'));
  assert(!a.calls.some(call => call.name === 'warehouse_mutate'), 'Login cannot import or change inventory');
  assert(a.q('#cloudImportPanel').classList.contains('hidden')); a.assertLegacy(); a.w.close();

  const restored = setup({ accountSession: { user: { ...session.user, email: internalEmail } } }); await tick();
  assert.equal(restored.q('#cloudAccount').textContent, 'ntnu7', 'Restored sessions display the same username'); restored.w.close();
});

test('Invalid usernames and broken username configuration never send credentials, while Email still works', async () => {
  const a = setup({ authenticated: false }); await tick();
  a.change('#cloudPassword', 'fixture-password');
  for (const account of ['ab', '中文帳號', 'staff 01', '-staff', '<script>', 'a'.repeat(33), 'staff@invalid', '   ']) {
    a.change('#cloudEmail', account); a.q('#cloudLoginForm').requestSubmit(); await tick();
    assert.equal(a.authCalls.length, 0, account);
    assert(!a.q('#cloudLoginButton').disabled); assert(a.q('#newMaterialButton').disabled);
  }
  a.assertLegacy(); a.w.close();
  const b = setup({ authenticated: false, configOverride: { usernameDomain: 'someone-elses-domain.example' } }); await tick();
  b.change('#cloudEmail', 'ntnu7'); b.change('#cloudPassword', 'fixture-password'); b.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.equal(b.authCalls.length, 0); assert.match(b.q('#cloudDetail').textContent, /尚未設定完成/);
  b.change('#cloudEmail', 'owner@example.test'); b.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.equal(b.authCalls.length, 1); b.assertLegacy(); b.w.close();
});

test('Username authentication failure and an unapproved username cannot reveal inventory or self-authorize', async () => {
  const a = setup({ authenticated: false, authError: { code: 'invalid_credentials', message: 'Invalid login credentials' } }); await tick();
  a.change('#cloudEmail', 'ntnu7'); a.change('#cloudPassword', 'fixture-password'); a.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.match(a.q('#cloudDetail').textContent, /帳號或密碼不正確/);
  assert.equal(a.q('#materialCount').textContent, '0'); assert.equal(a.calls.length, 0);
  for (let index = 0; index < a.w.localStorage.length; index++) {
    assert(!a.w.localStorage.getItem(a.w.localStorage.key(index)).includes('fixture-password'), 'No password copied to app storage');
  }
  a.assertLegacy(); a.w.close();
  const b = setup({ authenticated: false, accountSession: { user: { ...session.user, email: 'ntnu7@nhunrezwvfwqqappdqij.warehouse.invalid' } } }); await tick();
  b.handler(async () => ({ data: null, error: { code: '42501', message: 'WAREHOUSE_ACCESS_DENIED' } }));
  b.change('#cloudEmail', 'ntnu7'); b.change('#cloudPassword', 'fixture-password'); b.q('#cloudLoginForm').requestSubmit(); await tick();
  assert.match(b.q('#cloudStatus').textContent, /沒有使用權限/);
  assert.equal(b.q('#materialCount').textContent, '0'); assert(b.q('#newMaterialButton').disabled);
  assert(b.q('#cloudImportPanel').classList.contains('hidden'));
  assert(b.calls.every(call => call.name === 'warehouse_snapshot')); b.assertLegacy(); b.w.close();
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
  const a = setup(); await tick(); a.click('#cloudLogoutButton'); a.click('#confirmLogout'); await tick();
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
  a.click('[data-stats-mode="custom"]'); a.change('#statsStartDate', '2026-12-31'); a.change('#statsEndDate', '2026-01-01'); assert(!a.q('#statsRangeError').classList.contains('hidden'));
  a.assertLegacy(); a.w.close();
});

test('Both optional material fields can be omitted on create and edit, without inventing a unit or changing stock', async () => {
  const a = setup(); await tick();
  assert.equal(a.q('#materialCategory').required, false);
  assert.equal(a.q('#materialUnit').required, false);
  assert.match(a.q('label[for="materialCategory"]').textContent, /選填/);
  assert.match(a.q('label[for="materialUnit"]').textContent, /選填/);
  for (const [category, unit] of [['', ''], ['規格', ''], ['', '個']]) {
    a.click('#newMaterialButton');
    a.change('#materialName', `選填-${category}-${unit}`);
    a.change('#materialCategory', category); a.change('#materialUnit', unit);
    a.change('#materialStock', '3'); a.change('#materialAlert', '0');
    a.q('#materialForm').requestSubmit(); await tick();
    assert(a.q('#materialModal').classList.contains('hidden'));
    assert.equal(a.calls.filter(call => call.params?.p_operation === 'save_material').at(-1).params.p_payload.unit, unit);
  }
  a.click('[data-action="edit"]'); a.change('#materialCategory', ''); a.change('#materialUnit', '');
  a.q('#materialForm').requestSubmit(); await tick();
  assert.equal(a.server().materials[0].spec, '／'); assert.equal(a.server().materials[0].stock, 12);
  a.click('#newMaterialButton'); a.change('#materialName', ''); a.q('#materialForm').requestSubmit(); await tick();
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'save_material').length, 4, 'Name remains required');
  a.assertLegacy(); a.w.close();
});

test('Cloud locations are authoritative; empty deletion needs confirmation and preserves materials and history', async () => {
  const a = setup(); await tick();
  for (const suffix of ['Filter', 'Page']) {
    assert.equal(a.q(`#addLocationFrom${suffix}`).textContent, '增加＋');
    assert.equal(a.q(`#deleteLocationFrom${suffix}`).textContent, '刪除X');
  }
  assert(![...a.q('#locationFilter').options].some(option => option.value === '12樓西'), 'Absent default floors cannot be re-added by the client');
  a.server().locations.push('12樓東'); await a.w.InventoryCloud.refresh();
  a.change('#locationFilter', '12樓東'); a.click('#deleteLocationFromFilter');
  assert.equal(a.q('#deleteLocationSelect').value, '12樓東'); assert(!a.q('#confirmDeleteLocation').disabled);
  assert.match(a.q('#deleteLocationSummary').textContent, /不會刪除材料/);
  a.click('#deleteLocationModal [data-close-delete-location-modal]');
  assert(!a.calls.some(call => call.params?.p_operation === 'delete_location'), 'Cancel never sends a delete request');
  a.click('#deleteLocationFromFilter');
  const beforeMaterials = structuredClone(a.server().materials), beforeHistory = structuredClone(a.server().transactions);
  a.q('#deleteLocationForm').requestSubmit(); await tick();
  assert(a.q('#deleteLocationModal').classList.contains('hidden'));
  assert.equal(a.q('#locationFilter').value, '全部位置');
  assert(![...a.q('#materialLocation').options].some(option => option.value === '12樓東'));
  assert.deepEqual(a.server().materials, beforeMaterials); assert.deepEqual(a.server().transactions, beforeHistory);
  await a.w.InventoryCloud.refresh();
  assert(![...a.q('#locationFilter').options].some(option => option.value === '12樓東'), 'Deleted defaults stay deleted after syncing');
  a.click('[data-view="locations"]'); a.click('#deleteLocationFromPage');
  assert(a.q('#confirmDeleteLocation').disabled, 'All-locations mode needs an explicit selection');
  a.change('#deleteLocationSelect', '3樓315'); assert(a.q('#confirmDeleteLocation').disabled);
  assert.match(a.q('#deleteLocationSummary').textContent, /仍有 1 項材料/);
  a.server().materials[0].stock = 0; await a.w.InventoryCloud.refresh();
  assert(a.q('#confirmDeleteLocation').disabled, 'A zero-stock material still occupies its location');
  a.q('#deleteLocationForm').dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(a.calls.filter(call => call.params?.p_operation === 'delete_location').length, 1);
  a.assertLegacy(); a.w.close();
});

test('A location removed by another device never silently relocates an unsaved material', async () => {
  const a = setup(); await tick();
  a.server().locations.push('2樓201'); await a.w.InventoryCloud.refresh();
  a.click('#newMaterialButton'); a.change('#materialName', '尚未儲存材料'); a.change('#materialLocation', '2樓201');
  a.server().locations = a.server().locations.filter(name => name !== '2樓201'); await a.w.InventoryCloud.refresh();
  assert.equal(a.q('#materialLocation').value, '', 'Removed choice requires a new explicit selection');
  await a.w.InventoryCloud.refresh(); assert.equal(a.q('#materialLocation').value, '');
  a.q('#materialForm').requestSubmit(); await tick();
  assert(!a.calls.some(call => call.params?.p_operation === 'save_material'));
  a.change('#materialLocation', '3樓315'); a.q('#materialForm').requestSubmit(); await tick();
  assert.equal(a.calls.find(call => call.params?.p_operation === 'save_material').params.p_payload.location, '3樓315');
  a.assertLegacy(); a.w.close();
});

test('Location deletion handles other-device occupancy, lost responses and sign-out without unsafe local fallback', async () => {
  const a = setup(); await tick();
  a.server().locations.push('2樓201'); await a.w.InventoryCloud.refresh();
  a.change('#locationFilter', '2樓201'); a.click('#deleteLocationFromFilter');
  a.server().materials.push({ ...a.server().materials[0], id: 2, location: '2樓201' });
  a.q('#deleteLocationForm').requestSubmit(); await tick();
  assert.match(a.q('#toast').textContent, /仍有材料/); assert(a.server().locations.includes('2樓201'));
  assert(a.q('#deleteLocationModal').classList.contains('hidden') === false);
  await a.w.InventoryCloud.refresh(); assert(a.q('#confirmDeleteLocation').disabled);
  a.callback(null); await new Promise(resolve => setTimeout(resolve, 5));
  assert(a.q('#deleteLocationModal').classList.contains('hidden')); assert(a.q('#deleteLocationFromFilter').disabled);
  a.assertLegacy(); a.w.close();

  const b = setup(); await tick();
  b.server().locations.push('2樓201'); await b.w.InventoryCloud.refresh();
  b.change('#locationFilter', '2樓201'); b.click('#deleteLocationFromFilter');
  b.handler(async (name, params) => {
    if (name === 'warehouse_mutate') { b.server().locations = b.server().locations.filter(name => name !== params.p_payload.name); b.server().revision++; return { data: null, error: { message: 'Failed to fetch', code: '' } }; }
    return { data: structuredClone(b.server()), error: null };
  });
  b.q('#deleteLocationForm').requestSubmit(); await tick();
  const request = b.calls.find(call => call.params?.p_operation === 'delete_location');
  assert(b.q('#confirmDeleteLocation').disabled); assert(b.q('#deleteLocationFromFilter').disabled);
  b.handler(async () => ({ data: structuredClone(b.server()), error: null }));
  b.click('#cloudRetryButton'); await tick();
  assert.equal(b.calls.filter(call => call.params?.p_operation === 'delete_location').at(-1).params.p_request_id, request.params.p_request_id);
  assert(b.q('#deleteLocationModal').classList.contains('hidden'));
  assert.equal(b.q('#locationFilter').value, '全部位置'); b.assertLegacy(); b.w.close();
});

test('Local-only preview allows empty optional fields and retains removed defaults across reloads', async () => {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8890/preview/', runScripts: 'outside-only' });
  const w = dom.window; w.INVENTORY_CLOUD_CONFIG = { enabled: false }; w.eval(app);
  const q = selector => w.document.querySelector(selector);
  q('#newMaterialButton').click(); q('#materialName').value = '本機選填材料'; q('#materialStock').value = '3'; q('#materialAlert').value = '0';
  assert.equal(q('#materialLocation').value, '12樓東');
  q('#materialLocation').value = '12樓西'; // Keep the following empty-location deletion fixture empty.
  q('#materialForm').requestSubmit();
  assert.equal(JSON.parse(w.localStorage.getItem('inventory-materials')).find(item => item.name === '本機選填材料').spec, '／');
  q('#locationFilter').value = '12樓東'; q('#deleteLocationFromFilter').click(); q('#deleteLocationForm').requestSubmit();
  assert(![...q('#locationFilter').options].some(option => option.value === '12樓東'));
  const reload = new JSDOM(html, { url: 'http://127.0.0.1:8890/preview/', runScripts: 'outside-only' });
  for (let i = 0; i < w.localStorage.length; i++) { const key = w.localStorage.key(i); reload.window.localStorage.setItem(key, w.localStorage.getItem(key)); }
  reload.window.INVENTORY_CLOUD_CONFIG = { enabled: false }; reload.window.eval(app);
  const doc = reload.window.document;
  assert(![...doc.querySelector('#locationFilter').options].some(option => option.value === '12樓東'));
  doc.querySelector('#addLocationFromFilter').click(); doc.querySelector('#newLocationName').value = '12樓東'; doc.querySelector('#locationForm').requestSubmit();
  assert([...doc.querySelector('#locationFilter').options].some(option => option.value === '12樓東'));
  dom.window.close(); reload.window.close();
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
