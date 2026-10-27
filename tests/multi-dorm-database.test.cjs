const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.WAREHOUSE_TEST_DEPENDENCIES ? path.join(process.env.WAREHOUSE_TEST_DEPENDENCIES, '@electric-sql/pglite') : '@electric-sql/pglite');

test('Three warehouses preserve all 學七舍 rows/functions and enforce per-warehouse roles, isolation and retries', async () => {
  const db = new PGlite();
  const ids = Array.from({ length: 6 }, (_, i) => `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`);
  const [owner, n7, reader, n1, n2, stranger] = ids;
  let serial = 0;
  const uuid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++serial).padStart(12, '0')}`;
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema auth to anon,authenticated;`);
  for (const id of ids) await db.query('insert into auth.users values($1)', [id]);
  const migrations = fs.readdirSync(path.join(__dirname, '../supabase')).filter(file => /^00[1-6]-.*\.sql$/.test(file)).sort();
  for (const file of migrations.slice(0, 5)) await db.exec(fs.readFileSync(path.join(__dirname, '../supabase', file), 'utf8'));
  await db.query('insert into warehouse_members(user_id,can_import,can_write) values($1,true,true),($2,false,true),($3,false,false)', [owner, n7, reader]);
  async function as(user, fn, role = 'authenticated') {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
      const result = await fn(); await db.exec('commit'); return result;
    } catch (error) { await db.exec('rollback'); throw error; }
  }
  const invoke = (user, name, args = []) => as(user, async () => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value);
  await invoke(owner, 'warehouse_mutate', [uuid(), 'import_phone', JSON.stringify({ schemaVersion: 1, source: 'phone', locations: ['3樓315'], materials: [{ id: 31, name: '學七原材料', stock: 40, alert: 5, spec: '／個', location: '3樓315', detail: '保留' }], transactions: [] })]);
  await invoke(n7, 'warehouse_mutate', [uuid(), 'adjust_stock', JSON.stringify({ materialId: 31, amount: -2, reason: '維修使用', note: '學七原紀錄' })]);
  const tables = ['members', 'state', 'locations', 'materials', 'transactions', 'requests', 'transaction_edits'];
  const capture = async () => Object.fromEntries(await Promise.all(tables.map(async name => [name, (await db.query(`select to_jsonb(t) as row from public.warehouse_${name} t order by to_jsonb(t)::text`)).rows])));
  const baseline = await capture();
  const functions = (await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and proname like 'warehouse_%' order by proname")).rows;
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/006-multiple-dorms.sql'), 'utf8');
  await db.exec(migration);
  assert.deepEqual(await capture(), baseline, 'No d7 stock, history, membership, requests, state or versions changed');
  for (const f of functions) assert((await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and proname like 'warehouse_%'")).rows.some(row => row.definition === f.definition), 'Legacy d7 functions unchanged');
  for (const schema of ['warehouse_pair1', 'warehouse_pair2']) {
    await db.query(`insert into ${schema}.warehouse_members(user_id,can_write) values($1,true),($2,true),($3,false),($4,true)`, [owner, n7, reader, schema.endsWith('1') ? n1 : n2]);
  }
  const catalog = user => invoke(user, 'warehouse_dorms');
  const snapshot = (user, dorm) => invoke(user, 'warehouse_dorm_snapshot', [dorm]);
  const mutate = (user, dorm, operation, payload, request = uuid()) => invoke(user, 'warehouse_dorm_mutate', [dorm, request, operation, JSON.stringify(payload)]);
  assert.deepEqual((await catalog(owner)).map(x => x.id), ['d7', 'pair1', 'pair2']);
  assert.deepEqual((await catalog(n7)).map(x => x.id), ['d7', 'pair1', 'pair2']);
  assert.deepEqual((await catalog(reader)).map(x => [x.id, x.canWrite]), [['d7', false], ['pair1', false], ['pair2', false]]);
  assert.deepEqual((await catalog(n1)).map(x => x.id), ['pair1']);
  assert.deepEqual((await catalog(n2)).map(x => x.id), ['pair2']);
  assert.deepEqual(await catalog(stranger), []);
  for (const dorm of ['pair1', 'pair2']) {
    const empty = await snapshot(owner, dorm);
    assert.equal(empty.initialized, true); assert.equal(empty.canImport, false); assert.equal(empty.revision, 0);
    for (const key of ['materials', 'archivedMaterials', 'locations', 'transactions']) assert.deepEqual(empty[key], []);
  }
  for (const [user, allowed] of [[n1, 'pair1'], [n2, 'pair2']]) {
    for (const dorm of ['d7', 'pair1', 'pair2'].filter(d => d !== allowed)) {
      await assert.rejects(snapshot(user, dorm), /WAREHOUSE_ACCESS_DENIED/);
      await assert.rejects(mutate(user, dorm, 'add_location', { name: '越權' }), /WAREHOUSE_ACCESS_DENIED/);
    }
    await assert.rejects(invoke(user, 'warehouse_snapshot'), /WAREHOUSE_ACCESS_DENIED/);
    assert.equal((await as(user, () => db.query('select * from public.warehouse_materials'))).rows.length, 0);
  }
  await assert.rejects(snapshot(owner, "pair1'; drop schema public cascade;--"), /WAREHOUSE_ACCESS_DENIED/);
  for (const dorm of ['d7', 'pair1', 'pair2']) {
    for (const operation of ['add_location', 'delete_location', 'save_material', 'archive_material', 'adjust_stock', 'edit_transaction', 'import_phone']) await assert.rejects(mutate(reader, dorm, operation, {}), /WAREHOUSE_READ_ONLY/);
  }
  for (const user of [owner, reader, n1, n2, stranger]) {
    for (const schema of ['warehouse_pair1', 'warehouse_pair2']) {
      for (const query of [`select * from ${schema}.warehouse_materials`, `update ${schema}.warehouse_members set can_write=true`, `select ${schema}.warehouse_mutate(null,'add_location','{}')`]) await assert.rejects(as(user, () => db.query(query)), { code: '42501' });
    }
  }
  const request = uuid();
  for (const [user, dorm] of [[n1, 'pair1'], [n2, 'pair2']]) {
    await mutate(user, dorm, 'add_location', { name: '1樓' }, request);
    await mutate(user, dorm, 'save_material', { name: '同名燈泡', category: '', unit: '', stock: 12, alert: 3, location: '1樓', detail: '' });
  }
  assert.equal((await snapshot(n1, 'pair1')).materials[0].id, (await snapshot(n2, 'pair2')).materials[0].id, 'Overlapping material IDs are isolated');
  const otherBefore = await snapshot(n2, 'pair2');
  const adjustment = { materialId: 1, amount: -2, reason: '維修使用', note: '101' };
  const receipt = uuid();
  let data = await mutate(n1, 'pair1', 'adjust_stock', adjustment, receipt);
  assert.equal(data.materials[0].stock, 10);
  assert.deepEqual(await mutate(n1, 'pair1', 'adjust_stock', adjustment, receipt), data, 'Retry does not double deduct');
  await assert.rejects(mutate(n1, 'pair1', 'adjust_stock', { ...adjustment, amount: -20 }), /WAREHOUSE_INSUFFICIENT_STOCK/);
  await assert.rejects(mutate(n1, 'pair1', 'delete_location', { name: '1樓' }), /WAREHOUSE_LOCATION_IN_USE/);
  data = await mutate(n1, 'pair1', 'edit_transaction', { transactionId: data.transactions[0].id, version: 1, quantity: 1, reason: '維修使用', note: '102' });
  assert.equal(data.materials[0].stock, 11); assert.equal(data.transactions[0].editHistory.length, 1);
  await assert.rejects(mutate(n1, 'pair1', 'save_material', { id: 1, version: 1, name: '過期編輯', alert: 3, location: '1樓' }), /WAREHOUSE_EDIT_CONFLICT/);
  data = await mutate(n1, 'pair1', 'archive_material', { id: 1, version: data.materials[0].version });
  assert.equal(data.materials.length, 0); assert.equal(data.archivedMaterials[0].stock, 11);
  assert.equal(data.transactions.length, 1);
  assert.deepEqual(await snapshot(n2, 'pair2'), otherBefore, 'Operations in pair1 never touch pair2');
  await db.exec(migration);
  assert.deepEqual(await snapshot(n1, 'pair1'), data, 'Reapply preserves new warehouse too');
  assert.deepEqual(await capture(), baseline, 'All new-warehouse operations leave 學七舍 byte-for-byte unchanged');
  await assert.rejects(as(null, () => db.query('select public.warehouse_dorms()'), 'anon'), { code: '42501' });
  await db.close();
});
