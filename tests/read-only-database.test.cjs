const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dependencies = process.env.WAREHOUSE_TEST_DEPENDENCIES;
const { PGlite } = require(dependencies ? path.join(dependencies, '@electric-sql/pglite') : '@electric-sql/pglite');

test('Read-only members can read the entire warehouse but cannot write through RPC, helpers, tables, or self-upgrade', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const writer = '22222222-2222-4222-8222-222222222222';
  const reader = '33333333-3333-4333-8333-333333333333';
  const stranger = '44444444-4444-4444-8444-444444444444';
  let next = 1;
  const uuid = () => `cccccccc-cccc-4ccc-8ccc-${String(next++).padStart(12, '0')}`;
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${owner}'),('${writer}'),('${reader}'),('${stranger}');`);
  for (const file of ['001-warehouse.sql', '002-optional-fields-and-location-delete.sql', '003-material-archive.sql', '004-transaction-edit.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase', file), 'utf8'));
  }
  await db.query('insert into warehouse_members(user_id,can_import) values ($1,true),($2,false)', [owner, writer]);
  async function as(role, user, fn) {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
      const result = await fn(); await db.exec('commit'); return result;
    } catch (error) { await db.exec('rollback'); throw error; }
  }
  const snapshot = (user = owner) => as('authenticated', user, async () => (await db.query('select warehouse_snapshot() as value')).rows[0].value);
  const mutate = (operation, payload, user = owner, request = uuid()) => as('authenticated', user,
    async () => (await db.query('select warehouse_mutate($1,$2,$3::jsonb) as value', [request, operation, JSON.stringify(payload)])).rows[0].value);
  const imported = { schemaVersion: 1, source: 'phone', locations: ['1樓', '12樓東'], materials: [
    { id: 1, name: '材料', spec: '／個', stock: 12, alert: 2, location: '1樓', detail: '' },
    { id: 2, name: '封存材料', spec: '／', stock: 5, alert: null, location: '12樓東', detail: '' }
  ], transactions: [] };
  await mutate('import_phone', imported);
  await mutate('adjust_stock', { materialId: 1, amount: -3, reason: '維修使用', note: '315' });
  let data = await snapshot();
  await mutate('edit_transaction', { transactionId: data.transactions[0].id, version: 1, quantity: 2, reason: '維修使用', note: '316' });
  await mutate('archive_material', { id: 2, version: 1 });
  const before = await snapshot();
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/005-read-only-members.sql'), 'utf8');
  await db.exec(migration);
  data = await snapshot();
  const { canWrite, ...unchanged } = data;
  assert.equal(canWrite, true); assert.deepEqual(unchanged, before, 'Migration preserves all inventory, event, audit and import values');
  assert.equal((await snapshot(writer)).canWrite, true, 'Existing non-importing writers remain writers');
  await db.query('insert into warehouse_members(user_id) values ($1)', [reader]);
  const view = await snapshot(reader);
  assert.equal(view.canWrite, false); assert.equal(view.canImport, false);
  for (const key of ['materials', 'archivedMaterials', 'transactions', 'locations', 'revision']) assert.deepEqual(view[key], data[key]);
  assert.equal(view.transactions[0].editHistory.length, 1);
  const tables = ['warehouse_members', 'warehouse_state', 'warehouse_materials', 'warehouse_locations', 'warehouse_transactions', 'warehouse_transaction_edits', 'warehouse_requests'];
  const capture = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.query(`select row_to_json(t) as value from public.${table} t order by row_to_json(t)::text`)).rows])));
  const baseline = await capture();
  const operations = [
    ['adjust_stock', { materialId: 1, amount: -1, reason: '維修使用', note: 'not allowed' }],
    ['adjust_stock', { materialId: 1, amount: 1, reason: '入庫補貨', note: '' }],
    ['save_material', { name: '新材料', category: '', unit: '', stock: 2, alert: 1, location: '1樓', detail: '' }],
    ['save_material', { id: 1, version: data.materials[0].version, name: '改名', category: '', unit: '', alert: 2, location: '12樓東', detail: '' }],
    ['archive_material', { id: 1, version: data.materials[0].version }],
    ['add_location', { name: '新位置' }], ['delete_location', { name: '1樓' }],
    ['edit_transaction', { transactionId: data.transactions[0].id, version: 2, quantity: 1, reason: '入庫補貨', note: '' }],
    ['import_phone', imported], ['unknown_operation', {}]
  ];
  for (const [operation, payload] of operations) await assert.rejects(mutate(operation, payload, reader), { code: '42501', message: 'WAREHOUSE_READ_ONLY' });
  for (const helper of ['warehouse_mutate_before_read_only', 'warehouse_mutate_before_transaction_edit', 'warehouse_mutate_before_archive']) {
    for (const user of [reader, writer]) await assert.rejects(as('authenticated', user,
      () => db.query(`select ${helper}($1,$2,$3::jsonb)`, [uuid(), 'adjust_stock', JSON.stringify(operations[0][1])])), { code: '42501' });
  }
  for (const table of tables) {
    await assert.rejects(as('authenticated', reader, () => db.query(`delete from public.${table}`)), { code: '42501' });
  }
  for (const query of ["update warehouse_members set can_write=true,can_import=true", 'update warehouse_materials set stock=999', "insert into warehouse_locations values ('非法位置')", 'insert into warehouse_members(user_id,can_write) values ($1,true)']) {
    await assert.rejects(as('authenticated', reader, () => db.query(query, query.includes('$1') ? [stranger] : [])), { code: '42501' });
  }
  assert.deepEqual(await capture(), baseline, 'All denied requests leave stocks, history, permission and retry ledger unchanged');
  for (const table of tables.filter(name => name !== 'warehouse_requests')) {
    assert((await as('authenticated', reader, () => db.query(`select * from public.${table}`))).rows.length > 0);
    assert.equal((await as('authenticated', stranger, () => db.query(`select * from public.${table}`))).rows.length, 0);
  }
  await assert.rejects(snapshot(stranger), /WAREHOUSE_ACCESS_DENIED/);
  await assert.rejects(as('anon', null, () => db.query('select warehouse_snapshot()')), { code: '42501' });
  await assert.rejects(as('anon', null, () => db.query('select warehouse_mutate($1,$2,$3::jsonb)', [uuid(), 'add_location', '{}'])), { code: '42501' });
  await db.query('update warehouse_members set can_import=true where user_id=$1', [reader]);
  assert.equal((await snapshot(reader)).canImport, false, 'Even a stale import flag cannot bypass read-only');
  await assert.rejects(mutate('import_phone', imported, reader), /WAREHOUSE_READ_ONLY/);
  const receipt = uuid(), payload = { materialId: 1, amount: -1, reason: '維修使用', note: '' };
  await mutate('adjust_stock', payload, writer, receipt);
  await db.query('update warehouse_members set can_write=false where user_id=$1', [writer]);
  const downgraded = await capture();
  const replay = await mutate('adjust_stock', payload, writer, receipt);
  assert.equal(replay.canWrite, false);
  assert.deepEqual(await capture(), downgraded, 'An exact committed receipt is readable without a new write');
  await assert.rejects(mutate('adjust_stock', { ...payload, amount: 1 }, writer, receipt), /WAREHOUSE_READ_ONLY/);
  await assert.rejects(mutate('adjust_stock', payload, reader, receipt), /WAREHOUSE_READ_ONLY/);
  await assert.rejects(mutate('adjust_stock', payload, writer), /WAREHOUSE_READ_ONLY/);
  await db.exec(migration);
  assert.deepEqual(await capture(), downgraded, 'Reapplying 005 preserves reader permissions and all data');
  assert.equal((await snapshot(writer)).canWrite, false);
  data = await mutate('add_location', { name: '管理員可新增' });
  assert(data.locations.includes('管理員可新增'), 'Original writer still works');
  await db.close();
});
