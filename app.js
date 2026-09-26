const LOCATIONS = ['全部位置', '12樓西', '12樓東', '11樓西', '11樓東', '10樓西', '10樓東', '9樓西', '9樓東', '8樓西', '8樓東', '7樓西', '7樓東', '6樓西', '6樓東', '5樓西', '5樓東', '4樓西', '4樓東', '3樓西', '3樓東', '2樓西', '2樓東', '1樓'];
const seed = [
  { id: 1, name: 'PVC 管 2 吋', spec: '給水管材／支', stock: 35, alert: 10, location: '12樓西', detail: 'A-03貨架／第2層' },
  { id: 2, name: '單芯電線 2.0mm', spec: '電線電纜／捲', stock: 8, alert: 10, location: '11樓東', detail: 'B-01貨架／第1層' },
  { id: 3, name: '不鏽鋼水龍頭', spec: '衛浴設備／個', stock: 24, alert: 6, location: '8樓西', detail: 'C-02貨架／第3層' },
  { id: 4, name: '無熔絲開關 20A', spec: '電氣材料／個', stock: 12, alert: 5, location: '7樓東', detail: 'D-05櫃／第2層' },
  { id: 5, name: 'PVC 彎頭 2 吋', spec: '管件／個', stock: 4, alert: 8, location: '12樓西', detail: 'A-03貨架／第3層' },
  { id: 6, name: '止水帶', spec: '施工耗材／卷', stock: 18, alert: 5, location: '1樓', detail: '入口工具櫃／左側' }
];

const storedMaterials = localStorage.getItem('inventory-materials');
let materials = storedMaterials ? JSON.parse(storedMaterials) : seed;
let transactions = JSON.parse(localStorage.getItem('inventory-transactions') || '[]');
let activeMaterial = null;
let editingMaterialId = null;
let step = 1;
const $ = id => document.getElementById(id);

function save() {
  localStorage.setItem('inventory-materials', JSON.stringify(materials));
  localStorage.setItem('inventory-transactions', JSON.stringify(transactions));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function isLow(item) { return item.stock <= item.alert; }
function unitOf(item) { return item.spec.split('／')[1] || '件'; }
function formatNumber(number) { return new Intl.NumberFormat('zh-TW').format(number); }
function localMonth(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }

function render() {
  const term = $('searchInput').value.trim().toLowerCase();
  const location = $('locationFilter').value;
  const filtered = materials.filter(item =>
    (!term || `${item.name} ${item.spec} ${item.detail}`.toLowerCase().includes(term)) &&
    (location === '全部位置' || item.location === location)
  );
  const month = localMonth();
  const used = transactions.filter(record => record.type === '減少' && localMonth(new Date(record.time)) === month)
    .reduce((total, record) => total + record.amount, 0);

  $('materialCount').textContent = materials.length;
  $('lowStockCount').textContent = materials.filter(isLow).length;
  $('monthlyUsage').textContent = formatNumber(used);
  $('locationNote').textContent = location === '全部位置' ? '目前顯示全部倉庫位置' : `目前位置：${location}`;
  $('materialList').innerHTML = filtered.length ? filtered.map(item => `
    <article class="material-card ${isLow(item) ? 'low' : ''}">
      <div>
        <div class="material-name">${escapeHTML(item.name)}</div>
        <div class="material-meta">${escapeHTML(item.spec)} · ${escapeHTML(item.location)} · ${escapeHTML(item.detail)}</div>
        <div class="material-actions">
          <button class="round-button minus" data-action="minus" data-id="${item.id}" aria-label="減少 ${escapeHTML(item.name)} 庫存">−</button>
          <button class="round-button" data-action="plus" data-id="${item.id}" aria-label="增加 ${escapeHTML(item.name)} 庫存">＋</button>
          <button class="manage-button" data-action="manage" data-id="${item.id}">領用數量</button>
          <button class="edit-button" data-action="edit" data-id="${item.id}">編輯資料</button>
        </div>
      </div>
      <div><span class="stock-number ${isLow(item) ? 'low' : ''}">${formatNumber(item.stock)}</span><span class="stock-unit">${escapeHTML(unitOf(item))}</span></div>
    </article>`).join('') : '<div class="location-note">找不到符合條件的材料。</div>';
  renderStats();
}

function renderStats() {
  const month = localMonth();
  const usage = materials.map(item => ({
    name: item.name,
    amount: transactions.filter(record => record.materialId === item.id && record.type === '減少' && localMonth(new Date(record.time)) === month)
      .reduce((total, record) => total + record.amount, 0)
  })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const max = Math.max(...usage.map(item => item.amount), 1);
  $('usageChart').innerHTML = usage.map(item => `
    <div class="chart-item"><span>${item.amount}</span>
      <div class="bar" style="height:${Math.max(8, item.amount / max * 105)}px"></div>
      <span title="${escapeHTML(item.name)}">${escapeHTML(item.name.slice(0, 5))}</span>
    </div>`).join('');
  $('topUsed').textContent = usage[0]?.amount ? `${usage[0].name}（${usage[0].amount}）` : '尚無領用紀錄';
  $('monthlyRestock').textContent = `${transactions.filter(record => record.type === '增加' && localMonth(new Date(record.time)) === month)
    .reduce((total, record) => total + record.amount, 0)} 件`;
}

function openAdjustment(item, type) {
  activeMaterial = item;
  step = 1;
  $('stepValue').textContent = step;
  $('modalEyebrow').textContent = type;
  $('modalTitle').textContent = `${type}｜${item.name}`;
  $('modalLocation').textContent = `${item.location} · ${item.detail} · 目前 ${item.stock} ${unitOf(item)}`;
  $('reasonSelect').value = type === '增加庫存' ? '入庫補貨' : '工地使用';
  $('noteInput').value = '';
  $('modal').classList.remove('hidden');
}

function closeAdjustment() {
  $('modal').classList.add('hidden');
  activeMaterial = null;
}

function openMaterialForm(item = null) {
  editingMaterialId = item?.id ?? null;
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
  $('materialAlertEdit').value = item?.alert ?? 5;
  $('materialLocation').value = item?.location ?? '12樓西';
  $('materialDetail').value = item?.detail ?? '';
  $('materialFormHint').textContent = item ? '庫存數量請使用材料清單上的 ＋ 或 − 調整。' : '庫存與警戒值請填入 0 或正整數。';
  $('materialModal').classList.remove('hidden');
  $('materialName').focus();
}

function closeMaterialForm() {
  $('materialModal').classList.add('hidden');
  editingMaterialId = null;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 2600);
}

function saveMaterialFromForm(event) {
  event.preventDefault();
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

  if (!name || !category || !unit || !detail || !location) return toast('請填寫所有必填欄位');
  if ((!editing && (!Number.isSafeInteger(stock) || stock < 0)) || !Number.isSafeInteger(alert) || alert < 0) {
    return toast('庫存與警戒值須為 0 或正整數');
  }
  if (materials.some(item => item.id !== editingMaterialId && item.name.trim().toLowerCase() === name.toLowerCase() && item.location === location)) {
    return toast('這個倉庫位置已有相同名稱的材料');
  }

  if (editing) {
    Object.assign(editing, { name, spec: `${category}／${unit}`, alert, location, detail });
  } else {
    materials.push({ id: Math.max(0, ...materials.map(item => item.id)) + 1, name, spec: `${category}／${unit}`, stock, alert, location, detail });
  }
  save();
  closeMaterialForm();
  $('searchInput').value = '';
  $('locationFilter').value = location;
  render();
  toast(editing ? '材料資料已更新' : '材料已新增');
}

function init() {
  $('locationFilter').innerHTML = LOCATIONS.map(location => `<option>${location}</option>`).join('');
  $('materialLocation').innerHTML = LOCATIONS.slice(1).map(location => `<option>${location}</option>`).join('');
  render();
  $('searchInput').addEventListener('input', render);
  $('locationFilter').addEventListener('change', render);
  $('newMaterialButton').addEventListener('click', () => openMaterialForm());
  $('materialForm').addEventListener('submit', saveMaterialFromForm);
  document.querySelectorAll('[data-close-material-modal]').forEach(button => button.addEventListener('click', closeMaterialForm));
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeAdjustment));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMaterialForm(); closeAdjustment(); }
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
  $('confirmAdjustment').onclick = () => {
    if (!activeMaterial) return;
    const item = activeMaterial;
    const adding = $('modalEyebrow').textContent === '增加庫存';
    const amount = adding ? step : -step;
    if (item.stock + amount < 0) return toast('庫存不足，無法扣除這麼多數量');
    item.stock += amount;
    transactions.push({ materialId: item.id, amount: Math.abs(amount), type: adding ? '增加' : '減少', time: new Date().toISOString(), reason: $('reasonSelect').value, note: $('noteInput').value });
    save();
    closeAdjustment();
    render();
    toast(isLow(item) ? `${item.name} 已異動，庫存低於警戒值` : '庫存異動已完成');
  };
  $('statsButton').onclick = () => { $('statsPanel').classList.remove('hidden'); $('statsPanel').scrollIntoView({ behavior: 'smooth' }); };
  $('closeStats').onclick = () => $('statsPanel').classList.add('hidden');
  $('scanButton').onclick = () => { $('locationFilter').value = '12樓西'; render(); toast('掃描成功：已開啟 12樓西 材料清單'); };
  $('notifyButton').onclick = () => toast('正式版將在低於警戒值時傳送 LINE 通知');
}

init();
