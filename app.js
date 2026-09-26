const LOCATIONS = ['全部位置','12樓西','12樓東','11樓西','11樓東','10樓西','10樓東','9樓西','9樓東','8樓西','8樓東','7樓西','7樓東','6樓西','6樓東','5樓西','5樓東','4樓西','4樓東','3樓西','3樓東','2樓西','2樓東','1樓'];
const seed = [
  { id: 1, name: 'PVC 管 2 吋', spec: '給水管材／支', stock: 35, alert: 10, location: '12樓西', detail: 'A-03貨架／第2層' },
  { id: 2, name: '單芯電線 2.0mm', spec: '電線電纜／捲', stock: 8, alert: 10, location: '11樓東', detail: 'B-01貨架／第1層' },
  { id: 3, name: '不鏽鋼水龍頭', spec: '衛浴設備／個', stock: 24, alert: 6, location: '8樓西', detail: 'C-02貨架／第3層' },
  { id: 4, name: '無熔絲開關 20A', spec: '電氣材料／個', stock: 12, alert: 5, location: '7樓東', detail: 'D-05櫃／第2層' },
  { id: 5, name: 'PVC 彎頭 2 吋', spec: '管件／個', stock: 4, alert: 8, location: '12樓西', detail: 'A-03貨架／第3層' },
  { id: 6, name: '止水帶', spec: '施工耗材／卷', stock: 18, alert: 5, location: '1樓', detail: '入口工具櫃／左側' }
];
let materials = JSON.parse(localStorage.getItem('inventory-materials') || 'null') || seed;
let transactions = JSON.parse(localStorage.getItem('inventory-transactions') || '[]');
let activeMaterial = null, step = 1;
const $ = (id) => document.getElementById(id);

function save() { localStorage.setItem('inventory-materials', JSON.stringify(materials)); localStorage.setItem('inventory-transactions', JSON.stringify(transactions)); }
function isLow(item) { return item.stock <= item.alert; }
function formatNumber(n) { return new Intl.NumberFormat('zh-TW').format(n); }
function render() {
  const term = $('searchInput').value.trim().toLowerCase(); const location = $('locationFilter').value;
  const filtered = materials.filter(m => (!term || `${m.name} ${m.spec}`.toLowerCase().includes(term)) && (location === '全部位置' || m.location === location));
  $('materialCount').textContent = materials.length; $('lowStockCount').textContent = materials.filter(isLow).length;
  const month = new Date().toISOString().slice(0, 7); const used = transactions.filter(t => t.type === '減少' && t.time.startsWith(month)).reduce((n,t) => n + t.amount, 0); $('monthlyUsage').textContent = used;
  $('locationNote').textContent = location === '全部位置' ? '目前顯示全部倉庫位置' : `目前位置：${location}`;
  $('materialList').innerHTML = filtered.length ? filtered.map(m => `<article class="material-card ${isLow(m) ? 'low' : ''}"><div><div class="material-name">${m.name}</div><div class="material-meta">${m.spec} · ${m.location} · ${m.detail}</div><div class="material-actions"><button class="round-button minus" data-action="minus" data-id="${m.id}" aria-label="減少庫存">−</button><button class="round-button" data-action="plus" data-id="${m.id}" aria-label="增加庫存">＋</button><button class="manage-button" data-action="manage" data-id="${m.id}">輸入數量</button></div></div><div><span class="stock-number ${isLow(m) ? 'low' : ''}">${formatNumber(m.stock)}</span><span class="stock-unit">${m.spec.split('／')[1] || '件'}</span></div></article>`).join('') : '<div class="location-note">找不到符合條件的材料。</div>';
  renderStats();
}
function renderStats() {
  const month = new Date().toISOString().slice(0, 7); const usage = materials.map(m => ({ name: m.name, amount: transactions.filter(t => t.materialId === m.id && t.type === '減少' && t.time.startsWith(month)).reduce((n,t) => n + t.amount, 0) })).sort((a,b) => b.amount - a.amount).slice(0,5); const max = Math.max(...usage.map(x=>x.amount), 1);
  $('usageChart').innerHTML = usage.map(x => `<div class="chart-item"><span>${x.amount}</span><div class="bar" style="height:${Math.max(8, x.amount / max * 105)}px"></div><span title="${x.name}">${x.name.slice(0,5)}</span></div>`).join(''); $('topUsed').textContent = usage[0]?.amount ? `${usage[0].name}（${usage[0].amount}）` : '尚無領用紀錄'; $('monthlyRestock').textContent = `${transactions.filter(t => t.type === '增加' && t.time.startsWith(month)).reduce((n,t)=>n+t.amount,0)} 件`;
}
function openModal(item, type = '調整庫存') { activeMaterial = item; step = 1; $('modalEyebrow').textContent = type; $('modalTitle').textContent = `${type}｜${item.name}`; $('modalLocation').textContent = `${item.location} · ${item.detail} · 目前 ${item.stock} ${item.spec.split('／')[1] || '件'}`; $('stepValue').textContent = step; $('reasonSelect').value = type === '增加庫存' ? '入庫補貨' : '工地使用'; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); activeMaterial = null; }
function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); setTimeout(() => $('toast').classList.add('hidden'), 2600); }
function init() { $('locationFilter').innerHTML = LOCATIONS.map(l => `<option>${l}</option>`).join(''); render(); $('searchInput').addEventListener('input', render); $('locationFilter').addEventListener('change', render); $('materialList').addEventListener('click', e => { const btn = e.target.closest('[data-action]'); if (!btn) return; const item = materials.find(m=>m.id === Number(btn.dataset.id)); if (btn.dataset.action === 'manage') openModal(item); else openModal(item, btn.dataset.action === 'plus' ? '增加庫存' : '減少庫存'); }); $('increaseStep').onclick = () => { step++; $('stepValue').textContent = step; }; $('decreaseStep').onclick = () => { step = Math.max(1, step - 1); $('stepValue').textContent = step; }; document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal)); $('confirmAdjustment').onclick = () => { if (!activeMaterial) return; const adding = $('modalEyebrow').textContent === '增加庫存'; const amount = adding ? step : -step; if (!adding && activeMaterial.stock + amount < 0) return toast('庫存不足，無法扣除這麼多數量'); activeMaterial.stock += amount; transactions.push({ materialId: activeMaterial.id, amount: Math.abs(amount), type: adding ? '增加' : '減少', time: new Date().toISOString(), reason: $('reasonSelect').value, note: $('noteInput').value }); save(); const low = isLow(activeMaterial); closeModal(); render(); toast(low ? `${activeMaterial?.name || '材料'} 已異動，庫存低於警戒值` : '庫存異動已完成'); }; $('statsButton').onclick = () => { $('statsPanel').classList.remove('hidden'); $('statsPanel').scrollIntoView({ behavior: 'smooth' }); }; $('closeStats').onclick = () => $('statsPanel').classList.add('hidden'); $('scanButton').onclick = () => { $('locationFilter').value = '12樓西'; render(); toast('掃描成功：已開啟 12樓西 材料清單'); }; $('notifyButton').onclick = () => toast('正式版將在低於警戒值時傳送 LINE 通知'); }
init();
