// Generate isolated, private warehouses from the same verified 001–005 engine.
// The public (學七舍) schema and its rows/functions are never copied or replaced.
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '../supabase');
const files = ['001-warehouse.sql', '002-optional-fields-and-location-delete.sql', '003-material-archive.sql', '004-transaction-edit.sql', '005-read-only-members.sql'];
const templates = files.map((file, index) => {
  const source = fs.readFileSync(path.join(base, file), 'utf8').replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
  const delimiter = `$engine_${index + 1}$`;
  if (source.includes(delimiter)) throw new Error('SQL delimiter collision');
  return `${delimiter}\n${source}\n${delimiter}`;
});
const sql = `-- 006: three real warehouses. Apply AFTER 005; safe to reapply.
-- No production inventory, history, revision, members or legacy functions change.
-- Account grants are separate, private, reviewed SQL; no users/passwords here.
begin;
do $preflight$ begin
  if to_regprocedure('public.warehouse_mutate_before_read_only(uuid,text,jsonb)') is null then
    raise exception 'WAREHOUSE_SETUP_REQUIRED: apply 005 first';
  end if;
end $preflight$;

do $install$
declare v_schema text; v_sql text;
begin
  foreach v_schema in array array['warehouse_pair1', 'warehouse_pair2'] loop
    if to_regnamespace(v_schema) is null then
      execute format('create schema %I', v_schema);
      foreach v_sql in array array[${templates.join(',\n')} ] loop
        execute replace(v_sql, 'public.', quote_ident(v_schema) || '.');
      end loop;
      -- Fresh warehouses are initialized EMPTY, without phone imports/default floors.
      execute format('update %I.warehouse_state set initialized=true where singleton', v_schema);
      execute format('create table %I.install_version(version integer primary key check(version=1))', v_schema);
      execute format('insert into %I.install_version values (1)', v_schema);
    elsif to_regclass(v_schema || '.install_version') is null then
      raise exception 'WAREHOUSE_SCHEMA_CONFLICT: %', v_schema;
    end if;
    -- Only the public dispatchers below can reach these private schemas.
    execute format('revoke all on schema %I from public, anon, authenticated', v_schema);
    execute format('revoke all on all tables in schema %I from public, anon, authenticated', v_schema);
    execute format('revoke all on all sequences in schema %I from public, anon, authenticated', v_schema);
    execute format('revoke all on all functions in schema %I from public, anon, authenticated', v_schema);
  end loop;
end $install$;

create or replace function public.warehouse_dorms() returns jsonb
language sql stable security definer set search_path='' as $catalog$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'canWrite', can_write,
    'materialCount', material_count, 'locationCount', location_count, 'lowCount', low_count) order by ordinal), '[]'::jsonb)
  from (
    select 1 as ordinal, 'd7'::text as id, '學七舍'::text as name, member.can_write,
      (select count(*) from public.warehouse_materials where archived_at is null) as material_count,
      (select count(*) from public.warehouse_locations) as location_count,
      (select count(*) from public.warehouse_materials where archived_at is null and stock<=alert) as low_count
    from public.warehouse_members member where member.user_id=auth.uid()
    union all
    select 2, 'pair1', '男一舍＋女一舍', member.can_write,
      (select count(*) from warehouse_pair1.warehouse_materials where archived_at is null),
      (select count(*) from warehouse_pair1.warehouse_locations),
      (select count(*) from warehouse_pair1.warehouse_materials where archived_at is null and stock<=alert)
    from warehouse_pair1.warehouse_members member where member.user_id=auth.uid()
    union all
    select 3, 'pair2', '男二舍＋女二舍', member.can_write,
      (select count(*) from warehouse_pair2.warehouse_materials where archived_at is null),
      (select count(*) from warehouse_pair2.warehouse_locations),
      (select count(*) from warehouse_pair2.warehouse_materials where archived_at is null and stock<=alert)
    from warehouse_pair2.warehouse_members member where member.user_id=auth.uid()
  ) allowed;
$catalog$;
revoke all on function public.warehouse_dorms() from public, anon;
grant execute on function public.warehouse_dorms() to authenticated;

create or replace function public.warehouse_dorm_snapshot(p_dorm_id text) returns jsonb
language plpgsql security definer set search_path='' as $snapshot$
declare v_snapshot jsonb; v_name text;
begin
  case p_dorm_id
    when 'd7' then v_snapshot:=public.warehouse_snapshot(); v_name:='學七舍';
    when 'pair1' then v_snapshot:=warehouse_pair1.warehouse_snapshot(); v_name:='男一舍＋女一舍';
    when 'pair2' then v_snapshot:=warehouse_pair2.warehouse_snapshot(); v_name:='男二舍＋女二舍';
    else raise exception 'WAREHOUSE_ACCESS_DENIED' using errcode='42501';
  end case;
  return v_snapshot || jsonb_build_object('dormId',p_dorm_id,'dormName',v_name);
end $snapshot$;
revoke all on function public.warehouse_dorm_snapshot(text) from public, anon;
grant execute on function public.warehouse_dorm_snapshot(text) to authenticated;

create or replace function public.warehouse_dorm_mutate(p_dorm_id text, p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $mutate$
declare v_snapshot jsonb; v_name text;
begin
  case p_dorm_id
    when 'd7' then v_snapshot:=public.warehouse_mutate(p_request_id,p_operation,p_payload); v_name:='學七舍';
    when 'pair1' then v_snapshot:=warehouse_pair1.warehouse_mutate(p_request_id,p_operation,p_payload); v_name:='男一舍＋女一舍';
    when 'pair2' then v_snapshot:=warehouse_pair2.warehouse_mutate(p_request_id,p_operation,p_payload); v_name:='男二舍＋女二舍';
    else raise exception 'WAREHOUSE_ACCESS_DENIED' using errcode='42501';
  end case;
  return v_snapshot || jsonb_build_object('dormId',p_dorm_id,'dormName',v_name);
end $mutate$;
revoke all on function public.warehouse_dorm_mutate(text,uuid,text,jsonb) from public, anon;
grant execute on function public.warehouse_dorm_mutate(text,uuid,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
`;
fs.writeFileSync(path.join(base, '006-multiple-dorms.sql'), sql);
console.log('Generated 006-multiple-dorms.sql');
