-- Upgrade an existing warehouse; never re-run 001 on a live database.
-- Replaces only the guarded mutation function. No inventory or member rows change.
begin;
do $$ begin
  if to_regprocedure('public.warehouse_mutate(uuid,text,jsonb)') is null then
    raise exception 'WAREHOUSE_SETUP_REQUIRED: run 001 on a new database first';
  end if;
end; $$;

create or replace function public.warehouse_mutate(p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_state public.warehouse_state%rowtype;
  v_request public.warehouse_requests%rowtype;
  v_item public.warehouse_materials%rowtype;
  v_json jsonb;
  v_name text;
  v_amount integer;
  v_id bigint;
begin
  perform public.warehouse_require_access();
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'WAREHOUSE_INVALID_INPUT';
  end if;
  -- All devices serialize writes, including deletion and material relocation.
  select * into strict v_state from public.warehouse_state where singleton for update;
  select * into v_request from public.warehouse_requests where request_id = p_request_id;
  if found then
    if v_request.user_id <> auth.uid() or v_request.operation <> p_operation or v_request.payload <> p_payload then
      raise exception 'WAREHOUSE_REQUEST_CONFLICT';
    end if;
    return public.warehouse_snapshot();
  end if;

  if p_operation = 'import_phone' then
    if not (select can_import from public.warehouse_members where user_id = auth.uid()) then
      raise exception 'WAREHOUSE_IMPORT_NOT_ALLOWED' using errcode = '42501';
    end if;
    if v_state.initialized or exists (select 1 from public.warehouse_materials) then
      raise exception 'WAREHOUSE_ALREADY_INITIALIZED';
    end if;
    if p_payload->>'source' is distinct from 'phone'
      or p_payload->>'schemaVersion' is distinct from '1'
      or jsonb_typeof(p_payload->'materials') is distinct from 'array'
      or jsonb_typeof(p_payload->'transactions') is distinct from 'array'
      or jsonb_typeof(p_payload->'locations') is distinct from 'array' then
      raise exception 'WAREHOUSE_INVALID_IMPORT';
    end if;
    if jsonb_array_length(p_payload->'materials') < 1 then raise exception 'WAREHOUSE_EMPTY_IMPORT'; end if;
    for v_json in select value from jsonb_array_elements(p_payload->'locations') loop
      if jsonb_typeof(v_json) <> 'string' then raise exception 'WAREHOUSE_INVALID_IMPORT'; end if;
      insert into public.warehouse_locations(name) values (btrim(v_json #>> '{}')) on conflict (name) do nothing;
    end loop;
    for v_json in select value from jsonb_array_elements(p_payload->'materials') loop
      if jsonb_typeof(v_json->'id') is distinct from 'number'
        or jsonb_typeof(v_json->'stock') is distinct from 'number'
        or jsonb_typeof(v_json->'name') is distinct from 'string'
        or jsonb_typeof(v_json->'spec') is distinct from 'string'
        or jsonb_typeof(v_json->'location') is distinct from 'string' then
        raise exception 'WAREHOUSE_INVALID_IMPORT';
      end if;
      insert into public.warehouse_materials(id, name, spec, stock, alert, location, detail)
        values ((v_json->>'id')::bigint, btrim(v_json->>'name'), v_json->>'spec', (v_json->>'stock')::integer,
          (v_json->>'alert')::integer, btrim(v_json->>'location'), coalesce(v_json->>'detail', ''));
    end loop;
    perform setval('public.warehouse_materials_id_seq'::regclass,
      (select max(id) from public.warehouse_materials), true);
    for v_json in select value from jsonb_array_elements(p_payload->'transactions') loop
      insert into public.warehouse_transactions(material_id, material_name, unit, amount, type, time, reason, note)
        select (v_json->>'materialId')::bigint, coalesce(v_json->>'materialName', m.name),
          coalesce(v_json->>'unit', split_part(m.spec, '／', 2)), (v_json->>'amount')::integer,
          v_json->>'type', (v_json->>'time')::timestamptz,
          coalesce(v_json->>'reason', ''), coalesce(v_json->>'note', '')
        from public.warehouse_materials m where m.id = (v_json->>'materialId')::bigint;
      if not found then raise exception 'WAREHOUSE_ORPHAN_TRANSACTION'; end if;
    end loop;
    update public.warehouse_state set initialized = true, imported_at = now(), imported_by = auth.uid() where singleton;
  else
    if not v_state.initialized then raise exception 'WAREHOUSE_NOT_INITIALIZED'; end if;
    if p_operation = 'add_location' then
      v_name := btrim(p_payload->>'name');
      if v_name is null then raise exception 'WAREHOUSE_INVALID_INPUT'; end if;
      insert into public.warehouse_locations(name) values (v_name);
    elsif p_operation = 'delete_location' then
      v_name := btrim(p_payload->>'name');
      if jsonb_typeof(p_payload->'name') is distinct from 'string'
        or char_length(coalesce(v_name, '')) not between 1 and 40
        or v_name = '全部位置' then raise exception 'WAREHOUSE_INVALID_INPUT'; end if;
      perform 1 from public.warehouse_locations where name = v_name for update;
      if not found then raise exception 'WAREHOUSE_LOCATION_NOT_FOUND'; end if;
      -- Never cascade or delete a material, even when its stock is zero.
      if exists (select 1 from public.warehouse_materials where location = v_name) then
        raise exception 'WAREHOUSE_LOCATION_IN_USE';
      end if;
      delete from public.warehouse_locations where name = v_name;
    elsif p_operation = 'save_material' then
      if char_length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 100
        or char_length(btrim(coalesce(p_payload->>'category', ''))) > 80
        or char_length(btrim(coalesce(p_payload->>'unit', ''))) > 20
        or jsonb_typeof(coalesce(p_payload->'category', '""'::jsonb)) not in ('string', 'null')
        or jsonb_typeof(coalesce(p_payload->'unit', '""'::jsonb)) not in ('string', 'null')
        or p_payload->>'alert' is null then raise exception 'WAREHOUSE_INVALID_INPUT'; end if;
      if p_payload->>'id' is null then
        insert into public.warehouse_materials(name, spec, stock, alert, location, detail) values (
          btrim(p_payload->>'name'), btrim(coalesce(p_payload->>'category', '')) || '／' || btrim(coalesce(p_payload->>'unit', '')),
          (p_payload->>'stock')::integer, (p_payload->>'alert')::integer, p_payload->>'location', coalesce(p_payload->>'detail', ''));
      else
        v_id := (p_payload->>'id')::bigint;
        select * into v_item from public.warehouse_materials where id = v_id for update;
        if not found then raise exception 'WAREHOUSE_MATERIAL_NOT_FOUND'; end if;
        if v_item.version is distinct from (p_payload->>'version')::integer then
          raise exception 'WAREHOUSE_EDIT_CONFLICT';
        end if;
        update public.warehouse_materials set name = btrim(p_payload->>'name'),
          spec = btrim(coalesce(p_payload->>'category', '')) || '／' || btrim(coalesce(p_payload->>'unit', '')),
          alert = (p_payload->>'alert')::integer, location = p_payload->>'location',
          detail = coalesce(p_payload->>'detail', ''), version = version + 1 where id = v_id;
      end if;
    elsif p_operation = 'adjust_stock' then
      v_id := (p_payload->>'materialId')::bigint;
      v_amount := (p_payload->>'amount')::integer;
      if v_amount is null or v_amount = 0
        or p_payload->>'reason' is null or p_payload->>'reason' not in ('入庫補貨', '維修使用')
        or char_length(coalesce(p_payload->>'note', '')) > 2000 then raise exception 'WAREHOUSE_INVALID_INPUT'; end if;
      select * into v_item from public.warehouse_materials where id = v_id for update;
      if not found then raise exception 'WAREHOUSE_MATERIAL_NOT_FOUND'; end if;
      if v_item.stock::bigint + v_amount < 0 then raise exception 'WAREHOUSE_INSUFFICIENT_STOCK'; end if;
      update public.warehouse_materials set stock = stock + v_amount, version = version + 1 where id = v_id;
      insert into public.warehouse_transactions(material_id, material_name, unit, amount, type, reason, note, user_id)
        values (v_id, v_item.name, split_part(v_item.spec, '／', 2), abs(v_amount),
          case when v_amount > 0 then '增加' else '減少' end, p_payload->>'reason', coalesce(p_payload->>'note', ''), auth.uid());
    else
      raise exception 'WAREHOUSE_INVALID_OPERATION';
    end if;
  end if;
  update public.warehouse_state set revision = revision + 1 where singleton;
  insert into public.warehouse_requests(request_id, user_id, operation, payload) values (p_request_id, auth.uid(), p_operation, p_payload);
  return public.warehouse_snapshot();
end;
$$;
revoke all on function public.warehouse_mutate(uuid, text, jsonb) from public, anon;
grant execute on function public.warehouse_mutate(uuid, text, jsonb) to authenticated;
commit;
