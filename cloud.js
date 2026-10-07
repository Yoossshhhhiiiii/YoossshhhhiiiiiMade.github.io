(() => {
  'use strict';
  const config = window.INVENTORY_CLOUD_CONFIG;
  const enabled = config?.enabled === true || (config == null && document.documentElement.dataset.storageMode === 'cloud');
  const legacyKeys = ['inventory-materials', 'inventory-transactions', 'inventory-locations'];
  const prefix = `inventory-cloud-pending-v1:${config?.url || ''}:`;
  const maxInteger = 2147483647;
  const state = { mode: 'starting', session: null, snapshot: null, busy: false, pending: [], message: '', revision: -1 };
  let client;
  let hooks = {};
  let generation = 0;
  let poll;
  let refreshing;
  let backupSignature = '';
  const el = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const errors = {
    WAREHOUSE_ACCESS_DENIED: '這個登入帳號尚未獲准使用庫存，請聯絡管理員。',
    WAREHOUSE_IMPORT_NOT_ALLOWED: '這個帳號沒有首次匯入權限。',
    WAREHOUSE_ALREADY_INITIALIZED: '雲端已有資料，不能再次匯入或覆蓋。請重新同步查看。',
    WAREHOUSE_INSUFFICIENT_STOCK: '雲端庫存不足，沒有扣庫存，也沒有新增異動紀錄。',
    WAREHOUSE_EDIT_CONFLICT: '這筆材料已在其他裝置更新。請關閉表單、重新同步後再編輯。',
    WAREHOUSE_NOT_INITIALIZED: '請先由原本的手機完成首次匯入。',
    WAREHOUSE_MATERIAL_NOT_FOUND: '找不到這筆雲端材料，請重新同步。',
    WAREHOUSE_REQUEST_CONFLICT: '待確認操作與原紀錄不一致，請聯絡管理員；沒有再次異動。',
    WAREHOUSE_INVALID_INPUT: '欄位或數量不符合要求，請檢查後再送出。',
    WAREHOUSE_INVALID_IMPORT: '手機資料格式不符，請保留備份並聯絡管理員。',
    WAREHOUSE_EMPTY_IMPORT: '沒有材料可以匯入。',
    WAREHOUSE_ORPHAN_TRANSACTION: '舊異動紀錄有找不到的材料，請先整理備份；尚未匯入。'
  };

  function errorText(error) {
    const known = Object.keys(errors).find(key => error?.message?.includes(key));
    if (known) return errors[known];
    if (error?.code === '23505') return '此位置或材料名稱已存在，沒有重複新增。';
    if (error?.code === 'PGRST202' || error?.code === '42P01') return '雲端資料庫尚未設定完成，請保留手機資料，暫勿匯入。';
    if (error?.code === 'invalid_credentials') return 'Email 或密碼不正確，請重新輸入。';
    if (error?.code === 'email_not_confirmed') return '此帳號尚未確認，請聯絡管理員。';
    if (error?.code === '23514' || error?.code === '23502' || error?.code?.startsWith('22')) return '資料格式、數量或欄位長度不符；沒有儲存，請檢查資料。';
    if (error?.code === '42501') return '此帳號沒有庫存存取權限，請聯絡管理員。';
    return '連線失敗，請檢查網路後重試。';
  }

  function rawLegacy() {
    return Object.fromEntries(legacyKeys.map(key => [key, localStorage.getItem(key)]));
  }

  function legacyInventory() {
    const raw = rawLegacy();
    try {
      const data = {
        materials: JSON.parse(raw['inventory-materials'] || '[]'),
        transactions: JSON.parse(raw['inventory-transactions'] || '[]'),
        locations: JSON.parse(raw['inventory-locations'] || '[]')
      };
      if (!Object.values(data).every(Array.isArray)) throw new Error();
      return data;
    } catch {
      throw new Error('此裝置的舊資料格式異常。請先下載舊資料備份，不要清除瀏覽器資料。');
    }
  }

  function validateImport(data, defaultLocations = []) {
    if (!data.materials.length) throw new Error('找不到此裝置的舊材料。請改用原本管理庫存的手機開啟網站。');
    const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min && value <= maxInteger;
    const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
    const ids = new Set();
    const names = new Set();
    for (const item of data.materials) {
      if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || !integer(item.stock)
        || (item.alert != null && !integer(item.alert)) || !text(item.name, 100, true)
        || !text(item.spec, 101) || !text(item.location, 40, true)
        || !text(item.detail ?? '', 100) || ids.has(item.id)) throw new Error('材料格式或數量不符，請保留備份並聯絡管理員。');
      const nameKey = `${item.location.trim()}\n${item.name.trim().toLowerCase()}`;
      if (names.has(nameKey)) throw new Error('同一位置有重複材料名稱，請先整理手機資料。');
      ids.add(item.id); names.add(nameKey);
    }
    const materials = data.materials.map(item => ({
      id: item.id, name: item.name.trim(), spec: item.spec, stock: item.stock,
      alert: item.alert ?? null, location: item.location.trim(), detail: item.detail ?? ''
    }));
    const byId = new Map(materials.map(item => [item.id, item]));
    const transactions = data.transactions.map(record => {
      const item = record && byId.get(record.materialId);
      if (!item || !integer(record.amount, 1) || !['增加', '減少'].includes(record.type)
        || typeof record.time !== 'string' || Number.isNaN(new Date(record.time).getTime())
        || !text(record.materialName ?? item.name, 100) || !text(record.unit ?? item.spec.split('／')[1] ?? '', 20)
        || !text(record.reason ?? '', 100) || !text(record.note ?? '', 10000)) {
        throw new Error('異動紀錄格式不符或缺少對應材料，請保留備份並聯絡管理員。');
      }
      return { materialId: record.materialId, materialName: record.materialName ?? item.name,
        unit: record.unit ?? item.spec.split('／')[1] ?? '', amount: record.amount, type: record.type,
        time: new Date(record.time).toISOString(), reason: record.reason ?? '', note: record.note ?? '' };
    });
    const locations = [...new Set([...defaultLocations, ...data.locations, ...materials.map(item => item.location)])];
    if (locations.some(name => !text(name, 40, true) || name !== name.trim() || name === '全部位置')) throw new Error('位置名稱格式不符，請先整理手機資料。');
    return { schemaVersion: 1, source: 'phone', materials, transactions, locations };
  }

  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function backupDevice() {
    try {
      const raw = rawLegacy();
      const backup = { format: 'warehouse-device-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), legacyStorage: raw };
      try { backup.inventory = legacyInventory(); } catch { /* Raw strings are recoverable even if JSON is damaged. */ }
      download(backup, `庫存管家-此裝置舊資料-${new Date().toISOString().slice(0, 10)}.json`);
      backupSignature = JSON.stringify(raw);
      state.message = '已開始下載舊資料備份。請確認備份已儲存到手機「檔案」，再勾選匯入確認。';
      publish();
    } catch { state.message = '無法下載備份，請檢查瀏覽器權限。不要清除舊資料。'; publish(); }
  }

  function pendingPrefix() { return `${prefix}${state.session?.user.id}:`; }
  function readPending() {
    if (!state.session) return [];
    const records = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(pendingPrefix())) continue;
      const record = JSON.parse(localStorage.getItem(key));
      if (!record || !/^[0-9a-f-]{36}$/i.test(record.id) || !record.operation || !record.payload) {
        throw new Error('待確認紀錄格式異常，請保留資料並聯絡管理員。');
      }
      records.push({ ...record, key });
    }
    return records;
  }

  function canWrite() { return !enabled || (!!state.session && state.snapshot?.initialized && state.mode === 'ready' && !state.busy && !state.pending.length && navigator.onLine !== false); }

  function publish() {
    if (!enabled || !el('cloudPanel')) return;
    const descriptions = {
      starting: ['正在準備雲端連線', '舊資料會保留，不會自動上傳或覆蓋。'],
      'signed-out': ['請登入庫存管家', '登入後才能查看或修改雲端庫存。手機、電腦使用同一個帳號。'],
      loading: ['正在同步', '同步完成前暫停異動，避免使用過期庫存。'],
      setup: ['等待手機首次匯入', '請只在原本管理庫存的手機下載備份並確認匯入；電腦先不要匯入。'],
      ready: ['雲端已連線', '庫存、位置與異動紀錄由手機及電腦共用；每 15 秒及回到頁面時同步。'],
      offline: ['無法同步，暫停異動', '畫面可能是上次同步的資料。請恢復網路後按「重新同步」，沒有改回本機儲存。'],
      denied: ['這個帳號沒有使用權限', '請登出並使用經管理員核准的帳號。'],
      error: ['雲端尚未就緒', '請保留手機舊資料，不要清除瀏覽器資料。']
    };
    const [title, detail] = descriptions[state.mode] || descriptions.error;
    el('cloudPanel').classList.remove('hidden');
    el('cloudStatus').textContent = state.pending.length ? `有 ${state.pending.length} 筆操作需要確認` : title;
    el('cloudDetail').textContent = state.message || (state.pending.length ? '連線中斷可能發生在伺服器儲存後。請按「確認待處理操作」，系統不會重複扣庫存。' : detail);
    el('cloudLoginForm').classList.toggle('hidden', !!state.session);
    el('cloudSignedIn').classList.toggle('hidden', !state.session);
    el('cloudAccount').textContent = state.session?.user.email || '';
    el('cloudLoginButton').disabled = state.busy || !client;
    el('cloudLogoutButton').disabled = state.busy;
    el('cloudRefreshButton').disabled = state.busy || !state.session;
    el('cloudRetryButton').classList.toggle('hidden', !state.pending.length);
    el('cloudRetryButton').disabled = state.busy;
    const needsImport = state.session && state.snapshot && !state.snapshot.initialized && state.snapshot.canImport;
    el('cloudImportPanel').classList.toggle('hidden', !needsImport);
    let count = 0;
    try { count = legacyInventory().materials.length; } catch { /* Backup is still available. */ }
    el('cloudLegacyCount').textContent = `此裝置的舊資料：${count} 項材料。`;
    el('cloudImportButton').disabled = !needsImport || !count || state.busy || state.pending.length > 0
      || !backupSignature || !el('confirmPhoneImport').checked || !el('confirmSavedBackup').checked;
    el('backupCloudButton').classList.toggle('hidden', !state.snapshot?.initialized || !state.session);
    hooks.onStatus?.({ ...state, canWrite: canWrite() });
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot.initialized !== 'boolean' || !Number.isSafeInteger(snapshot.revision)
      || !Array.isArray(snapshot.materials) || !Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.locations)) {
      throw new Error('雲端回傳格式異常，暫停異動。');
    }
    if (snapshot.revision < state.revision) return;
    state.snapshot = copy(snapshot); state.revision = snapshot.revision;
    state.mode = snapshot.initialized ? 'ready' : 'setup';
    state.message = '';
    hooks.applySnapshot?.(snapshot.initialized ? copy(snapshot) : { ...legacyInventory(), preview: true });
  }

  async function refresh() {
    if (!state.session || state.busy || !client) return;
    if (refreshing) return refreshing;
    const current = generation;
    refreshing = (async () => {
      try {
        const { data, error } = await client.rpc('warehouse_snapshot');
        if (current !== generation) return;
        if (error) throw error;
        applySnapshot(data); state.pending = readPending(); publish();
      } catch (error) {
        if (current !== generation) return;
        state.mode = error?.code === '42501' ? 'denied' : state.snapshot ? 'offline' : 'error';
        state.message = errorText(error);
        if (state.mode === 'denied') { state.snapshot = null; hooks.clearSnapshot?.(); }
        publish();
      } finally { if (current === generation) refreshing = undefined; }
    })();
    return refreshing;
  }

  async function acceptSession(session) {
    const previous = state.session?.user.id;
    if (previous && previous === session?.user.id) { state.session = session; return; }
    generation++; refreshing = undefined;
    state.session = session; state.snapshot = null; state.revision = -1; state.message = '';
    state.pending = []; backupSignature = ''; clearInterval(poll);
    el('confirmPhoneImport').checked = false; el('confirmSavedBackup').checked = false;
    hooks.clearSnapshot?.();
    if (!session) { state.mode = 'signed-out'; publish(); return; }
    state.mode = 'loading';
    try { state.pending = readPending(); } catch (error) { state.mode = 'error'; state.message = error.message; publish(); return; }
    publish();
    await refresh();
    poll = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 15000);
  }

  function definitiveFailure(error) {
    // Auth/gateway errors do not prove that a PREVIOUS attempt did not commit.
    // Keep their retry identity until this account can query the ledger again.
    return typeof error?.code === 'string' && (/^(22|23)/.test(error.code)
      || (error.code === 'P0001' && !error.message?.includes('WAREHOUSE_REQUEST_CONFLICT')));
  }

  async function sendRecord(record) {
    const current = generation;
    const { data, error } = await client.rpc('warehouse_mutate', {
      p_request_id: record.id, p_operation: record.operation, p_payload: record.payload
    });
    if (error) {
      if (definitiveFailure(error)) localStorage.removeItem(record.key);
      throw error;
    }
    if (current !== generation) {
      localStorage.removeItem(record.key);
      throw new Error('登入狀態已變更，請重新登入確認結果。');
    }
    applySnapshot(data);
    localStorage.removeItem(record.key);
    return data;
  }

  async function mutate(operation, payload) {
    if (!state.session || state.busy || !client) throw new Error('請先登入並等待同步完成。');
    state.pending = readPending();
    if (state.pending.length) throw new Error('請先確認待處理操作，避免重複異動。');
    if (operation !== 'import_phone' && !canWrite()) throw new Error('目前無法同步，尚未異動庫存。');
    if (operation === 'import_phone' && (state.mode !== 'setup' || !state.snapshot?.canImport)) throw new Error('目前不能首次匯入。');
    const record = { id: crypto.randomUUID(), operation, payload: copy(payload) };
    record.key = `${pendingPrefix()}${record.id}`;
    // Persist BEFORE sending. Storage errors abort rather than losing retry identity.
    localStorage.setItem(record.key, JSON.stringify(record));
    state.busy = true; state.message = ''; state.pending = readPending(); publish();
    try { return await sendRecord(record); }
    catch (error) {
      if (error?.code === '42501') { state.mode = 'denied'; state.snapshot = null; hooks.clearSnapshot?.(); }
      state.message = definitiveFailure(error) ? errorText(error) : '操作結果尚未確認，請重試確認；不要重新新增另一筆異動。';
      throw new Error(state.message);
    } finally {
      state.busy = false; state.pending = readPending(); publish();
    }
  }

  async function retryPending() {
    if (!state.session || state.busy) return;
    state.busy = true; publish();
    try {
      for (const record of readPending()) await sendRecord(record);
      state.message = '待處理操作已確認，沒有重複異動。';
      hooks.onRecovered?.();
    } catch (error) {
      if (error?.code === '42501') { state.mode = 'denied'; state.snapshot = null; hooks.clearSnapshot?.(); }
      state.message = errorText(error);
    }
    finally { state.busy = false; state.pending = readPending(); publish(); }
  }

  async function start(callbacks) {
    if (!enabled) return;
    hooks = callbacks;
    el('backupDeviceButton').addEventListener('click', backupDevice);
    el('backupCloudButton').addEventListener('click', () => {
      if (state.session && state.snapshot?.initialized) download({ format: 'warehouse-cloud-backup', schemaVersion: 1,
        exportedAt: new Date().toISOString(), inventory: state.snapshot }, `庫存管家-雲端備份-${new Date().toISOString().slice(0, 10)}.json`);
    });
    for (const id of ['confirmPhoneImport', 'confirmSavedBackup']) el(id).addEventListener('change', publish);
    el('cloudRefreshButton').addEventListener('click', () => void refresh());
    el('cloudRetryButton').addEventListener('click', () => void retryPending());
    el('cloudImportButton').addEventListener('click', async () => {
      if (!el('confirmPhoneImport').checked || !el('confirmSavedBackup').checked || !backupSignature) return;
      try {
        if (backupSignature !== JSON.stringify(rawLegacy())) throw new Error('舊資料在下載備份後有更新，請重新下載備份並確認。');
        const payload = validateImport(legacyInventory(), callbacks.defaultLocations);
        await mutate('import_phone', payload);
        state.message = '手機資料已匯入，其他裝置登入同一個帳號即可共用。原手機舊資料仍保留。'; publish();
      } catch (error) { state.message = error.message; publish(); }
    });
    el('cloudLoginForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!client || state.busy) return;
      state.busy = true; state.message = ''; publish();
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: el('cloudEmail').value.trim(), password: el('cloudPassword').value
        });
        if (error) throw error;
        el('cloudPassword').value = '';
        state.busy = false;
        await acceptSession(data.session);
      } catch (error) { state.message = errorText(error); }
      finally { state.busy = false; publish(); }
    });
    el('cloudLogoutButton').addEventListener('click', async () => {
      if (!client || state.busy) return;
      state.busy = true; publish();
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        state.busy = false; await acceptSession(null);
      } catch (error) { state.message = errorText(error); }
      finally { state.busy = false; publish(); }
    });
    window.addEventListener('online', () => void refresh());
    window.addEventListener('offline', () => { if (state.session) { state.mode = 'offline'; state.message = ''; publish(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
    window.addEventListener('storage', event => {
      if (state.session && event.key?.startsWith(pendingPrefix())) {
        try { state.pending = readPending(); publish(); } catch { state.mode = 'error'; publish(); }
      }
      if (legacyKeys.includes(event.key)) {
        backupSignature = ''; el('confirmSavedBackup').checked = false; publish();
      }
    });
    window.addEventListener('pagehide', () => clearInterval(poll));
    window.addEventListener('pageshow', () => {
      if (state.session) { clearInterval(poll); poll = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 15000); void refresh(); }
    });
    publish();
    try {
      if (!window.supabase?.createClient || !config?.publishableKey?.startsWith('sb_publishable_')) throw new Error('雲端元件無法載入，請重新整理；尚未異動資料。');
      const timedFetch = async (input, init = {}) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const timer = setTimeout(cancel, 20000);
        init.signal?.addEventListener('abort', cancel, { once: true });
        try { return await fetch(input, { ...init, signal: controller.signal }); }
        finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
      };
      client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: { storageKey: 'inventory-cloud-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: timedFetch }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await acceptSession(data.session);
      client.auth.onAuthStateChange((_event, session) => {
        // Do not await other Supabase methods inside its auth callback (SDK lock).
        setTimeout(() => { void acceptSession(session); }, 0);
      });
    } catch (error) { state.mode = 'error'; state.message = error.message?.startsWith('雲端元件') ? error.message : errorText(error); publish(); }
  }

  window.InventoryCloud = Object.freeze({ start, canWrite, mutate, refresh, backupDevice,
    legacyInventory, validateImport, status: () => ({ ...state, session: !!state.session }) });
})();
