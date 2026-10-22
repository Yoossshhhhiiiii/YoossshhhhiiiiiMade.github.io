const LOCATIONS = ['全部位置', '12樓西', '12樓東', '11樓西', '11樓東', '10樓西', '10樓東', '9樓西', '9樓東', '8樓西', '8樓東', '7樓西', '7樓東', '6樓西', '6樓東', '5樓西', '5樓東', '4樓西', '4樓東', '3樓西', '3樓東', '2樓西', '2樓東', '1樓'];
const seed = [
  { id: 1, name: 'PVC 管 2 吋', spec: '給水管材／支', stock: 35, alert: 10, location: '12樓西', detail: 'A-03貨架／第2層' },
  { id: 2, name: '單芯電線 2.0mm', spec: '電線電纜／捲', stock: 8, alert: 10, location: '11樓東', detail: 'B-01貨架／第1層' },
  { id: 3, name: '不鏽鋼水龍頭', spec: '衛浴設備／個', stock: 24, alert: 6, location: '8樓西', detail: 'C-02貨架／第3層' },
  { id: 4, name: '無熔絲開關 20A', spec: '電氣材料／個', stock: 12, alert: 5, location: '7樓東', detail: 'D-05櫃／第2層' },
  { id: 5, name: 'PVC 彎頭 2 吋', spec: '管件／個', stock: 4, alert: 8, location: '12樓西', detail: 'A-03貨架／第3層' },
  { id: 6, name: '止水帶', spec: '施工耗材／卷', stock: 2, alert: 5, location: '1樓', detail: '入口工具櫃／左側' }
];

// 照片清單未標示的單位、分類與警戒值，保持待設定，不自行推定。
const firstFloorImport = [
  ['盲蓋', 100],
  ['14吋排壁扇', 30],
  ['馬桶水箱配件', 20],
  ['浴室排風扇', 20],
  ['蓮蓬頭', 100],
  ['單切開關', 100],
  ['5mm隔板粒', 100],
  ['PVC天花板', 200],
  ['拉桿落水頭延伸管', 20],
  ['快乾水泥', 10],
  ['華司', 500],
  ['十字螺絲', 500],
  ['螺母', 500],
  ['單孔三插座組', 42],
  ['雙孔三插座組', 41],
  ['單切開關組', 20],
  ['專業工具組合工具箱', 1],
  ['T8燈腳座（含線）', 30],
  ['白光T8 2尺燈管', 100],
  ['變壓器', 30],
  ['AB膠', 10],
  ['浴室用混水龍頭', 18],
  ['附鐵架燈頭', 24],
  ['4分不鏽鋼自攻螺絲', 100, '支'],
  ['1英吋不鏽鋼自攻螺絲', 110, '支'],
  ['1.5英吋不鏽鋼自攻螺絲', 100, '支'],
  ['圓形喇叭鎖', 50],
  ['浴室喇叭鎖', 45],
  ['4分P管組', 10],
  ['LED T8 4尺', 28],
  ['LED T5 2尺連結燈', 31],
  ['LED T5 2尺連結燈（含開關）', 37],
  ['LED T5 4尺20W支架燈', 29],
  ['電鍋', 5],
  ['電磁爐', 6],
  ['烤箱', 8],
  ['微波爐', 8]
];
const firstFloorImportKey = 'inventory-first-floor-photo-import-2026-09-29-v1';

const cloudEnabled = window.INVENTORY_CLOUD_CONFIG?.enabled === true ||
  (window.INVENTORY_CLOUD_CONFIG == null && document.documentElement.dataset.storageMode === 'cloud');
const storedMaterials = localStorage.getItem('inventory-materials');
let materials = cloudEnabled ? [] : storedMaterials ? JSON.parse(storedMaterials) : seed;
let transactions = cloudEnabled ? [] : JSON.parse(localStorage.getItem('inventory-transactions') || '[]');
let archivedMaterials = cloudEnabled ? [] : JSON.parse(localStorage.getItem('inventory-archived-materials') || '[]');
let customLocations = cloudEnabled ? [] : JSON.parse(localStorage.getItem('inventory-locations') || '[]');
let removedLocations = cloudEnabled ? [] : JSON.parse(localStorage.getItem('inventory-deleted-locations') || '[]');
let activeMaterial = null;
let editingMaterialId = null;
let editingMaterialVersion = null;
let deletingMaterial = null;
let locationReturnToMaterial = false;
let locationReturnView = 'home';
let deleteLocationReturnButton = 'deleteLocationFromFilter';
let step = 1;
let adjustmentSubmitting = false;
let adjustmentReturnButton = null;
let editingTransactionKey = null;
let editingTransactionVersion = null;
let transactionEditSubmitting = false;
let transactionEditingAvailable = !cloudEnabled;
let statsMode = 'month';
let statsCustomRange = null;
const STATS_TRANSACTIONS_PER_PAGE = 5;
let statsTransactionsPage = 1;
let statsTransactionsRange = '';
const MATERIALS_PER_PAGE = 5;
let materialPage = 1;
let lowStockOnly = false;
const $ = id => document.getElementById(id);

function save() {
  if (cloudEnabled) throw new Error('雲端模式不可改寫裝置舊資料');
  localStorage.setItem('inventory-materials', JSON.stringify(materials));
  localStorage.setItem('inventory-transactions', JSON.stringify(transactions));
  localStorage.setItem('inventory-archived-materials', JSON.stringify(archivedMaterials));
}

function importFirstFloorMaterials() {
  if (localStorage.getItem(firstFloorImportKey)) return;

  const stopTape = materials.find(item => item.name === '止水帶' && item.location === '1樓');
  let nextId = Math.max(0, ...materials.map(item => item.id)) + 1;
  if (stopTape) stopTape.stock = 2;
  else materials.push({ id: nextId++, name: '止水帶', spec: '施工耗材／卷', stock: 2, alert: 5, location: '1樓', detail: '' });

  for (const [name, stock, unit = ''] of firstFloorImport) {
    if (materials.some(item => item.name.trim().toLowerCase() === name.toLowerCase() && item.location === '1樓')) continue;
    materials.push({ id: nextId++, name, spec: `／${unit}`, stock, alert: null, location: '1樓', detail: '' });
  }
  save();
  localStorage.setItem(firstFloorImportKey, 'done');
}

if (!cloudEnabled) importFirstFloorMaterials();

function canModifyInventory() {
  return !cloudEnabled || !!window.InventoryCloud?.canWrite();
}

function renderAccessControls() {
  const disabled = !canModifyInventory();
  const readOnly = cloudEnabled && window.InventoryCloud?.status().snapshot?.canWrite === false;
  if (readOnly && !window.InventoryCloud?.status().busy) {
    closeTransactionEdit(true); closeAdjustment(true); closeMaterialForm(true);
    $('locationModal').classList.add('hidden'); locationReturnToMaterial = false;
    $('deleteLocationModal').classList.add('hidden');
  }
  for (const id of ['newMaterialButton', 'addLocationFromPage', 'addLocationFromFilter', 'addLocationFromForm', 'deleteLocationFromFilter', 'deleteLocationFromPage']) {
    $(id).classList.toggle('hidden', readOnly);
  }
  for (const id of ['newMaterialButton', 'addLocationFromPage', 'addLocationFromFilter', 'addLocationFromForm', 'saveMaterialButton', 'confirmAdjustment', 'saveLocationButton']) {
    if ($(id)) $(id).disabled = disabled;
  }
  for (const id of ['deleteLocationFromFilter', 'deleteLocationFromPage']) {
    $(id).disabled = disabled || allLocations().length === 0;
  }
  $('deleteLocationSelect').disabled = disabled;
  $('deleteMaterialButton').disabled = disabled || !editingMaterialId;
  $('confirmDeleteMaterial').disabled = disabled || !deletingMaterial;
  for (const control of document.querySelectorAll('[data-cancel-delete-material]')) control.disabled = !!window.InventoryCloud?.status().busy;
  renderDeleteLocationState();
  if (activeMaterial) renderAdjustment();
  if (editingTransactionKey) renderTransactionEdit();
  document.querySelectorAll('#todayTransactions [data-edit-transaction]').forEach(button => {
    button.disabled = disabled || !transactionEditingAvailable || !materials.some(item => String(item.id) === button.dataset.materialId);
    button.classList.toggle('hidden', readOnly);
  });
  document.querySelectorAll('#materialList [data-action]').forEach(button => { button.disabled = disabled; button.classList.toggle('hidden', readOnly); });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function isLow(item) { return item.alert !== null && item.alert !== undefined && item.stock <= item.alert; }
function unitOf(item) { return item.spec.split('／')[1] || ''; }
function displaySpec(item) {
  const [category, unit] = item.spec.split('／');
  return `${category || '分類待設定'}／${unit || '單位待設定'}`;
}
function formatNumber(number) { return new Intl.NumberFormat('zh-TW').format(number); }
function localMonth(date = new Date()) { return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function localDateKey(date = new Date()) {
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function transactionMaterial(record) {
  const item = materials.find(candidate => candidate.id === record.materialId);
  return { name: record.materialName || item?.name || `材料 #${record.materialId}`, unit: record.unit ?? (item ? unitOf(item) : '') };
}

function transactionKey(record) {
  return record.id ? String(record.id) : `local-${transactions.indexOf(record)}`;
}

function transactionCard(record, editable = false) {
  const { name, unit } = transactionMaterial(record);
  const date = new Date(record.time);
  const time = Number.isNaN(date.getTime()) ? '日期不明' : new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
  const adding = record.type === '增加';
  const amount = `<span class="transaction-amount ${adding ? 'added' : 'used'}">${adding ? '＋' : '−'}${formatNumber(record.amount)}${unit ? ` ${escapeHTML(unit)}` : ''}</span>`;
  const edit = editable ? `<button class="edit-button transaction-edit-button" type="button" data-edit-transaction="${escapeHTML(transactionKey(record))}" data-material-id="${record.materialId}" aria-label="編輯 ${escapeHTML(name)} ${escapeHTML(time)} 異動紀錄" title="${!transactionEditingAvailable ? '雲端更正功能尚未啟用' : !materials.some(item => item.id === record.materialId) ? '材料已封存，不能更正庫存' : '更正這筆異動的數量、原因與備註'}" ${!canModifyInventory() || !transactionEditingAvailable || !materials.some(item => item.id === record.materialId) ? 'disabled' : ''}>編輯</button>` : '';
  return `
    <article class="transaction-card ${editable ? 'transaction-card-editable' : ''}">
      <div class="transaction-content">
      <div class="transaction-main">
        <div><span class="transaction-time">${escapeHTML(time)}</span><strong>${escapeHTML(name)}</strong></div>
        ${editable ? '' : `<div class="transaction-tools">${amount}</div>`}
      </div>
      <div class="transaction-meta">異動：${adding ? '增加庫存' : '減少庫存'} · 原因：${escapeHTML(record.reason || '未填寫')}</div>
      <div class="transaction-note">備註：${escapeHTML(record.note || '無')}</div>
      </div>
      ${editable ? `${edit}${amount}` : ''}
      ${transactionHistory(record)}
    </article>`;
}

function transactionHistory(record) {
  if (!Array.isArray(record.editHistory) || !record.editHistory.length) return '';
  const amountText = value => `${value.type === '增加' ? '增加' : '減少'} ${formatNumber(value.amount)}${record.unit ? ` ${record.unit}` : ''}`;
  return `<details class="transaction-history" data-history-key="${escapeHTML(transactionKey(record))}"><summary>已修正 ${record.editHistory.length} 次 · 查看修正紀錄</summary>${record.editHistory.map(edit => `<div class="transaction-history-entry"><p>${escapeHTML(new Date(edit.time).toLocaleString('zh-TW'))}</p><p>${escapeHTML(amountText(edit.before))} → ${escapeHTML(amountText(edit.after))}；${escapeHTML(edit.before.reason)} → ${escapeHTML(edit.after.reason)}</p><p>備註：${escapeHTML(edit.before.note || '無')} → ${escapeHTML(edit.after.note || '無')}</p></div>`).join('')}</details>`;
}

function renderTransactionList(id, html) {
  const list = $(id);
  const open = new Set([...list.querySelectorAll('details[open][data-history-key]')].map(detail => detail.dataset.historyKey));
  list.innerHTML = html;
  list.querySelectorAll('[data-history-key]').forEach(detail => { detail.open = open.has(detail.dataset.historyKey); });
}

function transactionsInRange(start, end) {
  return transactions.filter(record => {
    const day = localDateKey(new Date(record.time));
    return day && day >= start && day <= end;
  }).slice().sort((a, b) => new Date(b.time) - new Date(a.time));
}

function renderToday() {
  const now = new Date();
  const today = localDateKey(now);
  const records = transactionsInRange(today, today);
  $('todayDate').textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  $('todaySummary').textContent = records.length ? `今天共有 ${records.length} 筆庫存異動` : '今天尚無庫存異動';
  renderTransactionList('todayTransactions', records.length
    ? records.map(record => transactionCard(record, true)).join('')
    : '<p class="activity-empty">新增或減少材料後，異動紀錄會顯示在這裡。</p>');
}

const locationCollator = new Intl.Collator('zh-Hant', { numeric: true });

function locationRank(name) {
  const floor = /^(\d+)樓(.*)$/.exec(name);
  if (floor) return { floor: Number(floor[1]), side: floor[2] === '東' ? 0 : floor[2] === '西' ? 1 : floor[2] === '' ? 2 : 3 };
  const basement = /^B(\d+)/i.exec(name);
  return basement ? { floor: -Number(basement[1]), side: 0 } : { floor: -Infinity, side: 0 };
}

function compareLocations(a, b) {
  const left = locationRank(a), right = locationRank(b);
  if (left.floor !== right.floor) return left.floor > right.floor ? -1 : 1;
  return left.side - right.side || locationCollator.compare(a, b);
}

function allLocations() {
  // Cloud is authoritative: deleted default floors must not be silently re-added.
  // Sort a display copy only; never mutate a snapshot or persist a reordered list.
  if (cloudEnabled) return customLocations.slice().sort(compareLocations);
  return [...new Set([...LOCATIONS.slice(1).filter(name => !removedLocations.includes(name)), ...customLocations, ...materials.map(item => item.location)])].filter(Boolean).sort(compareLocations);
}

function renderLocationOptions() {
  const selectedFilter = $('locationFilter').value || '全部位置';
  const selectedMaterial = $('materialLocation').value;
  const selectedDelete = $('deleteLocationSelect').value;
  const locations = allLocations();
  $('locationFilter').replaceChildren(...['全部位置', ...locations].map(location => new Option(location, location)));
  $('materialLocation').replaceChildren(...locations.map(location => new Option(location, location)));
  $('locationFilter').value = locations.includes(selectedFilter) ? selectedFilter : '全部位置';
  $('materialLocation').value = locations.includes(selectedMaterial) ? selectedMaterial
    : $('materialModal').classList.contains('hidden') ? locations[0] || '' : '';
  $('deleteLocationSelect').replaceChildren(new Option('請選擇位置', ''), ...locations.map(name => new Option(`${name}（${materials.filter(item => item.location === name).length} 項材料）`, name)));
  $('deleteLocationSelect').value = locations.includes(selectedDelete) ? selectedDelete : '';
  renderDeleteLocationState();
}

function renderWarehouseLocations() {
  const target = $('warehouseLocations');
  if (!target) return;
  target.innerHTML = allLocations().map(location => `
    <button class="location-card" type="button" data-location="${escapeHTML(location)}">
      <svg class="icon" aria-hidden="true"><use href="#icon-pin" /></svg>
      <span>${escapeHTML(location)}</span><small>${materials.filter(item => item.location === location).length} 項</small>
    </button>`).join('');
}

function setView(view = 'home') {
  const headings = {
    home: ['倉庫，一目了然。', '找到材料，記錄每一次進出。'],
    materials: ['每一件，都有位置。', '搜尋材料，快速確認庫存與存放位置。'],
    stats: ['每次使用，都有跡可循。', '選擇月份、周或日期區間，查看材料、原因與備註。'],
    locations: ['找到對的位置。', '從樓層到倉庫，整理每個存放位置。']
  };
  if (!headings[view]) return;
  document.querySelector('.app-shell').dataset.view = view;
  $('pageTitle').textContent = headings[view][0];
  $('pageSubtitle').textContent = headings[view][1];
  $('summaryPanel').classList.toggle('hidden', view === 'locations');
  $('inventoryPanel').classList.toggle('hidden', view !== 'home' && view !== 'materials');
  $('todayPanel').classList.toggle('hidden', view !== 'home');
  $('statsPanel').classList.toggle('hidden', view !== 'stats');
  $('locationsPanel').classList.toggle('hidden', view !== 'locations');
  document.querySelectorAll('.nav-button[data-view]').forEach(button => {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function toggleLowStock(force) {
  lowStockOnly = typeof force === 'boolean' ? force : !lowStockOnly;
  setView('materials');
  resetMaterialPage();
}

function scrollBehavior() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
}

function render() {
  const term = $('searchInput').value.trim().toLowerCase();
  const location = $('locationFilter').value;
  const filtered = materials.filter(item =>
    (!term || `${item.name} ${item.spec} ${item.detail || ''}`.toLowerCase().includes(term)) &&
    (location === '全部位置' || item.location === location) &&
    (!lowStockOnly || isLow(item))
  );
  const paginated = location === '全部位置';
  const pageCount = paginated ? Math.max(1, Math.ceil(filtered.length / MATERIALS_PER_PAGE)) : 1;
  materialPage = Math.min(Math.max(1, materialPage), pageCount);
  const visibleMaterials = paginated
    ? filtered.slice((materialPage - 1) * MATERIALS_PER_PAGE, materialPage * MATERIALS_PER_PAGE)
    : filtered;
  const month = localMonth();
  const used = transactions.filter(record => record.type === '減少' && localMonth(new Date(record.time)) === month)
    .reduce((total, record) => total + record.amount, 0);

  $('materialCount').textContent = materials.length;
  $('lowStockCount').textContent = materials.filter(isLow).length;
  if ($('sidebarLowCount')) $('sidebarLowCount').textContent = materials.filter(isLow).length;
  if ($('filteredMaterialCount')) $('filteredMaterialCount').textContent = `共 ${filtered.length} 項${lowStockOnly ? '待補貨' : ''}`;
  $('lowStockToggle')?.setAttribute?.('aria-pressed', String(lowStockOnly));
  $('monthlyUsage').textContent = formatNumber(used);
  $('locationNote').textContent = location === '全部位置' ? '目前顯示全部倉庫位置' : `目前位置：${location}`;
  $('materialList').innerHTML = filtered.length ? visibleMaterials.map(item => `
    <article class="material-card ${isLow(item) ? 'low' : ''}">
      <div class="material-info">
        <div class="material-heading"><div class="material-name">${escapeHTML(item.name)}</div><button class="edit-button" type="button" data-action="edit" data-id="${item.id}" aria-label="編輯 ${escapeHTML(item.name)} 資料">編輯</button></div>
        <div class="material-meta"><span class="material-place">${escapeHTML(item.location)}${item.detail ? ` · ${escapeHTML(item.detail)}` : ''}</span><span class="material-spec">${escapeHTML(displaySpec(item))}${item.alert == null ? ' · 警戒值待設定' : ''}</span></div>
      </div>
      <div class="stock-info"><span class="stock-number ${isLow(item) ? 'low' : ''}">${formatNumber(item.stock)}</span><span class="stock-unit">${escapeHTML(unitOf(item))}</span></div>
      <span class="material-state ${isLow(item) ? 'low' : ''}">${isLow(item) ? '需補貨' : item.alert == null ? '未設警戒' : '充足'}</span>
      <div class="material-actions"><button class="round-button minus" type="button" data-action="minus" data-id="${item.id}" aria-label="減少 ${escapeHTML(item.name)} 庫存">−</button><button class="round-button" type="button" data-action="plus" data-id="${item.id}" aria-label="增加 ${escapeHTML(item.name)} 庫存">＋</button></div>
    </article>`).join('') : '<div class="material-empty">找不到符合條件的材料。</div>';
  $('materialPagination').classList.toggle('hidden', !paginated || pageCount === 1);
  $('materialPageStatus').textContent = `第 ${materialPage}／${pageCount} 頁 · 共 ${filtered.length} 項`;
  $('previousMaterialsPage').disabled = materialPage === 1;
  $('nextMaterialsPage').disabled = materialPage === pageCount;
  renderToday();
  renderStats();
  renderWarehouseLocations();
  renderAccessControls();
}

function resetMaterialPage() {
  materialPage = 1;
  render();
}

function changeMaterialPage(delta) {
  materialPage += delta;
  render();
  $('materialList').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

function statsDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function statsPeriodRange(mode, value) {
  if (mode === 'month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) return null;
    const start = statsDate(`${value}-01`);
    if (!start) return null;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1, 0);
    return { start: localDateKey(start), end: localDateKey(end) };
  }
  if (mode === 'week') {
    const start = statsDate(value);
    if (!start) return null;
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    if (start.getFullYear() < 1 || end.getFullYear() > 9999) return null;
    return { start: localDateKey(start), end: localDateKey(end) };
  }
  return null;
}

function shiftedStatsValue(delta) {
  const value = statsMode === 'month' ? $('statsMonthInput').value : $('statsWeekInput').value;
  const range = statsPeriodRange(statsMode, value);
  if (!range) return '';
  const date = statsDate(range.start);
  if (statsMode === 'month') date.setMonth(date.getMonth() + delta);
  else if (statsMode === 'week') date.setDate(date.getDate() + delta * 7);
  else return '';
  const next = statsMode === 'month' ? localMonth(date) : localDateKey(date);
  return statsPeriodRange(statsMode, next) ? next : '';
}

function applyStatsPeriod() {
  const range = statsMode === 'custom' ? statsCustomRange
    : statsPeriodRange(statsMode, statsMode === 'month' ? $('statsMonthInput').value : $('statsWeekInput').value);
  $('statsStartDate').value = range?.start || '';
  $('statsEndDate').value = range?.end || '';
  statsTransactionsPage = 1;
  renderStats();
}

function chooseStatsMode(mode) {
  if (!['month', 'week', 'custom'].includes(mode)) return;
  if (statsMode === 'custom') statsCustomRange = { start: $('statsStartDate').value, end: $('statsEndDate').value };
  statsMode = mode;
  applyStatsPeriod();
}

function shiftStatsPeriod(delta) {
  const value = shiftedStatsValue(delta);
  if (!value) return;
  $(statsMode === 'month' ? 'statsMonthInput' : 'statsWeekInput').value = value;
  applyStatsPeriod();
}

function currentStatsPeriod() {
  if (statsMode === 'month') $('statsMonthInput').value = localMonth();
  else if (statsMode === 'week') $('statsWeekInput').value = localDateKey();
  else return;
  applyStatsPeriod();
}

function changeStatsTransactionsPage(delta) {
  statsTransactionsPage += delta;
  renderStats();
  $('rangeTransactions').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

function renderStats() {
  const start = $('statsStartDate').value;
  const end = $('statsEndDate').value;
  const invalid = !statsDate(start) || !statsDate(end) || start > end;
  const rangeKey = `${statsMode}:${start}:${end}`;
  if (rangeKey !== statsTransactionsRange) statsTransactionsPage = 1;
  statsTransactionsRange = rangeKey;
  $('statsHeading').textContent = statsMode === 'month' ? '月統計' : statsMode === 'week' ? '周統計' : '日期區間統計';
  document.querySelectorAll('[data-stats-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.statsMode === statsMode)));
  $('statsMonthFields').classList.toggle('hidden', statsMode !== 'month');
  $('statsWeekFields').classList.toggle('hidden', statsMode !== 'week');
  $('statsCustomFields').classList.toggle('hidden', statsMode !== 'custom');
  $('statsPeriodControls').classList.toggle('hidden', statsMode === 'custom');
  $('statsPeriodNavigation').classList.toggle('hidden', statsMode === 'custom');
  $('statsPreviousPeriod').textContent = statsMode === 'week' ? '上一周' : '上一月';
  $('statsNextPeriod').textContent = statsMode === 'week' ? '下一周' : '下一月';
  $('statsCurrentPeriod').textContent = statsMode === 'week' ? '本周' : '本月';
  $('statsPreviousPeriod').disabled = statsMode === 'custom' || !shiftedStatsValue(-1);
  $('statsNextPeriod').disabled = statsMode === 'custom' || !shiftedStatsValue(1);
  $('statsRangeError').textContent = statsMode === 'month' ? '請選擇有效的月份。' : statsMode === 'week' ? '請選擇有效日期，系統會統計該周週一至週日。' : '開始日期不能晚於結束日期，且兩個日期都要填寫。';
  $('statsPeriodLabel').textContent = invalid ? '請先選擇有效的統計區間。'
    : `${start.replaceAll('-', '/')} — ${end.replaceAll('-', '/')}${statsMode === 'week' ? '（週一至週日）' : ''}`;
  $('statsRangeError').classList.toggle('hidden', !invalid);
  const records = invalid ? [] : transactionsInRange(start, end);
  const pageCount = Math.max(1, Math.ceil(records.length / STATS_TRANSACTIONS_PER_PAGE));
  statsTransactionsPage = Math.min(Math.max(1, statsTransactionsPage), pageCount);
  const visibleRecords = records.slice((statsTransactionsPage - 1) * STATS_TRANSACTIONS_PER_PAGE, statsTransactionsPage * STATS_TRANSACTIONS_PER_PAGE);
  const used = records.filter(record => record.type === '減少');
  const restocked = records.filter(record => record.type === '增加');
  const byMaterial = new Map();
  for (const record of used) {
    const material = transactionMaterial(record);
    const entry = byMaterial.get(record.materialId) || { name: material.name, unit: material.unit, amount: 0 };
    entry.amount += record.amount;
    byMaterial.set(record.materialId, entry);
  }
  const allUsage = [...byMaterial.values()].sort((a, b) => b.amount - a.amount);
  const usage = allUsage.slice(0, 5);
  const max = Math.max(...usage.map(item => item.amount), 1);
  $('usageChart').classList.toggle('empty', !usage.length);
  $('usageChart').innerHTML = usage.length ? usage.map(item => `
    <div class="chart-item"><span>${item.amount}</span>
      <div class="bar" style="height:${Math.max(8, item.amount / max * 105)}px"></div>
      <span title="${escapeHTML(item.name)}">${escapeHTML(item.name.slice(0, 5))}</span>
    </div>`).join('') : '<p class="activity-empty">此區間尚無使用紀錄。</p>';
  $('usageBreakdown').innerHTML = allUsage.length ? allUsage.map(item => `
    <div class="usage-total"><span>${escapeHTML(item.name)}</span><strong>${formatNumber(item.amount)}${item.unit ? ` ${escapeHTML(item.unit)}` : ''}</strong></div>
  `).join('') : '<p class="activity-empty">此區間尚無材料使用。</p>';
  $('topUsed').textContent = usage[0]
    ? `${usage[0].name}（${formatNumber(usage[0].amount)}${usage[0].unit ? ` ${usage[0].unit}` : ''}）`
    : '尚無使用紀錄';
  $('rangeUsage').textContent = `${used.length} 筆`;
  $('rangeRestock').textContent = `${restocked.length} 筆`;
  $('rangeCount').textContent = `（${records.length} 筆）`;
  renderTransactionList('rangeTransactions', invalid
    ? '<p class="activity-empty">請選擇有效的開始與結束日期。</p>'
    : records.length ? visibleRecords.map(record => transactionCard(record)).join('') : '<p class="activity-empty">所選日期沒有庫存異動。</p>');
  $('statsTransactionsPagination').classList.toggle('hidden', pageCount === 1);
  $('statsTransactionsPageStatus').textContent = `第 ${statsTransactionsPage}／${pageCount} 頁 · 共 ${records.length} 筆`;
  $('previousStatsTransactionsPage').disabled = statsTransactionsPage === 1;
  $('nextStatsTransactionsPage').disabled = statsTransactionsPage === pageCount;
}

function openTransactionEdit(key) {
  if (!canModifyInventory()) return toast('請先登入並完成同步，尚未更正紀錄');
  if (!transactionEditingAvailable) return toast('雲端更正功能尚未啟用，紀錄與庫存都未更動');
  const record = transactions.find(candidate => transactionKey(candidate) === key);
  if (!record || !materials.some(item => item.id === record.materialId)) return toast('紀錄或材料已不存在，請重新同步');
  editingTransactionKey = key;
  editingTransactionVersion = record.version || 1;
  $('transactionEditQuantity').value = String(record.amount);
  $('transactionEditReason').value = record.type === '增加' ? '入庫補貨' : '維修使用';
  $('transactionEditNote').value = record.note || '';
  $('accountPopover').classList.add('hidden');
  $('accountButton').setAttribute('aria-expanded', 'false');
  $('transactionEditModal').classList.remove('hidden');
  document.querySelector('.app-shell').inert = true;
  document.body.classList.add('transaction-edit-open');
  updateTransactionEditViewport();
  renderTransactionEdit();
  $('closeTransactionEdit').focus({ preventScroll: true });
}

function closeTransactionEdit(force = false) {
  if (transactionEditSubmitting && force !== true) return;
  const key = editingTransactionKey;
  if (force === true) transactionEditSubmitting = false;
  editingTransactionKey = null;
  editingTransactionVersion = null;
  $('transactionEditModal').classList.add('hidden');
  document.body.classList.remove('transaction-edit-open');
  if ($('modal').classList.contains('hidden')) document.querySelector('.app-shell').inert = false;
  $('transactionEditForm').reset();
  for (const id of ['transactionEditMaterial', 'transactionEditLocation', 'transactionEditTime', 'transactionEditOriginal', 'transactionEditBefore', 'transactionEditAfter', 'transactionEditDelta', 'transactionEditError']) $(id).textContent = '';
  if (key) queueMicrotask(() => {
    [...document.querySelectorAll('[data-edit-transaction]')].find(button => button.dataset.editTransaction === key && !button.disabled)?.focus({ preventScroll: true });
  });
}

function validateTransactionEdit() {
  const record = transactions.find(candidate => transactionKey(candidate) === editingTransactionKey);
  const item = materials.find(candidate => candidate.id === record?.materialId);
  if (!record || !item) return { record, item, error: '這筆紀錄或材料已移除／封存，請關閉後重新同步。' };
  if (!transactionEditSubmitting && (record.version || 1) !== editingTransactionVersion) return { record, item, error: '這筆紀錄已在其他裝置更正，請關閉後重新同步再編輯。' };
  if (localDateKey(new Date(record.time)) !== localDateKey()) return { record, item, error: '這筆已不是今日紀錄，請關閉視窗。' };
  const raw = $('transactionEditQuantity').value;
  const quantity = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) return { record, item, error: '數量請填入 1 至 2,147,483,647 的整數。' };
  const reason = $('transactionEditReason').value;
  if (!['維修使用', '入庫補貨'].includes(reason)) return { record, item, error: '請選擇維修使用或入庫補貨。' };
  const note = $('transactionEditNote').value.trim();
  if (note.length > 2000) return { record, item, error: '備註最多可輸入 2000 個字。' };
  const type = reason === '入庫補貨' ? '增加' : '減少';
  const oldSigned = record.type === '增加' ? record.amount : -record.amount;
  const newSigned = type === '增加' ? quantity : -quantity;
  const delta = newSigned - oldSigned;
  const after = item.stock + delta;
  if (after < 0) return { record, item, error: '更正後庫存不足，請減少扣除的數量；尚未更正。' };
  if (after > 2147483647) return { record, item, error: '更正後庫存超出可儲存範圍；尚未更正。' };
  const unchanged = record.amount === quantity && record.type === type && record.reason === reason && (record.note || '') === note;
  return { record, item, quantity, reason, note, type, delta, after, unchanged, error: '' };
}

function renderTransactionEdit() {
  if (!editingTransactionKey) return;
  const checked = validateTransactionEdit();
  const { record, item } = checked;
  const busy = transactionEditSubmitting || !!window.InventoryCloud?.status().busy;
  const unit = record?.unit || '';
  const quantityText = amount => `${formatNumber(amount)}${unit ? ` ${unit}` : ''}`;
  $('transactionEditMaterial').textContent = record ? transactionMaterial(record).name : '紀錄已不存在';
  $('transactionEditLocation').textContent = item ? `目前位置：${item.location}${item.detail ? ` · ${item.detail}` : ''}` : '';
  $('transactionEditTime').textContent = record ? `原異動時間：${new Date(record.time).toLocaleString('zh-TW')}` : '';
  $('transactionEditOriginal').textContent = record ? `原紀錄：${record.type === '增加' ? '增加' : '減少'} ${quantityText(record.amount)} · ${record.reason || '未填寫原因'}` : '';
  $('transactionEditBefore').textContent = item ? quantityText(item.stock) : '—';
  $('transactionEditAfter').textContent = checked.error ? '待確認' : quantityText(checked.after);
  $('transactionEditDelta').textContent = checked.error ? '紀錄與庫存都未更動。' : checked.delta > 0 ? `將補回庫存 ${quantityText(checked.delta)}。` : checked.delta < 0 ? `將減少庫存 ${quantityText(-checked.delta)}。` : '庫存不變，只更正紀錄內容。';
  if (!checked.error && record?.type !== checked.type) $('transactionEditDelta').textContent += ` 原因已切換，此筆改為${checked.type === '增加' ? '入庫補貨' : '維修使用'}。`;
  $('transactionEditError').textContent = checked.error;
  $('transactionEditError').classList.toggle('hidden', !checked.error);
  $('transactionEditQuantity').setAttribute('aria-invalid', String(!!checked.error));
  for (const id of ['transactionEditQuantity', 'transactionEditReason', 'transactionEditNote']) $(id).disabled = busy;
  document.querySelectorAll('[data-close-transaction-edit]').forEach(button => { if (button.tagName === 'BUTTON') button.disabled = transactionEditSubmitting; });
  $('saveTransactionEdit').disabled = busy || !canModifyInventory() || !!checked.error || checked.unchanged;
  $('saveTransactionEdit').textContent = busy ? '正在確認…' : '確認更正';
}

function updateTransactionEditViewport() {
  const viewport = window.visualViewport;
  $('transactionEditModal').style.setProperty('--transaction-viewport-height', `${viewport?.height || window.innerHeight}px`);
  $('transactionEditModal').style.setProperty('--transaction-viewport-top', `${viewport?.offsetTop || 0}px`);
  if (editingTransactionKey && document.querySelector('.transaction-edit-body').contains(document.activeElement)) {
    requestAnimationFrame(() => document.activeElement?.scrollIntoView?.({ block: 'nearest' }));
  }
}

async function saveTransactionEdit(event) {
  event.preventDefault();
  if (!editingTransactionKey || transactionEditSubmitting || !canModifyInventory()) return;
  const checked = validateTransactionEdit();
  if (checked.error || checked.unchanged) { renderTransactionEdit(); return; }
  const { record, item, quantity, reason, note, type, delta } = checked;
  transactionEditSubmitting = true;
  renderTransactionEdit();
  try {
    if (cloudEnabled) await window.InventoryCloud.mutate('edit_transaction', { transactionId: record.id, version: editingTransactionVersion, quantity, reason, note });
    else {
      const before = { amount: record.amount, type: record.type, reason: record.reason, note: record.note || '', version: record.version || 1 };
      const after = { amount: quantity, type, reason, note, version: before.version + 1 };
      record.editHistory ||= [];
      record.editHistory.push({ time: new Date().toISOString(), before, after, stockBefore: item.stock, stockAfter: item.stock + delta });
      Object.assign(record, after);
      item.stock += delta;
      item.version = (item.version || 1) + 1;
      save();
    }
    transactionEditSubmitting = false;
    closeTransactionEdit(); render();
    toast('異動紀錄已更正，庫存與統計已同步更新');
  } catch (error) { transactionEditSubmitting = false; renderTransactionEdit(); toast(error.message); }
}

function openAdjustment(item, type) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步，尚未異動庫存');
  adjustmentReturnButton = document.activeElement;
  activeMaterial = item;
  step = 1;
  $('stepValue').value = '1';
  $('reasonSelect').value = type === '增加庫存' ? '入庫補貨' : '維修使用';
  $('noteInput').value = '';
  $('accountPopover').classList.add('hidden');
  $('accountButton').setAttribute('aria-expanded', 'false');
  $('modal').classList.remove('hidden');
  document.body.classList.add('adjustment-open');
  document.querySelector('.app-shell').inert = true;
  $('adjustmentBody').scrollTop = 0;
  updateAdjustmentViewport();
  renderAdjustment();
  $('adjustmentBack').focus({ preventScroll: true });
}

function closeAdjustment(force = false) {
  if (adjustmentSubmitting && force !== true) return;
  if (force === true) adjustmentSubmitting = false;
  const itemId = activeMaterial?.id;
  $('modal').classList.add('hidden');
  document.body.classList.remove('adjustment-open');
  document.querySelector('.app-shell').inert = false;
  activeMaterial = null;
  if (itemId != null) queueMicrotask(() => {
    const target = adjustmentReturnButton?.isConnected ? adjustmentReturnButton
      : document.querySelector(`#materialList [data-id="${Number(itemId)}"][data-action="minus"]`);
    if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
  });
}

function validateAdjustment() {
  const item = materials.find(candidate => candidate.id === activeMaterial?.id);
  if (!item) return { item: null, error: '這項材料已移除，請返回清單重新確認。' };
  const raw = $('stepValue').value;
  const quantity = Number(raw);
  const adding = $('reasonSelect').value === '入庫補貨';
  if (!['入庫補貨', '維修使用'].includes($('reasonSelect').value)) return { item, error: '請選擇異動原因。' };
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(quantity) || quantity < 1) return { item, error: '請輸入大於 0 的整數。' };
  const after = item.stock + (adding ? quantity : -quantity);
  if (quantity > 2147483647 || !Number.isSafeInteger(after) || after > 2147483647) return { item, error: '數量過大，請重新輸入。' };
  if (after < 0) return { item, quantity, adding, error: `庫存只有 ${formatNumber(item.stock)}${unitOf(item) ? ` ${unitOf(item)}` : ''}，領用數量不能超過庫存。` };
  return { item, quantity, adding, after, error: '' };
}

function renderAdjustment() {
  if (!activeMaterial) return;
  const checked = validateAdjustment();
  const item = checked.item || activeMaterial;
  if (checked.item) activeMaterial = checked.item;
  const adding = $('reasonSelect').value === '入庫補貨';
  const action = adding ? '補貨' : '領用';
  const unit = unitOf(item);
  const busy = adjustmentSubmitting || !!window.InventoryCloud?.status().busy;
  $('modalEyebrow').textContent = adding ? '入庫補貨' : '維修領用';
  $('modalTitle').textContent = item.name;
  $('modalLocation').textContent = item.location;
  $('adjustmentDetail').textContent = item.detail || '';
  $('adjustmentDetail').classList.toggle('hidden', !item.detail);
  $('adjustmentStock').textContent = formatNumber(item.stock);
  const hasAlert = item.alert !== null && item.alert !== undefined;
  $('adjustmentThreshold').textContent = hasAlert
    ? `${item.stock < item.alert ? '低於警戒值' : item.stock === item.alert ? '達到警戒值' : '警戒值'} ${formatNumber(item.alert)}${unit ? ` ${unit}` : ''}`
    : '尚未設定警戒值';
  $('adjustmentStockStatus').textContent = hasAlert ? (isLow(item) ? '數量偏低，請留意庫存。' : '目前庫存充足。') : '可在編輯材料中設定。';
  $('adjustmentQuantityLabel').textContent = `${action}數量`;
  $('stepValue').style.width = `${Math.min(7, Math.max(2, $('stepValue').value.length))}ch`;
  $('stepValue').setAttribute('aria-invalid', String(!!checked.error));
  $('adjustmentError').textContent = checked.error;
  $('adjustmentError').classList.toggle('hidden', !checked.error);
  $('adjustmentBefore').textContent = formatNumber(item.stock);
  $('adjustmentAfterLabel').textContent = `${action}後數量`;
  $('adjustmentAfter').textContent = checked.error ? '待確認' : formatNumber(checked.after);
  $('adjustmentAfter').classList.toggle('invalid-result', !!checked.error);
  document.querySelectorAll('.adjustment-unit').forEach(element => { element.textContent = unit; });
  $('adjustmentAfterUnit').classList.toggle('hidden', !!checked.error);
  $('adjustmentReasonHint').textContent = adding
    ? '已切換為增加庫存；如需維修領用，請切換為「維修使用」。'
    : '如需入庫補貨，請切換為「入庫補貨」，系統將以入庫方式處理，不會視為領用。';
  $('confirmAdjustment').textContent = busy ? '等待確認…' : `確認${action}${checked.quantity ? ` ${formatNumber(checked.quantity)}${unit ? ` ${unit}` : ''}` : ''}`;
  $('confirmAdjustment').disabled = busy || !canModifyInventory() || !!checked.error;
  $('decreaseStep').disabled = busy || Number($('stepValue').value) === 1;
  $('increaseStep').disabled = busy || Number($('stepValue').value) >= 2147483647;
  for (const id of ['stepValue', 'reasonSelect', 'noteInput']) $(id).disabled = busy;
  document.querySelectorAll('[data-close-modal]').forEach(button => { if (button.tagName === 'BUTTON') button.disabled = adjustmentSubmitting; });
  $('adjustmentSubmissionStatus').textContent = busy ? '正在確認，請勿重複送出。'
    : !canModifyInventory() ? '目前無法送出；請先確認連線或待處理操作。'
    : cloudEnabled ? '確認後由雲端更新庫存並記錄異動。' : '確認後才會更新庫存並記錄異動。';
}

function updateAdjustmentViewport() {
  updateTransactionEditViewport();
  const viewport = window.visualViewport;
  $('modal').style.setProperty('--adjustment-viewport-height', `${viewport?.height || window.innerHeight}px`);
  $('modal').style.setProperty('--adjustment-viewport-top', `${viewport?.offsetTop || 0}px`);
  if (activeMaterial && $('adjustmentBody').contains(document.activeElement)) {
    requestAnimationFrame(() => document.activeElement?.scrollIntoView?.({ block: 'nearest' }));
  }
}

function changeAdjustmentQuantity(delta) {
  const current = Number($('stepValue').value);
  step = Math.max(1, Math.min(2147483647, (Number.isSafeInteger(current) && current >= 1 ? current : 0) + delta));
  $('stepValue').value = String(step);
  renderAdjustment();
}

function openMaterialForm(item = null) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步');
  editingMaterialId = item?.id ?? null;
  editingMaterialVersion = item?.version ?? null;
  $('materialForm').reset();
  $('materialModalTitle').textContent = item ? '編輯材料資料' : '新增材料';
  $('saveMaterialButton').textContent = item ? '儲存變更' : '儲存材料';
  $('deleteMaterialButton').classList.toggle('hidden', !item);
  $('initialStockRow').classList.toggle('hidden', !!item);
  document.querySelector('.alert-only').classList.toggle('hidden', !item);
  $('materialStock').required = !item;
  $('materialAlert').required = !item;
  $('materialAlertEdit').required = !!item;
  $('materialName').value = item?.name ?? '';
  $('materialCategory').value = item?.spec.split('／')[0] ?? '';
  $('materialUnit').value = item ? unitOf(item) : '';
  $('materialStock').value = item?.stock ?? 0;
  $('materialAlert').value = item?.alert ?? 5;
  $('materialAlertEdit').value = item ? item.alert ?? '' : 5;
  $('materialLocation').value = item?.location ?? (allLocations()[0] || '');
  $('materialDetail').value = item?.detail ?? '';
  $('materialFormHint').textContent = item?.alert == null && item ? '請設定警戒值；分類／規格、單位與詳細位置可留空。庫存數量請使用 ＋ 或 − 調整。' : item ? '分類／規格、單位與詳細位置可留空；庫存數量請使用 ＋ 或 − 調整。' : '分類／規格、單位與詳細位置可留空；庫存與警戒值請填入 0 或正整數。';
  $('materialModal').classList.remove('hidden');
  renderAccessControls();
  $('materialName').focus();
}

function closeMaterialForm(force = false) {
  if (deletingMaterial && window.InventoryCloud?.status().busy && force !== true) return;
  $('deleteMaterialModal').classList.add('hidden');
  deletingMaterial = null;
  $('materialModal').classList.add('hidden');
  editingMaterialId = null;
  editingMaterialVersion = null;
}

function openDeleteMaterial() {
  if (!canModifyInventory()) return toast('請先完成同步或確認待處理操作');
  const item = materials.find(item => item.id === editingMaterialId);
  if (!item) return toast('材料已不存在，請重新同步');
  // Confirm the persisted version, not an unsaved name or a newer hidden stock value.
  if (item.version !== editingMaterialVersion) return toast('材料已在其他裝置更新，請關閉表單後重新編輯');
  deletingMaterial = { ...item };
  $('deleteMaterialName').textContent = item.name;
  $('deleteMaterialLocation').textContent = `${item.location}${item.detail ? ` · ${item.detail}` : ''}`;
  $('deleteMaterialStock').textContent = `目前庫存 ${formatNumber(item.stock)}${unitOf(item) ? ` ${unitOf(item)}` : ''}`;
  $('materialModal').classList.add('hidden');
  $('deleteMaterialModal').classList.remove('hidden');
  renderAccessControls();
  $('cancelDeleteMaterial').focus();
}

function cancelDeleteMaterial() {
  if (window.InventoryCloud?.status().busy) return;
  $('deleteMaterialModal').classList.add('hidden');
  deletingMaterial = null;
  $('materialModal').classList.remove('hidden');
  $('deleteMaterialButton').focus();
}

async function confirmDeleteMaterial() {
  if (!deletingMaterial || !canModifyInventory()) return;
  const item = deletingMaterial;
  if (cloudEnabled) {
    try { await window.InventoryCloud.mutate('archive_material', { id: item.id, version: item.version }); }
    catch (error) { return toast(error.message); }
  } else {
    archivedMaterials.push({ ...item, archivedAt: new Date().toISOString() });
    materials = materials.filter(candidate => candidate.id !== item.id);
    save();
  }
  closeMaterialForm(); resetMaterialPage();
  toast('材料已移出清單，歷史異動與統計保留');
  $('pageTitle').focus();
}

function openLocationForm(fromMaterial = false) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步');
  locationReturnToMaterial = fromMaterial;
  locationReturnView = document.querySelector('.app-shell')?.dataset.view || 'home';
  $('locationForm').reset();
  if (fromMaterial) $('materialModal').classList.add('hidden');
  $('locationModal').classList.remove('hidden');
  $('newLocationName').focus();
}

function closeLocationForm() {
  $('locationModal').classList.add('hidden');
  if (locationReturnToMaterial) {
    $('materialModal').classList.remove('hidden');
    $('materialLocation').focus();
  } else {
    setView(locationReturnView);
    $(locationReturnView === 'locations' ? 'addLocationFromPage' : 'locationFilter').focus();
  }
  locationReturnToMaterial = false;
}

async function saveLocationFromForm(event) {
  event.preventDefault();
  if (!canModifyInventory()) return toast('目前無法儲存，請先完成雲端同步');
  const name = $('newLocationName').value.trim();
  if (!name) return toast('請輸入位置名稱');
  if (allLocations().some(location => location.toLowerCase() === name.toLowerCase()) || name === '全部位置') {
    return toast('這個位置已在選單中');
  }
  const fromMaterial = locationReturnToMaterial;
  if (cloudEnabled) {
    try { await window.InventoryCloud.mutate('add_location', { name }); }
    catch (error) { return toast(error.message); }
  } else {
    customLocations.push(name);
    removedLocations = removedLocations.filter(location => location.toLowerCase() !== name.toLowerCase());
    localStorage.setItem('inventory-locations', JSON.stringify(customLocations));
    localStorage.setItem('inventory-deleted-locations', JSON.stringify(removedLocations));
  }
  renderLocationOptions();
  if (fromMaterial) $('materialLocation').value = name;
  else {
    $('locationFilter').value = name;
    lowStockOnly = false;
  }
  closeLocationForm();
  if (!fromMaterial) {
    setView('materials');
    resetMaterialPage();
  }
  toast('新位置已加入選單');
}

function renderDeleteLocationState() {
  const name = $('deleteLocationSelect').value;
  const count = materials.filter(item => item.location === name).length;
  const archivedCount = archivedMaterials.filter(item => item.location === name).length;
  $('deleteLocationSummary').textContent = !name ? '只有沒有材料的位置可以刪除。刪除後會從所有位置選單移除。'
    : count ? `「${name}」仍有 ${count} 項材料，不能刪除。請先編輯材料，將它們移到其他位置。`
    : archivedCount ? `「${name}」有 ${archivedCount} 項封存材料，為保留歷史資料，暫不能刪除此位置。`
    : `確定刪除「${name}」？此位置沒有材料；不會刪除材料、庫存或異動紀錄。需要時可重新增加同名位置。`;
  $('confirmDeleteLocation').disabled = !canModifyInventory() || !name || count > 0 || archivedCount > 0 || !allLocations().includes(name);
}

function openDeleteLocationForm(fromPage = false) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步');
  deleteLocationReturnButton = fromPage ? 'deleteLocationFromPage' : 'deleteLocationFromFilter';
  renderLocationOptions();
  const selected = $('locationFilter').value;
  $('deleteLocationSelect').value = !fromPage && allLocations().includes(selected) ? selected : '';
  renderDeleteLocationState();
  $('deleteLocationModal').classList.remove('hidden');
  $('deleteLocationSelect').focus();
}

function closeDeleteLocationForm() {
  $('deleteLocationModal').classList.add('hidden');
  const trigger = $(deleteLocationReturnButton);
  (trigger.disabled ? $('locationFilter') : trigger).focus();
}

async function deleteLocationFromForm(event) {
  event.preventDefault();
  if (!canModifyInventory()) return toast('目前無法刪除，請先完成雲端同步');
  const name = $('deleteLocationSelect').value;
  if (!name || !allLocations().includes(name)) return toast('請選擇要刪除的位置');
  if (materials.some(item => item.location === name)) {
    renderDeleteLocationState();
    return toast('此位置仍有材料，請先將材料移到其他位置');
  }
  if (cloudEnabled) {
    try { await window.InventoryCloud.mutate('delete_location', { name }); }
    catch (error) { return toast(error.message); }
  } else {
    customLocations = customLocations.filter(location => location !== name);
    removedLocations = [...new Set([...removedLocations, name])];
    localStorage.setItem('inventory-locations', JSON.stringify(customLocations));
    localStorage.setItem('inventory-deleted-locations', JSON.stringify(removedLocations));
  }
  renderLocationOptions();
  resetMaterialPage();
  closeDeleteLocationForm();
  toast(`位置「${name}」已刪除，材料與異動紀錄保留`);
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 2600);
}

async function saveMaterialFromForm(event) {
  event.preventDefault();
  if (!canModifyInventory()) return toast('目前無法儲存，請先完成雲端同步');
  const form = $('materialForm');
  if (!form.reportValidity()) return;
  const editing = materials.find(item => item.id === editingMaterialId);
  if (editingMaterialId != null && !editing) return toast('材料已不存在，請關閉表單並重新同步');
  const name = $('materialName').value.trim();
  const category = $('materialCategory').value.trim();
  const unit = $('materialUnit').value.trim();
  const location = $('materialLocation').value;
  const detail = $('materialDetail').value.trim();
  const stock = Number($('materialStock').value);
  const alert = Number(editing ? $('materialAlertEdit').value : $('materialAlert').value);

  if (!name || !location) return toast('請填寫所有必填欄位');
  if ((!editing && (!Number.isSafeInteger(stock) || stock < 0)) || !Number.isSafeInteger(alert) || alert < 0) {
    return toast('庫存與警戒值須為 0 或正整數');
  }
  if (materials.some(item => item.id !== editingMaterialId && item.name.trim().toLowerCase() === name.toLowerCase() && item.location === location)) {
    return toast('這個倉庫位置已有相同名稱的材料');
  }

  if (stock > 2147483647 || alert > 2147483647) return toast('數量過大，請檢查輸入');
  if (cloudEnabled) {
    try {
      await window.InventoryCloud.mutate('save_material', {
        id: editingMaterialId, version: editingMaterialVersion, name, category, unit, stock, alert, location, detail
      });
    } catch (error) { return toast(error.message); }
  } else if (editing) {
    Object.assign(editing, { name, spec: `${category}／${unit}`, alert, location, detail });
  } else {
    materials.push({ id: Math.max(0, ...materials.map(item => item.id), ...archivedMaterials.map(item => item.id)) + 1, name, spec: `${category}／${unit}`, stock, alert, location, detail });
  }
  if (!cloudEnabled) save();
  closeMaterialForm();
  $('searchInput').value = '';
  $('locationFilter').value = location;
  lowStockOnly = false;
  setView('materials');
  resetMaterialPage();
  toast(editing ? '材料資料已更新' : '材料已新增');
}

function init() {
  const today = localDateKey();
  $('workDate').textContent = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  statsCustomRange = { start: `${today.slice(0, 7)}-01`, end: today };
  $('statsMonthInput').value = localMonth();
  $('statsWeekInput').value = today;
  const monthRange = statsPeriodRange('month', localMonth());
  $('statsStartDate').value = monthRange.start;
  $('statsEndDate').value = monthRange.end;
  renderLocationOptions();
  render();
  document.querySelectorAll('.nav-button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('lowStockToggle').addEventListener('click', () => toggleLowStock());
  $('lowStockFilter').addEventListener('click', () => toggleLowStock(true));
  $('addLocationFromPage').addEventListener('click', () => openLocationForm());
  $('deleteLocationFromPage').addEventListener('click', () => openDeleteLocationForm(true));
  $('warehouseLocations').addEventListener('click', event => {
    const button = event.target.closest('[data-location]');
    if (!button) return;
    $('locationFilter').value = button.dataset.location;
    lowStockOnly = false;
    setView('materials');
    resetMaterialPage();
  });
  $('statsModeSwitch').addEventListener('click', event => {
    const button = event.target.closest('[data-stats-mode]');
    if (button) chooseStatsMode(button.dataset.statsMode);
  });
  for (const id of ['statsMonthInput', 'statsWeekInput']) $(id).addEventListener('change', applyStatsPeriod);
  for (const id of ['statsStartDate', 'statsEndDate']) $(id).addEventListener('change', () => {
    if (statsMode === 'custom') statsCustomRange = { start: $('statsStartDate').value, end: $('statsEndDate').value };
    statsTransactionsPage = 1;
    renderStats();
  });
  $('previousStatsTransactionsPage').addEventListener('click', () => changeStatsTransactionsPage(-1));
  $('nextStatsTransactionsPage').addEventListener('click', () => changeStatsTransactionsPage(1));
  $('statsPreviousPeriod').addEventListener('click', () => shiftStatsPeriod(-1));
  $('statsNextPeriod').addEventListener('click', () => shiftStatsPeriod(1));
  $('statsCurrentPeriod').addEventListener('click', currentStatsPeriod);
  $('searchInput').addEventListener('input', resetMaterialPage);
  $('locationFilter').addEventListener('change', resetMaterialPage);
  $('previousMaterialsPage').addEventListener('click', () => changeMaterialPage(-1));
  $('nextMaterialsPage').addEventListener('click', () => changeMaterialPage(1));
  $('newMaterialButton').addEventListener('click', () => openMaterialForm());
  $('addLocationFromFilter').addEventListener('click', () => openLocationForm());
  $('deleteLocationFromFilter').addEventListener('click', () => openDeleteLocationForm());
  $('deleteLocationSelect').addEventListener('change', renderDeleteLocationState);
  $('deleteLocationForm').addEventListener('submit', deleteLocationFromForm);
  $('addLocationFromForm').addEventListener('click', () => openLocationForm(true));
  $('locationForm').addEventListener('submit', saveLocationFromForm);
  $('materialForm').addEventListener('submit', saveMaterialFromForm);
  $('deleteMaterialButton').addEventListener('click', openDeleteMaterial);
  $('todayTransactions').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-transaction]');
    if (button && !button.disabled) openTransactionEdit(button.dataset.editTransaction);
  });
  document.querySelectorAll('[data-close-transaction-edit]').forEach(button => button.addEventListener('click', closeTransactionEdit));
  for (const id of ['transactionEditQuantity', 'transactionEditNote']) $(id).addEventListener('input', renderTransactionEdit);
  $('transactionEditReason').addEventListener('change', renderTransactionEdit);
  $('transactionEditForm').addEventListener('submit', saveTransactionEdit);
  $('confirmDeleteMaterial').addEventListener('click', confirmDeleteMaterial);
  document.querySelectorAll('[data-cancel-delete-material]').forEach(button => button.addEventListener('click', cancelDeleteMaterial));
  document.querySelectorAll('[data-close-location-modal]').forEach(button => button.addEventListener('click', closeLocationForm));
  document.querySelectorAll('[data-close-delete-location-modal]').forEach(button => button.addEventListener('click', closeDeleteLocationForm));
  document.querySelectorAll('[data-close-material-modal]').forEach(button => button.addEventListener('click', closeMaterialForm));
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeAdjustment));
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const dialog = [...document.querySelectorAll('.modal:not(.hidden)')].at(-1);
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(control => !control.closest('.hidden'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (event.key !== 'Escape') return;
    // The account controller closes its own popover without discarding this draft.
    if (!$('accountPopover').classList.contains('hidden')) return;
    if (!$('logoutModal').classList.contains('hidden')) return;
    if (!$('transactionEditModal').classList.contains('hidden')) closeTransactionEdit();
    else if (!$('deleteMaterialModal').classList.contains('hidden')) cancelDeleteMaterial();
    else if (!$('deleteLocationModal').classList.contains('hidden')) closeDeleteLocationForm();
    else if (!$('locationModal').classList.contains('hidden')) closeLocationForm();
    else { closeMaterialForm(); closeAdjustment(); }
  });
  $('materialList').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const item = materials.find(candidate => candidate.id === Number(button.dataset.id));
    if (!item) return;
    if (button.dataset.action === 'edit') openMaterialForm(item);
    else openAdjustment(item, button.dataset.action === 'plus' ? '增加庫存' : '減少庫存');
  });
  $('increaseStep').onclick = () => changeAdjustmentQuantity(1);
  $('decreaseStep').onclick = () => changeAdjustmentQuantity(-1);
  $('stepValue').addEventListener('input', renderAdjustment);
  $('reasonSelect').addEventListener('change', renderAdjustment);
  window.visualViewport?.addEventListener('resize', updateAdjustmentViewport);
  window.visualViewport?.addEventListener('scroll', updateAdjustmentViewport);
  window.addEventListener('resize', updateAdjustmentViewport);
  $('adjustmentForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!activeMaterial || adjustmentSubmitting) return;
    if (!canModifyInventory()) return toast('請先確認連線或待處理操作，尚未新增異動');
    const checked = validateAdjustment();
    if (checked.error) { renderAdjustment(); $('stepValue').focus(); return; }
    const { item, adding, quantity } = checked;
    const amount = adding ? quantity : -quantity;
    const reason = $('reasonSelect').value;
    const note = $('noteInput').value.trim();
    if (note.length > 2000) return toast('備註最多可輸入 2000 個字');
    adjustmentSubmitting = true;
    renderAdjustment();
    if (cloudEnabled) {
      try { await window.InventoryCloud.mutate('adjust_stock', { materialId: item.id, amount, reason, note }); }
      catch (error) { adjustmentSubmitting = false; renderAdjustment(); return toast(error.message); }
    } else {
      item.stock += amount;
      transactions.push({ materialId: item.id, materialName: item.name, unit: unitOf(item), amount: Math.abs(amount), type: adding ? '增加' : '減少', time: new Date().toISOString(), reason, note });
      save();
    }
    adjustmentSubmitting = false;
    closeAdjustment();
    render();
    const updated = materials.find(candidate => candidate.id === item.id) || item;
    toast(isLow(updated) ? `${updated.name} 已異動，庫存${updated.stock === updated.alert ? '已達' : '低於'}警戒值` : '庫存異動已完成');
  });
  $('closeStats').onclick = () => setView('home');
  $('scanButton').onclick = () => { $('locationFilter').value = '12樓西'; lowStockOnly = false; setView('materials'); resetMaterialPage(); toast('掃描成功：已開啟 12樓西 材料清單'); };
  $('notifyButton').onclick = () => toast('正式版將在低於警戒值時傳送 LINE 通知');
  if (cloudEnabled) {
    $('cloudPanel').classList.remove('hidden');
    renderAccessControls();
    document.querySelector('.bottom-note').textContent = window.INVENTORY_CLOUD_CONFIG?.preview ? '本機預覽：僅使用示範資料，所有更正不會影響正式庫存。' : '雲端模式：原裝置舊資料保留作為備份，不會自動匯入；LINE 通知尚未啟用。';
    if (!window.InventoryCloud) {
      $('cloudStatus').textContent = '雲端元件無法載入，請重新整理；尚未異動資料。';
      return;
    }
    void window.InventoryCloud.start({
      defaultLocations: LOCATIONS.slice(1),
      applySnapshot(snapshot) {
        materials = snapshot.materials;
        transactions = snapshot.transactions;
        transactionEditingAvailable = snapshot.features?.transactionEdit === true;
        archivedMaterials = snapshot.archivedMaterials || [];
        customLocations = snapshot.locations;
        renderLocationOptions();
        if (!$('locationFilter').value) $('locationFilter').value = '全部位置';
        render();
      },
      clearSnapshot() {
        materials = []; transactions = []; customLocations = []; archivedMaterials = [];
        deletingMaterial = null;
        transactionEditingAvailable = false;
        closeTransactionEdit(true); closeAdjustment(true); closeMaterialForm();
        $('locationModal').classList.add('hidden'); locationReturnToMaterial = false;
        $('deleteLocationModal').classList.add('hidden');
        renderLocationOptions(); render();
      },
      onStatus: renderAccessControls,
      onRecovered() {
        closeTransactionEdit(true); closeAdjustment(); closeMaterialForm(true); $('locationModal').classList.add('hidden');
        $('deleteLocationModal').classList.add('hidden');
        locationReturnToMaterial = false; toast('待處理操作已確認，沒有重複異動');
      }
    });
  }
}

init();
