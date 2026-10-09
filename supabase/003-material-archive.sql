-- Apply after 002. Additive upgrade: no existing inventory or account rows change.
begin;
select singleton from public.warehouse_state where singleton for update;
alter table public.warehouse_materials add column if not exists archived_at timestamptz;
-- Archived names may be reused without reconnecting old history to a new item.
drop index if exists public.warehouse_material_names;
create unique index warehouse_material_names on public.warehouse_materials(location, lower(btrim(name))) where archived_at is null;

-- Keep the already-tested 002 operations private; only the guarded wrapper is callable.
do $$ begin
  if to_regprocedure('public.warehouse_mutate_before_archive(uuid,text,jsonb)') is null then
    alter function public.warehouse_mutate(uuid,text,jsonb) rename to warehouse_mutate_before_archive;
  end if;
end $$;
revoke all on function public.warehouse_mutate_before_archive(uuid,text,jsonb) from public, anon, authenticated;

create or replace function public.warehouse_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.warehouse_require_access();
  return (select jsonb_build_object(
    'initialized', s.initialized, 'revision', s.revision,
    'canImport', coalesce((select can_import from public.warehouse_members where user_id = auth.uid()), false),
    'materials', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'spec', m.spec, 'stock', m.stock, 'alert', m.alert,
      'location', m.location, 'detail', m.detail, 'version', m.version) order by m.id)
      from public.warehouse_materials m where m.archived_at is null), '[]'::jsonb),
    'archivedMaterials', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'spec', m.spec, 'stock', m.stock, 'alert', m.alert,
      'location', m.location, 'detail', m.detail, 'version', m.version, 'archivedAt', m.archived_at) order by m.id)
      from public.warehouse_materials m where m.archived_at is not null), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(name order by name) from public.warehouse_locations), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'materialId', t.material_id, 'materialName', t.material_name, 'unit', t.unit,
      'amount', t.amount, 'type', t.type, 'time', t.time, 'reason', t.reason, 'note', t.note)
      order by t.time, t.id) from public.warehouse_transactions t), '[]'::jsonb)
  ) from public.warehouse_state s where s.singleton);
end;
$$;
revoke all on function public.warehouse_snapshot() from public, anon;
grant execute on function public.warehouse_snapshot() to authenticated;

create or replace function public.warehouse_mutate(p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.warehouse_requests%rowtype;
  v_item public.warehouse_materials%rowtype;
  v_initialized boolean;
  v_id bigint;
begin
  perform public.warehouse_require_access();
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'WAREHOUSE_INVALID_INPUT';
  end if;
  select initialized into strict v_initialized from public.warehouse_state where singleton for update;
  select * into v_request from public.warehouse_requests where request_id = p_request_id;
  if found then
    if v_request.user_id <> auth.uid() or v_request.operation <> p_operation or v_request.payload <> p_payload then
      raise exception 'WAREHOUSE_REQUEST_CONFLICT';
    end if;
    return public.warehouse_snapshot();
  end if;
  if p_operation = 'archive_material' then
    if not v_initialized then raise exception 'WAREHOUSE_NOT_INITIALIZED'; end if;
    if jsonb_typeof(p_payload->'id') is distinct from 'number'
      or jsonb_typeof(p_payload->'version') is distinct from 'number'
      or (p_payload->>'id')::numeric <> trunc((p_payload->>'id')::numeric)
      or (p_payload->>'version')::numeric <> trunc((p_payload->>'version')::numeric) then
      raise exception 'WAREHOUSE_INVALID_INPUT';
    end if;
    v_id := (p_payload->>'id')::bigint;
    select * into v_item from public.warehouse_materials where id = v_id for update;
    if not found or v_item.archived_at is not null then raise exception 'WAREHOUSE_MATERIAL_NOT_FOUND'; end if;
    if v_item.version is distinct from (p_payload->>'version')::integer then raise exception 'WAREHOUSE_EDIT_CONFLICT'; end if;
    update public.warehouse_materials set archived_at = now(), version = version + 1 where id = v_id;
    update public.warehouse_state set revision = revision + 1 where singleton;
    insert into public.warehouse_requests(request_id, user_id, operation, payload)
      values (p_request_id, auth.uid(), p_operation, p_payload);
    return public.warehouse_snapshot();
  end if;
  -- Old browser tabs must not resurrect or adjust an archived row.
  if p_operation in ('save_material', 'adjust_stock') then
    v_id := case when p_operation = 'save_material' then (p_payload->>'id')::bigint else (p_payload->>'materialId')::bigint end;
    if exists (select 1 from public.warehouse_materials where id = v_id and archived_at is not null) then
      raise exception 'WAREHOUSE_MATERIAL_NOT_FOUND';
    end if;
  elsif p_operation = 'delete_location' and exists (
    select 1 from public.warehouse_materials where location = btrim(p_payload->>'name') and archived_at is not null
  ) then
    raise exception 'WAREHOUSE_LOCATION_HAS_ARCHIVE';
  end if;
  return public.warehouse_mutate_before_archive(p_request_id, p_operation, p_payload);
end;
$$;
revoke all on function public.warehouse_mutate(uuid,text,jsonb) from public, anon;
grant execute on function public.warehouse_mutate(uuid,text,jsonb) to authenticated;
commit;
