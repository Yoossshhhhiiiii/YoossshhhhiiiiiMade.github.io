const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dependencies = process.env.WAREHOUSE_TEST_DEPENDENCIES;
const { PGlite } = require(dependencies ? path.join(dependencies, '@electric-sql/pglite') : '@electric-sql/pglite');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const requestId = number => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`;

test('Postgres security, atomic stock changes, retry identity and one-time phone migration', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users(id) values ('${owner}'), ('${other}');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/001-warehouse.sql'), 'utf8'));
  await db.query('insert into warehouse_members(user_id, can_import) values ($1, true)', [owner]);
  async function as(role, uid, callback) {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
      const result = await callback();
      await db.exec('commit');
      return result;
    } catch (error) { await db.exec('rollback'); throw error; }
  }
  const snapshot = uid => as('authenticated', uid, async () => (await db.query('select warehouse_snapshot() as data')).rows[0].data);
  const mutate = (id, operation, payload, uid = owner) => as('authenticated', uid, async () =>
    (await db.query('select warehouse_mutate($1, $2, $3::jsonb) as data', [requestId(id), operation, JSON.stringify(payload)])).rows[0].data);
  for (const table of ['warehouse_members', 'warehouse_state', 'warehouse_locations', 'warehouse_materials', 'warehouse_transactions', 'warehouse_requests']) {
    await assert.rejects(as('anon', null, () => db.query(`select * from ${table}`)), { code: '42501' });
  }
  await assert.rejects(as('anon', null, () => db.query('select warehouse_snapshot()')), { code: '42501' });
  await assert.rejects(snapshot(other), /WAREHOUSE_ACCESS_DENIED/);
  await assert.rejects(mutate(1, 'add_location', { name: '3樓315' }, other), /WAREHOUSE_ACCESS_DENIED/);
  const directRead = await as('authenticated', other, () => db.query('select * from warehouse_state'));
  assert.equal(directRead.rows.length, 0, 'Unapproved signed-in users cannot see shared warehouse data');
  await assert.rejects(as('authenticated', owner, () => db.query('update warehouse_state set initialized = true')), { code: '42501' });
  await assert.rejects(as('authenticated', owner, () => db.query('insert into warehouse_members(user_id) values ($1)', [other])), { code: '42501' });
  assert.equal((await snapshot(owner)).initialized, false);
  await assert.rejects(mutate(2, 'add_location', { name: '3樓315' }), /WAREHOUSE_NOT_INITIALIZED/);
  const phone = {
    schemaVersion: 1, source: 'phone', locations: ['1樓', '3樓315'],
    materials: [{ id: 7, name: '手機材料', spec: '管件／個', stock: 9, alert: 2, location: '3樓315', detail: '' },
      { id: 3, name: '照片待設定材料', spec: '／', stock: 100, alert: null, location: '1樓', detail: '' }],
    transactions: [{ materialId: 7, materialName: '舊名稱', unit: '個', amount: 2, type: '減少',
      time: '2026-10-07T03:00:00.000Z', reason: '維修使用', note: '315' }]
  };
  const invalid = structuredClone(phone); invalid.transactions[0].materialId = 999;
  await assert.rejects(mutate(3, 'import_phone', invalid), /WAREHOUSE_ORPHAN_TRANSACTION/);
  assert.equal((await snapshot(owner)).materials.length, 0, 'Failed import rolls back ALL materials and locations');
  let data = await mutate(4, 'import_phone', phone);
  assert.equal(data.initialized, true);
  assert.equal(data.materials.find(item => item.id === 7).stock, 9, 'History must NOT be applied to stock again');
  assert.equal(data.materials.find(item => item.id === 3).alert, null);
  assert.equal(data.transactions[0].materialName, '舊名稱');
  assert.equal(data.transactions[0].note, '315');
  const beforeUpgrade = structuredClone(data);
  const upgrade = fs.readFileSync(path.join(__dirname, '../supabase/002-optional-fields-and-location-delete.sql'), 'utf8');
  await db.exec(upgrade);
  await db.exec(upgrade);
  assert.deepEqual(await snapshot(owner), beforeUpgrade, 'Upgrade is repeatable and changes no stock, history, locations, revision or import rights');
  assert.equal((await mutate(4, 'import_phone', phone)).revision, data.revision, 'Import retry is a no-op');
  await assert.rejects(mutate(5, 'import_phone', phone), /WAREHOUSE_ALREADY_INITIALIZED/);
  await assert.rejects(as('authenticated', owner, () => db.query('update warehouse_materials set stock = 0')), { code: '42501' });
  await assert.rejects(as('authenticated', owner, () => db.query('select * from warehouse_requests')), { code: '42501' });
  await assert.rejects(mutate(6, 'adjust_stock', { materialId: 7, amount: -10, reason: '維修使用', note: '' }), /WAREHOUSE_INSUFFICIENT_STOCK/);
  assert.equal((await snapshot(owner)).transactions.length, 1, 'Insufficient stock creates no history');
  const adjustment = { materialId: 7, amount: -2, reason: '維修使用', note: '315' };
  data = await mutate(7, 'adjust_stock', adjustment);
  assert.equal(data.materials.find(item => item.id === 7).stock, 7);
  assert.equal(data.transactions.length, 2);
  assert.equal((await mutate(7, 'adjust_stock', adjustment)).materials.find(item => item.id === 7).stock, 7, 'Duplicate retry never deducts twice');
  await assert.rejects(mutate(7, 'adjust_stock', { ...adjustment, amount: -1 }), /WAREHOUSE_REQUEST_CONFLICT/);
  const edit = { id: 7, version: 1, name: '改名', category: '管件', unit: '個', stock: 999, alert: 3, location: '3樓315', detail: '' };
  await assert.rejects(mutate(8, 'save_material', edit), /WAREHOUSE_EDIT_CONFLICT/);
  data = await mutate(9, 'save_material', { ...edit, version: 2 });
  assert.equal(data.materials.find(item => item.id === 7).stock, 7, 'Metadata edit never overwrites stock');
  assert.equal(data.transactions[0].materialName, '舊名稱', 'History retains its material name at event time');
  data = await mutate(10, 'save_material', { id: null, name: '新材料', category: '耗材', unit: '個', stock: 5, alert: 1, location: '1樓', detail: '' });
  assert.equal(data.materials.find(item => item.name === '新材料').id, 8, 'New IDs continue after imported legacy IDs');
  await assert.rejects(mutate(11, 'save_material', { id: null, name: '新材料', category: '耗材', unit: '個', stock: 5, alert: 1, location: '1樓', detail: '' }), { code: '23505' });
  await assert.rejects(mutate(12, 'adjust_stock', { ...adjustment, reason: '任意原因' }), /WAREHOUSE_INVALID_INPUT/);
  await assert.rejects(mutate(13, 'adjust_stock', { ...adjustment, amount: -10000000000 }), { code: '22003' });
  data = await mutate(14, 'adjust_stock', { ...adjustment, amount: -3 });
  data = await mutate(15, 'adjust_stock', { ...adjustment, amount: -4 });
  assert.equal(data.materials.find(item => item.id === 7).stock, 0, 'Separate devices deduct against current server stock');
  await assert.rejects(mutate(16, 'adjust_stock', adjustment), /WAREHOUSE_INSUFFICIENT_STOCK/);
  await assert.rejects(as('anon', null, () => db.query('select warehouse_mutate($1,$2,$3::jsonb)', [requestId(20), 'delete_location', '{"name":"1樓"}'])), { code: '42501' });
  await assert.rejects(mutate(20, 'delete_location', { name: '1樓' }, other), /WAREHOUSE_ACCESS_DENIED/);
  await assert.rejects(as('authenticated', owner, () => db.query("delete from warehouse_locations where name='1樓'")), { code: '42501' });
  const beforeOccupiedDelete = await snapshot(owner);
  await assert.rejects(mutate(21, 'delete_location', { name: '3樓315' }), /WAREHOUSE_LOCATION_IN_USE/);
  assert.deepEqual(await snapshot(owner), beforeOccupiedDelete, 'Zero-stock materials still protect their location; failed delete changes nothing');

  await db.query('insert into warehouse_members(user_id, can_import) values ($1, false)', [other]);
  await assert.rejects(mutate(22, 'import_phone', phone, other), /WAREHOUSE_IMPORT_NOT_ALLOWED/);
  let nextRequest = 23;
  for (const [category, unit, expected] of [['', '', '／'], ['規格', '', '規格／'], ['', '個', '／個'], [null, null, '／'], [undefined, undefined, '／']]) {
    const payload = { id: null, name: `選填材料${nextRequest}`, category, unit, stock: 4, alert: 1, location: '1樓', detail: '' };
    data = await mutate(nextRequest++, 'save_material', payload, other);
    assert.equal(data.materials.find(item => item.name === payload.name).spec, expected);
  }
  const optionalItem = data.materials.find(item => item.name.startsWith('選填材料'));
  data = await mutate(nextRequest++, 'save_material', { id: optionalItem.id, version: optionalItem.version, name: optionalItem.name, category: '', unit: '', stock: 999, alert: 1, location: '1樓', detail: '' }, other);
  assert.equal(data.materials.find(item => item.id === optionalItem.id).stock, 4, 'Optional metadata edit never rewrites stock');
  data = await mutate(nextRequest++, 'adjust_stock', { materialId: optionalItem.id, amount: -1, reason: '維修使用', note: '315' }, other);
  assert.equal(data.transactions.at(-1).unit, '', 'No inferred unit when omitted');
  const valid = { id: null, name: '邊界材料', stock: 0, alert: 0, location: '1樓', detail: '' };
  for (const invalid of [{ category: 'a'.repeat(81) }, { unit: 'a'.repeat(21) }, { category: [] }, { unit: 123 }, { name: '' }, { alert: null }]) {
    await assert.rejects(mutate(nextRequest++, 'save_material', { ...valid, ...invalid }), /WAREHOUSE_INVALID_INPUT/);
  }
  for (const name of ['', '全部位置', 123, [], 'a'.repeat(41)]) {
    await assert.rejects(mutate(nextRequest++, 'delete_location', { name }), /WAREHOUSE_INVALID_INPUT/);
  }
  await assert.rejects(mutate(nextRequest++, 'delete_location', { name: '不存在的位置' }), /WAREHOUSE_LOCATION_NOT_FOUND/);
  data = await mutate(nextRequest++, 'add_location', { name: '12樓東' });
  const beforeEmptyDelete = structuredClone(data);
  const deleteRequest = nextRequest++;
  data = await mutate(deleteRequest, 'delete_location', { name: '12樓東' }, other);
  assert(!data.locations.includes('12樓東'));
  assert.deepEqual(data.materials, beforeEmptyDelete.materials);
  assert.deepEqual(data.transactions, beforeEmptyDelete.transactions);
  assert.equal((await mutate(deleteRequest, 'delete_location', { name: '12樓東' }, other)).revision, data.revision, 'Deletion retry applies once');
  await assert.rejects(mutate(nextRequest++, 'save_material', { ...valid, location: '12樓東' }), { code: '23503' });
  await mutate(nextRequest++, 'add_location', { name: '12樓東' });
  data = await mutate(deleteRequest, 'delete_location', { name: '12樓東' }, other);
  assert(data.locations.includes('12樓東'), 'An old delete retry cannot delete a newly recreated location');
  await mutate(nextRequest++, 'save_material', { ...valid, location: '12樓東' }, other);
  await assert.rejects(mutate(nextRequest++, 'delete_location', { name: '12樓東' }), /WAREHOUSE_LOCATION_IN_USE/, 'Another device adding material after a stale preview blocks deletion');
  assert.equal((await snapshot(other)).canImport, false, 'Location management grants no import permission');
  const beforeArchiveUpgrade = await snapshot(owner);
  const archiveUpgrade = fs.readFileSync(path.join(__dirname, '../supabase/003-material-archive.sql'), 'utf8');
  await db.exec(archiveUpgrade); await db.exec(archiveUpgrade);
  assert.deepEqual(await snapshot(owner), { ...beforeArchiveUpgrade, archivedMaterials: [] }, 'Archive migration changes no existing data and is repeatable');
  await assert.rejects(as('authenticated', owner, () => db.query('select warehouse_mutate_before_archive($1,$2,$3)', [requestId(nextRequest++), 'adjust_stock', '{}'])), { code: '42501' }, 'Private helper cannot bypass archive protection');
  await assert.rejects(as('anon', null, () => db.query('select warehouse_mutate($1,$2,$3)', [requestId(nextRequest++), 'archive_material', '{}'])), { code: '42501' });
  const archiveItem = (await snapshot(owner)).materials.find(item => item.id === optionalItem.id);
  for (const payload of [{}, { id: archiveItem.id }, { id: '1', version: 1 }, { id: archiveItem.id, version: 1.5 }]) {
    await assert.rejects(mutate(nextRequest++, 'archive_material', payload), /WAREHOUSE_INVALID_INPUT/);
  }
  const beforeBadArchive = await snapshot(owner);
  await assert.rejects(mutate(nextRequest++, 'archive_material', { id: archiveItem.id, version: archiveItem.version - 1 }), /WAREHOUSE_EDIT_CONFLICT/);
  assert.deepEqual(await snapshot(owner), beforeBadArchive, 'A stale delete cannot remove a recently adjusted material');
  const archiveRequest = nextRequest++;
  const archivePayload = { id: archiveItem.id, version: archiveItem.version };
  data = await mutate(archiveRequest, 'archive_material', archivePayload, other);
  assert(!data.materials.some(item => item.id === archiveItem.id));
  const archived = data.archivedMaterials.find(item => item.id === archiveItem.id);
  assert.equal(archived.stock, archiveItem.stock, 'Archive is not a stock adjustment');
  assert(archived.archivedAt); assert.equal(archived.version, archiveItem.version + 1);
  assert.deepEqual(data.transactions, beforeBadArchive.transactions, 'Every historical record and monthly usage remains unchanged');
  assert.equal((await mutate(archiveRequest, 'archive_material', archivePayload, other)).revision, data.revision, 'Delete retry is idempotent');
  await assert.rejects(mutate(archiveRequest, 'archive_material', { ...archivePayload, version: 99 }, other), /WAREHOUSE_REQUEST_CONFLICT/);
  await assert.rejects(mutate(nextRequest++, 'adjust_stock', { materialId: archiveItem.id, amount: 1, reason: '入庫補貨' }), /WAREHOUSE_MATERIAL_NOT_FOUND/);
  await assert.rejects(mutate(nextRequest++, 'save_material', { ...valid, id: archiveItem.id, version: archived.version }), /WAREHOUSE_MATERIAL_NOT_FOUND/);
  await assert.rejects(mutate(nextRequest++, 'archive_material', { id: archiveItem.id, version: archived.version }), /WAREHOUSE_MATERIAL_NOT_FOUND/);
  await assert.rejects(mutate(nextRequest++, 'delete_location', { name: archiveItem.location }), /WAREHOUSE_LOCATION_HAS_ARCHIVE/);
  data = await mutate(nextRequest++, 'save_material', { ...valid, name: archiveItem.name, location: archiveItem.location });
  const recreated = data.materials.find(item => item.name === archiveItem.name);
  assert.notEqual(recreated.id, archiveItem.id, 'Reused name gets a new ID; old history stays with original');
  const recreatedRevision = data.revision;
  data = await mutate(archiveRequest, 'archive_material', archivePayload, other);
  assert.equal(data.revision, recreatedRevision); assert(data.materials.some(item => item.id === recreated.id), 'Old delete retry never deletes a new same-name material');
  await assert.rejects(as('authenticated', owner, () => db.query('update warehouse_materials set archived_at = now()')), { code: '42501' });
  await db.query('delete from warehouse_members where user_id = $1', [owner]);
  await assert.rejects(snapshot(owner), /WAREHOUSE_ACCESS_DENIED/);
  await assert.rejects(mutate(nextRequest++, 'archive_material', { id: recreated.id, version: recreated.version }), /WAREHOUSE_ACCESS_DENIED/);
  await db.close();
});
