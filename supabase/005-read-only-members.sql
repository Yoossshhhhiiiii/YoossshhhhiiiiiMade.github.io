-- Apply after 004. Existing members retain their current write access.
-- Newly authorized members default to read-only. No inventory/history changes.
begin;
select singleton from public.warehouse_state where singleton for update;
do $$ begin
  if to_regprocedure('public.warehouse_mutate_before_transaction_edit(uuid,text,jsonb)') is null then
    raise exception 'WAREHOUSE_SETUP_REQUIRED: apply 004 before 005';
  end if;
end $$;
alter table public.warehouse_members add column if not exists can_write boolean not null default true;
alter table public.warehouse_members alter column can_write set default false;

do $$ begin
  if to_regprocedure('public.warehouse_mutate_before_read_only(uuid,text,jsonb)') is null then
    alter function public.warehouse_mutate(uuid,text,jsonb) rename to warehouse_mutate_before_read_only;
  end if;
end $$;
revoke all on function public.warehouse_mutate_before_read_only(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.warehouse_mutate_before_transaction_edit(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.warehouse_mutate_before_archive(uuid,text,jsonb) from public, anon, authenticated;

create or replace function public.warehouse_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.warehouse_require_access();
  return (select jsonb_build_object(
    'initialized', s.initialized, 'revision', s.revision,
    'features', jsonb_build_object('transactionEdit', true),
    'canWrite', member.can_write,
    'canImport', member.can_import and member.can_write,
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
  ) from public.warehouse_state s join public.warehouse_members member on member.user_id = auth.uid()
    where s.singleton);
end;
$$;
revoke all on function public.warehouse_snapshot() from public, anon;
grant execute on function public.warehouse_snapshot() to authenticated;

create or replace function public.warehouse_mutate(p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_can_write boolean;
  v_request public.warehouse_requests%rowtype;
begin
  perform public.warehouse_require_access();
  -- Same write lock as earlier migrations, then lock membership until commit.
  -- Revocation and a concurrent write cannot pass each other unnoticed.
  perform singleton from public.warehouse_state where singleton for update;
  select can_write into v_can_write from public.warehouse_members where user_id = auth.uid() for share;
  if not found then raise exception 'WAREHOUSE_ACCESS_DENIED' using errcode = '42501'; end if;
  if not v_can_write then
    -- A downgraded writer may safely confirm an ALREADY committed exact request.
    -- This branch only reads; a missing receipt is a definitive non-write.
    select * into v_request from public.warehouse_requests where request_id = p_request_id;
    if found and v_request.user_id = auth.uid() and v_request.operation = p_operation and v_request.payload = p_payload then
      return public.warehouse_snapshot();
    end if;
    raise exception 'WAREHOUSE_READ_ONLY' using errcode = '42501';
  end if;
  return public.warehouse_mutate_before_read_only(p_request_id, p_operation, p_payload);
end;
$$;
revoke all on function public.warehouse_mutate(uuid,text,jsonb) from public, anon;
grant execute on function public.warehouse_mutate(uuid,text,jsonb) to authenticated;
commit;
