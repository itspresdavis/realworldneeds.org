-- AFTER triggers see stored generated columns; BEFORE triggers do not.
drop trigger rwn_location_audit on public.rwn_locations;
create function rwn_private.touch_location() returns trigger language plpgsql security invoker set search_path = '' as $$
begin NEW.updated_at = clock_timestamp(); return NEW; end;
$$;
revoke all on function rwn_private.touch_location() from public, anon, authenticated;
create trigger rwn_location_timestamp before update on public.rwn_locations for each row execute function rwn_private.touch_location();
create or replace function rwn_private.audit_location() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rwn_location_history(location_id, operation, actor_id, before_record, after_record)
  values (case when TG_OP = 'DELETE' then OLD.id else NEW.id end, TG_OP, auth.uid(),
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end);
  return null;
end;
$$;
revoke all on function rwn_private.audit_location() from public, anon, authenticated;
create trigger rwn_location_audit after insert or update or delete on public.rwn_locations for each row execute function rwn_private.audit_location();
alter table public.rwn_locations add constraint valid_review_date check (last_checked::date <= current_date);
