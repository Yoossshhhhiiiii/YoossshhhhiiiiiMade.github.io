const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dependencies = process.env.WAREHOUSE_TEST_DEPENDENCIES;
const { PGlite } = require(dependencies ? path.join(dependencies, '@electric-sql/pglite') : '@electric-sql/pglite');

test('Transaction correction migration, delta math, audit, permissions, concurrency versions and retry identity', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const stranger = '33333333-3333-4333-8333-333333333333';
  let next = 1;
  const uuid = () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(next++).padStart(12, '0')}`;
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${owner}'),('${other}'),('${stranger}');`);
  for (const file of ['001-warehouse.sql', '002-optional-fields-and-location-delete.sql', '003-material-archive.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase', file), 'utf8'));
  }
  await db.query('insert into warehouse_members values ($1,true),($2,false)', [owner, other]);
  async function as(role, user, fn) {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
      const result = await fn(); await db.exec('commit'); return result;
    } catch (error) { await db.exec('rollback'); throw error; }
  }
  const snapshot = (user = owner) => as('authenticated', user, async () => (await db.query('select warehouse_snapshot() as value')).rows[0].value);
  const mutate = (operation, payload, request = uuid(), user = owner) => as('authenticated', user, async () => (await db.query('select warehouse_mutate($1,$2,$3::jsonb) as value', [request, operation, JSON.stringify(payload)])).rows[0].value);
  await mutate('import_phone', { schemaVersion: 1, source: 'phone', locations: ['1樓'], materials: [{ id: 1, name: '材料', spec: '／個', stock: 12, alert: 2, location: '1樓', detail: '' }, { id: 2, name: '其他材料', spec: '／', stock: 5, alert: null, location: '1樓', detail: '' }], transactions: [] });
  await mutate('adjust_stock', { materialId: 1, amount: -3, reason: '維修使用', note: '315' });
  const beforeMigration = await snapshot();
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/004-transaction-edit.sql'), 'utf8');
  await db.exec(migration);
  let data = await snapshot();
  assert.deepEqual(data.materials, beforeMigration.materials);
  assert.equal(data.revision, beforeMigration.revision);
  assert.equal(data.canImport, beforeMigration.canImport);
  assert.deepEqual(data.transactions.map(({ version, editHistory, ...record }) => record), beforeMigration.transactions);
  assert(data.features.transactionEdit); assert.equal(data.transactions[0].version, 1); assert.deepEqual(data.transactions[0].editHistory, []);
  await db.exec(migration); assert.deepEqual(await snapshot(), data, 'Applying 004 twice changes no data');
  const record = data.transactions[0];
  const payload = { transactionId: record.id, version: 1, quantity: 2, reason: '維修使用', note: '316' };
  for (const helper of ['warehouse_mutate_before_transaction_edit', 'warehouse_mutate_before_archive']) {
    await assert.rejects(as('authenticated', owner, () => db.query(`select ${helper}($1,$2,$3::jsonb)`, [uuid(), 'edit_transaction', JSON.stringify(payload)])), { code: '42501' });
  }
  await assert.rejects(as('anon', null, () => db.query('select warehouse_mutate($1,$2,$3::jsonb)', [uuid(), 'edit_transaction', JSON.stringify(payload)])), { code: '42501' });
  await assert.rejects(mutate('edit_transaction', payload, uuid(), stranger), /WAREHOUSE_ACCESS_DENIED/);
  const request = uuid();
  data = await mutate('edit_transaction', payload, request, other);
  const updated = () => data.transactions.find(item => item.id === record.id);
  assert.equal(data.materials[0].stock, 10, 'Consume 3 -> consume 2 returns only one item');
  assert.equal(data.transactions.length, 1); assert.equal(updated().amount, 2); assert.equal(updated().version, 2);
  assert.equal(updated().time, record.time); assert.equal(updated().materialName, record.materialName); assert.equal(updated().unit, record.unit);
  assert.deepEqual(updated().editHistory[0].before, { amount: 3, type: '減少', reason: '維修使用', note: '315', version: 1 });
  assert.equal(updated().editHistory[0].after.note, '316'); assert.equal(updated().editHistory[0].stockBefore, 9); assert.equal(updated().editHistory[0].stockAfter, 10);
  assert.equal((await db.query('select edited_by from warehouse_transaction_edits')).rows[0].edited_by, other);
  assert.deepEqual(await mutate('edit_transaction', payload, request, other), data, 'Lost-response retry does not edit or adjust twice');
  assert.equal(data.canImport, false, 'Correction grants no import rights');
  data = await snapshot();
  await assert.rejects(mutate('edit_transaction', { ...payload, quantity: 4 }, request, other), /WAREHOUSE_REQUEST_CONFLICT/);
  await assert.rejects(mutate('edit_transaction', payload, uuid(), owner), /WAREHOUSE_TRANSACTION_EDIT_CONFLICT/);
  assert.deepEqual(await snapshot(), data, 'Stale device cannot overwrite an edit');
  const noOp = await mutate('edit_transaction', { ...payload, version: 2 });
  assert.deepEqual(noOp, data, 'No-op does not create audit noise or bump stock/version');
  data = await mutate('edit_transaction', { ...payload, version: 2, note: '317' });
  assert.equal(data.materials[0].stock, 10); assert.equal(updated().version, 3); assert.equal(updated().editHistory.length, 2);
  data = await mutate('edit_transaction', { ...payload, version: 3, quantity: 4, reason: '入庫補貨' });
  assert.equal(data.materials[0].stock, 16, 'Undo old -2 and apply new +4');
  assert.equal(updated().type, '增加'); assert.equal(updated().amount, 4); assert.equal(updated().version, 4);
  await mutate('adjust_stock', { materialId: 1, amount: -15, reason: '維修使用', note: '' });
  data = await mutate('edit_transaction', { ...payload, version: 4, quantity: 3, reason: '入庫補貨' });
  assert.equal(data.materials[0].stock, 0, 'Reducing previous restock uses current stock');
  const beforeFailure = structuredClone(data);
  await assert.rejects(mutate('edit_transaction', { ...payload, version: 5, quantity: 1 }), /WAREHOUSE_INSUFFICIENT_STOCK/);
  assert.deepEqual(await snapshot(), beforeFailure, 'Invalid correction rolls back stock, original record and audit together');
  for (const changed of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: '2' }, { quantity: 2147483648 }, { version: 0 }, { version: 1.5 }, { version: '5' }, { reason: '任意原因' }, { note: null }, { note: {} }, { note: 'x'.repeat(2001) }]) {
    await assert.rejects(mutate('edit_transaction', { ...payload, version: 5, ...changed }), /WAREHOUSE_INVALID_INPUT/);
  }
  await assert.rejects(mutate('edit_transaction', { ...payload, transactionId: uuid() }), /WAREHOUSE_TRANSACTION_NOT_FOUND/);
  assert.deepEqual(await snapshot(), beforeFailure);
  const rls = await as('authenticated', stranger, () => db.query('select * from warehouse_transaction_edits'));
  assert.equal(rls.rows.length, 0);
  await assert.rejects(as('anon', null, () => db.query('select * from warehouse_transaction_edits')), { code: '42501' });
  for (const query of ['delete from warehouse_transaction_edits', 'update warehouse_transaction_edits set before_value=\'{}\'::jsonb', 'update warehouse_transactions set amount=1']) {
    await assert.rejects(as('authenticated', owner, () => db.query(query)), { code: '42501' });
  }
  data = await mutate('adjust_stock', { materialId: 2, amount: -1, reason: '維修使用', note: '' });
  const second = data.transactions.find(item => item.materialId === 2);
  await db.exec('update warehouse_materials set stock=2147483647 where id=2');
  await assert.rejects(mutate('edit_transaction', { transactionId: second.id, version: 1, quantity: 1, reason: '入庫補貨', note: '' }), /WAREHOUSE_STOCK_OVERFLOW/);
  data = await mutate('edit_transaction', { transactionId: second.id, version: 1, quantity: 2147483647, reason: '維修使用', note: '' });
  assert.equal(data.materials.find(item => item.id === 2).stock, 1);
  await assert.rejects(mutate('edit_transaction', { transactionId: second.id, version: 2, quantity: 2147483647, reason: '入庫補貨', note: '' }), /WAREHOUSE_STOCK_OVERFLOW/, 'Signed differences use bigint before stock range validation');
  const item = data.materials.find(item => item.id === 2);
  data = await mutate('archive_material', { id: 2, version: item.version });
  const beforeArchiveEdit = structuredClone(data);
  await assert.rejects(mutate('edit_transaction', { transactionId: second.id, version: 2, quantity: 1, reason: '維修使用', note: '' }), /WAREHOUSE_MATERIAL_NOT_FOUND/);
  assert.deepEqual(await snapshot(), beforeArchiveEdit, 'Archived inventory is not resurrected by correcting its event');
  await db.query('delete from warehouse_members where user_id=$1', [other]);
  await assert.rejects(mutate('edit_transaction', { ...payload, version: 5 }, uuid(), other), /WAREHOUSE_ACCESS_DENIED/);
  await db.close();
});
