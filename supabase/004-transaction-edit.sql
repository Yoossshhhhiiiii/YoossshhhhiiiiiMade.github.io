-- Apply only after 003, with explicit approval to enable transaction corrections.
-- Adds validation/audit support. No existing stock, event values or membership changes.
begin;
select singleton from public.warehouse_state where singleton for update;
do $$ begin
  if to_regprocedure('public.warehouse_mutate_before_archive(uuid,text,jsonb)') is null then
    raise exception 'WAREHOUSE_SETUP_REQUIRED: apply 003 before 004';
  end if;
end $$;
alter table public.warehouse_transactions add column if not exists version integer not null default 1;
create table if not exists public.warehouse_transaction_edits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.warehouse_transactions(id),
  request_id uuid not null unique references public.warehouse_requests(request_id),
  edited_by uuid not null references auth.users(id),
  time timestamptz not null default now(),
  before_value jsonb not null,
  after_value jsonb not null,
  stock_before integer not null check (stock_before >= 0),
  stock_after integer not null check (stock_after >= 0)
);
create index if not exists warehouse_transaction_edit_history on public.warehouse_transaction_edits(transaction_id, time);
alter table public.warehouse_transaction_edits enable row level security;
revoke all on public.warehouse_transaction_edits from anon, authenticated;
grant select on public.warehouse_transaction_edits to authenticated;
drop policy if exists warehouse_transaction_edits_read on public.warehouse_transaction_edits;
create policy warehouse_transaction_edits_read on public.warehouse_transaction_edits for select to authenticated
  using ((select public.warehouse_has_access()));

do $$ begin
  if to_regprocedure('public.warehouse_mutate_before_transaction_edit(uuid,text,jsonb)') is null then
    alter function public.warehouse_mutate(uuid,text,jsonb) rename to warehouse_mutate_before_transaction_edit;
  end if;
end $$;
revoke all on function public.warehouse_mutate_before_transaction_edit(uuid,text,jsonb) from public, anon, authenticated;

create or replace function public.warehouse_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.warehouse_require_access();
  return (select jsonb_build_object(
    'initialized', s.initialized, 'revision', s.revision,
    'features', jsonb_build_object('transactionEdit', true),
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
      'amount', t.amount, 'type', t.type, 'time', t.time, 'reason', t.reason, 'note', t.note,
      'version', t.version,
      'editHistory', coalesce((select jsonb_agg(jsonb_build_object(
        'time', e.time, 'before', e.before_value, 'after', e.after_value,
        'stockBefore', e.stock_before, 'stockAfter', e.stock_after) order by (e.after_value->>'version')::integer, e.id)
        from public.warehouse_transaction_edits e where e.transaction_id = t.id), '[]'::jsonb))
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
  v_record public.warehouse_transactions%rowtype;
  v_item public.warehouse_materials%rowtype;
  v_initialized boolean;
  v_id uuid;
  v_quantity integer;
  v_version integer;
  v_reason text;
  v_note text;
  v_type text;
  v_delta bigint;
  v_stock bigint;
begin
  perform public.warehouse_require_access();
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'WAREHOUSE_INVALID_INPUT';
  end if;
  -- Same global lock as every existing write: preview stock is never authoritative.
  select initialized into strict v_initialized from public.warehouse_state where singleton for update;
  select * into v_request from public.warehouse_requests where request_id = p_request_id;
  if found then
    if v_request.user_id <> auth.uid() or v_request.operation <> p_operation or v_request.payload <> p_payload then
      raise exception 'WAREHOUSE_REQUEST_CONFLICT';
    end if;
    return public.warehouse_snapshot();
  end if;
  if p_operation is distinct from 'edit_transaction' then
    return public.warehouse_mutate_before_transaction_edit(p_request_id, p_operation, p_payload);
  end if;
  if not v_initialized then raise exception 'WAREHOUSE_NOT_INITIALIZED'; end if;
  if jsonb_typeof(p_payload->'transactionId') is distinct from 'string'
    or jsonb_typeof(p_payload->'version') is distinct from 'number'
    or jsonb_typeof(p_payload->'quantity') is distinct from 'number'
    or jsonb_typeof(p_payload->'reason') is distinct from 'string'
    or (p_payload ? 'note' and jsonb_typeof(p_payload->'note') is distinct from 'string') then
    raise exception 'WAREHOUSE_INVALID_INPUT';
  end if;
  if (p_payload->>'version')::numeric not between 1 and 2147483647
    or (p_payload->>'version')::numeric <> trunc((p_payload->>'version')::numeric)
    or (p_payload->>'quantity')::numeric not between 1 and 2147483647
    or (p_payload->>'quantity')::numeric <> trunc((p_payload->>'quantity')::numeric)
    or p_payload->>'reason' not in ('維修使用', '入庫補貨')
    or char_length(coalesce(p_payload->>'note', '')) > 2000 then
    raise exception 'WAREHOUSE_INVALID_INPUT';
  end if;
  v_id := (p_payload->>'transactionId')::uuid;
  v_quantity := (p_payload->>'quantity')::integer;
  v_version := (p_payload->>'version')::integer;
  v_reason := p_payload->>'reason';
  v_note := btrim(coalesce(p_payload->>'note', ''));
  v_type := case when v_reason = '入庫補貨' then '增加' else '減少' end;
  select * into v_record from public.warehouse_transactions where id = v_id for update;
  if not found then raise exception 'WAREHOUSE_TRANSACTION_NOT_FOUND'; end if;
  if v_record.version is distinct from v_version then raise exception 'WAREHOUSE_TRANSACTION_EDIT_CONFLICT'; end if;
  select * into v_item from public.warehouse_materials where id = v_record.material_id for update;
  if not found or v_item.archived_at is not null then raise exception 'WAREHOUSE_MATERIAL_NOT_FOUND'; end if;
  v_delta := (case when v_type = '增加' then v_quantity::bigint else -v_quantity::bigint end)
    - (case when v_record.type = '增加' then v_record.amount::bigint else -v_record.amount::bigint end);
  v_stock := v_item.stock::bigint + v_delta;
  if v_stock < 0 then raise exception 'WAREHOUSE_INSUFFICIENT_STOCK'; end if;
  if v_stock > 2147483647 then raise exception 'WAREHOUSE_STOCK_OVERFLOW'; end if;
  insert into public.warehouse_requests(request_id, user_id, operation, payload)
    values (p_request_id, auth.uid(), p_operation, p_payload);
  if v_record.amount = v_quantity and v_record.type = v_type and v_record.reason = v_reason and v_record.note = v_note then
    return public.warehouse_snapshot();
  end if;
  update public.warehouse_transactions set amount = v_quantity, type = v_type, reason = v_reason, note = v_note,
    version = version + 1 where id = v_id;
  update public.warehouse_materials set stock = v_stock::integer, version = version + 1 where id = v_item.id;
  insert into public.warehouse_transaction_edits(transaction_id, request_id, edited_by, before_value, after_value, stock_before, stock_after)
    values (v_id, p_request_id, auth.uid(),
      jsonb_build_object('amount', v_record.amount, 'type', v_record.type, 'reason', v_record.reason, 'note', v_record.note, 'version', v_record.version),
      jsonb_build_object('amount', v_quantity, 'type', v_type, 'reason', v_reason, 'note', v_note, 'version', v_record.version + 1),
      v_item.stock, v_stock::integer);
  update public.warehouse_state set revision = revision + 1 where singleton;
  return public.warehouse_snapshot();
end;
$$;
revoke all on function public.warehouse_mutate(uuid,text,jsonb) from public, anon;
grant execute on function public.warehouse_mutate(uuid,text,jsonb) to authenticated;
commit;
