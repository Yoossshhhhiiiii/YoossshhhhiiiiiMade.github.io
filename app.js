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
let customLocations = cloudEnabled ? [] : JSON.parse(localStorage.getItem('inventory-locations') || '[]');
let activeMaterial = null;
let editingMaterialId = null;
let editingMaterialVersion = null;
let locationReturnToMaterial = false;
let locationReturnView = 'home';
let step = 1;
const MATERIALS_PER_PAGE = 5;
let materialPage = 1;
let lowStockOnly = false;
const $ = id => document.getElementById(id);

function save() {
  if (cloudEnabled) throw new Error('雲端模式不可改寫裝置舊資料');
  localStorage.setItem('inventory-materials', JSON.stringify(materials));
  localStorage.setItem('inventory-transactions', JSON.stringify(transactions));
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
  for (const id of ['newMaterialButton', 'addLocationFromPage', 'addLocationFromFilter', 'addLocationFromForm', 'saveMaterialButton', 'confirmAdjustment', 'saveLocationButton']) {
    if ($(id)) $(id).disabled = disabled;
  }
  document.querySelectorAll('#materialList [data-action]').forEach(button => { button.disabled = disabled; });
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
function localMonth(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function localDateKey(date = new Date()) {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function transactionMaterial(record) {
  const item = materials.find(candidate => candidate.id === record.materialId);
  return { name: record.materialName || item?.name || `材料 #${record.materialId}`, unit: record.unit ?? (item ? unitOf(item) : '') };
}

function transactionCard(record) {
  const { name, unit } = transactionMaterial(record);
  const date = new Date(record.time);
  const time = Number.isNaN(date.getTime()) ? '日期不明' : new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
  const adding = record.type === '增加';
  return `
    <article class="transaction-card">
      <div class="transaction-main">
        <div><span class="transaction-time">${escapeHTML(time)}</span><strong>${escapeHTML(name)}</strong></div>
        <span class="transaction-amount ${adding ? 'added' : 'used'}">${adding ? '＋' : '−'}${formatNumber(record.amount)}${unit ? ` ${escapeHTML(unit)}` : ''}</span>
      </div>
      <div class="transaction-meta">異動：${adding ? '增加庫存' : '減少庫存'} · 原因：${escapeHTML(record.reason || '未填寫')}</div>
      <div class="transaction-note">備註：${escapeHTML(record.note || '無')}</div>
    </article>`;
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
  $('todayTransactions').innerHTML = records.length
    ? records.map(transactionCard).join('')
    : '<p class="activity-empty">新增或減少材料後，異動紀錄會顯示在這裡。</p>';
}

function allLocations() {
  return [...new Set([...LOCATIONS.slice(1), ...customLocations, ...materials.map(item => item.location)])].filter(Boolean);
}

function renderLocationOptions() {
  const selectedFilter = $('locationFilter').value || '全部位置';
  const selectedMaterial = $('materialLocation').value || '12樓西';
  const locations = allLocations();
  $('locationFilter').replaceChildren(...['全部位置', ...locations].map(location => new Option(location, location)));
  $('materialLocation').replaceChildren(...locations.map(location => new Option(location, location)));
  $('locationFilter').value = selectedFilter;
  $('materialLocation').value = selectedMaterial;
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
    stats: ['每次使用，都有跡可循。', '選擇日期，查看材料、原因與備註。'],
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

function renderStats() {
  const start = $('statsStartDate').value;
  const end = $('statsEndDate').value;
  const invalid = !start || !end || start > end;
  $('statsRangeError').classList.toggle('hidden', !invalid);
  const records = invalid ? [] : transactionsInRange(start, end);
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
  $('rangeTransactions').innerHTML = invalid
    ? '<p class="activity-empty">請選擇有效的開始與結束日期。</p>'
    : records.length ? records.map(transactionCard).join('') : '<p class="activity-empty">所選日期沒有庫存異動。</p>';
}

function openAdjustment(item, type) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步，尚未異動庫存');
  activeMaterial = item;
  step = 1;
  $('stepValue').textContent = step;
  $('modalEyebrow').textContent = type;
  $('modalTitle').textContent = `${type}｜${item.name}`;
  $('modalLocation').textContent = `${item.location}${item.detail ? ` · ${item.detail}` : ''} · 目前 ${item.stock} ${unitOf(item)}`;
  $('reasonSelect').value = type === '增加庫存' ? '入庫補貨' : '維修使用';
  $('noteInput').value = '';
  $('modal').classList.remove('hidden');
  $('noteInput').focus?.();
}

function closeAdjustment() {
  $('modal').classList.add('hidden');
  activeMaterial = null;
}

function openMaterialForm(item = null) {
  if (!canModifyInventory()) return toast('請先登入並完成雲端同步');
  editingMaterialId = item?.id ?? null;
  editingMaterialVersion = item?.version ?? null;
  $('materialForm').reset();
  $('materialModalTitle').textContent = item ? '編輯材料資料' : '新增材料';
  $('saveMaterialButton').textContent = item ? '儲存變更' : '儲存材料';
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
  $('materialLocation').value = item?.location ?? '12樓西';
  $('materialDetail').value = item?.detail ?? '';
  $('materialFormHint').textContent = item?.alert == null && item ? '請補上分類、單位和警戒值；庫存數量請使用 ＋ 或 − 調整。' : item ? '庫存數量請使用材料清單上的 ＋ 或 − 調整。' : '庫存與警戒值請填入 0 或正整數。';
  $('materialModal').classList.remove('hidden');
  $('materialName').focus();
}

function closeMaterialForm() {
  $('materialModal').classList.add('hidden');
  editingMaterialId = null;
  editingMaterialVersion = null;
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
    localStorage.setItem('inventory-locations', JSON.stringify(customLocations));
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
  const name = $('materialName').value.trim();
  const category = $('materialCategory').value.trim();
  const unit = $('materialUnit').value.trim();
  const location = $('materialLocation').value;
  const detail = $('materialDetail').value.trim();
  const stock = Number($('materialStock').value);
  const alert = Number(editing ? $('materialAlertEdit').value : $('materialAlert').value);

  if (!name || !category || !unit || !location) return toast('請填寫所有必填欄位');
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
    materials.push({ id: Math.max(0, ...materials.map(item => item.id)) + 1, name, spec: `${category}／${unit}`, stock, alert, location, detail });
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
  $('statsStartDate').value = `${today.slice(0, 7)}-01`;
  $('statsEndDate').value = today;
  renderLocationOptions();
  render();
  document.querySelectorAll('.nav-button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('lowStockToggle').addEventListener('click', () => toggleLowStock());
  $('lowStockFilter').addEventListener('click', () => toggleLowStock(true));
  $('addLocationFromPage').addEventListener('click', () => openLocationForm());
  $('warehouseLocations').addEventListener('click', event => {
    const button = event.target.closest('[data-location]');
    if (!button) return;
    $('locationFilter').value = button.dataset.location;
    lowStockOnly = false;
    setView('materials');
    resetMaterialPage();
  });
  $('statsStartDate').addEventListener('change', renderStats);
  $('statsEndDate').addEventListener('change', renderStats);
  $('searchInput').addEventListener('input', resetMaterialPage);
  $('locationFilter').addEventListener('change', resetMaterialPage);
  $('previousMaterialsPage').addEventListener('click', () => changeMaterialPage(-1));
  $('nextMaterialsPage').addEventListener('click', () => changeMaterialPage(1));
  $('newMaterialButton').addEventListener('click', () => openMaterialForm());
  $('addLocationFromFilter').addEventListener('click', () => openLocationForm());
  $('addLocationFromForm').addEventListener('click', () => openLocationForm(true));
  $('locationForm').addEventListener('submit', saveLocationFromForm);
  $('materialForm').addEventListener('submit', saveMaterialFromForm);
  document.querySelectorAll('[data-close-location-modal]').forEach(button => button.addEventListener('click', closeLocationForm));
  document.querySelectorAll('[data-close-material-modal]').forEach(button => button.addEventListener('click', closeMaterialForm));
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeAdjustment));
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const dialog = document.querySelector('.modal:not(.hidden)');
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
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
    if (!$('locationModal').classList.contains('hidden')) closeLocationForm();
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
  $('increaseStep').onclick = () => { step++; $('stepValue').textContent = step; };
  $('decreaseStep').onclick = () => { step = Math.max(1, step - 1); $('stepValue').textContent = step; };
  $('confirmAdjustment').onclick = async () => {
    if (!activeMaterial) return;
    if (!canModifyInventory()) return toast('請先確認連線或待處理操作，尚未新增異動');
    const item = activeMaterial;
    const adding = $('modalEyebrow').textContent === '增加庫存';
    const amount = adding ? step : -step;
    if (item.stock + amount < 0) return toast('庫存不足，無法扣除這麼多數量');
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 2147483647) return toast('異動數量過大');
    if (cloudEnabled) {
      try { await window.InventoryCloud.mutate('adjust_stock', { materialId: item.id, amount, reason: $('reasonSelect').value, note: $('noteInput').value.trim() }); }
      catch (error) { return toast(error.message); }
    } else {
      item.stock += amount;
      transactions.push({ materialId: item.id, materialName: item.name, unit: unitOf(item), amount: Math.abs(amount), type: adding ? '增加' : '減少', time: new Date().toISOString(), reason: $('reasonSelect').value, note: $('noteInput').value.trim() });
      save();
    }
    closeAdjustment();
    render();
    const updated = materials.find(candidate => candidate.id === item.id) || item;
    toast(isLow(updated) ? `${updated.name} 已異動，庫存低於警戒值` : '庫存異動已完成');
  };
  $('closeStats').onclick = () => setView('home');
  $('scanButton').onclick = () => { $('locationFilter').value = '12樓西'; lowStockOnly = false; setView('materials'); resetMaterialPage(); toast('掃描成功：已開啟 12樓西 材料清單'); };
  $('notifyButton').onclick = () => toast('正式版將在低於警戒值時傳送 LINE 通知');
  if (cloudEnabled) {
    $('cloudPanel').classList.remove('hidden');
    renderAccessControls();
    document.querySelector('.bottom-note').textContent = '雲端模式：原裝置舊資料保留作為備份，不會自動匯入；LINE 通知尚未啟用。';
    if (!window.InventoryCloud) {
      $('cloudStatus').textContent = '雲端元件無法載入，請重新整理；尚未異動資料。';
      return;
    }
    void window.InventoryCloud.start({
      defaultLocations: LOCATIONS.slice(1),
      applySnapshot(snapshot) {
        materials = snapshot.materials;
        transactions = snapshot.transactions;
        customLocations = snapshot.locations;
        renderLocationOptions();
        if (!$('locationFilter').value) $('locationFilter').value = '全部位置';
        render();
      },
      clearSnapshot() {
        materials = []; transactions = []; customLocations = [];
        closeAdjustment(); closeMaterialForm();
        $('locationModal').classList.add('hidden'); locationReturnToMaterial = false;
        renderLocationOptions(); render();
      },
      onStatus: renderAccessControls,
      onRecovered() {
        closeAdjustment(); closeMaterialForm(); $('locationModal').classList.add('hidden');
        locationReturnToMaterial = false; toast('待處理操作已確認，沒有重複異動');
      }
    });
  }
}

init();
