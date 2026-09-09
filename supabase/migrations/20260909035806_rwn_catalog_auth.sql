-- RWN catalog. Public facts are separate from contributor identities and notes.
create schema if not exists rwn_private;
revoke all on schema rwn_private from public;
grant usage on schema rwn_private to authenticated;

create table public.rwn_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'admin')),
  created_at timestamptz not null default now()
);
alter table public.rwn_members enable row level security;
grant select on public.rwn_members to authenticated;
create policy own_membership on public.rwn_members for select to authenticated using (user_id = (select auth.uid()));

create function rwn_private.is_editor() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.rwn_members where user_id = auth.uid() and role in ('editor','admin'));
$$;
revoke all on function rwn_private.is_editor() from public, anon;
grant execute on function rwn_private.is_editor() to authenticated;

create table public.rwn_locations (
  id text primary key check (length(id) between 1 and 160),
  record jsonb not null,
  name text generated always as (record->>'name') stored not null,
  country text generated always as (record->>'country') stored not null,
  kind text generated always as (record->>'kind') stored not null check (kind in ('direct','locator','network')),
  latitude double precision generated always as ((record->>'lat')::double precision) stored not null check (latitude between -90 and 90),
  longitude double precision generated always as ((record->>'lng')::double precision) stored not null check (longitude between -180 and 180),
  source_url text generated always as (record->>'sourceUrl') stored not null check (source_url ~ '^https://'),
  last_checked text generated always as (record->>'lastChecked') stored not null check (last_checked ~ '^\d{4}-\d{2}-\d{2}$'),
  search_text text generated always as (coalesce(record->>'name','') || ' ' || coalesce(record->>'country','') || ' ' || coalesce(record->>'city','') || ' ' || coalesce(record->>'category','')) stored,
  published boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint record_identity check (record->>'id' is not null and record->>'id' = id),
  constraint source_attribution check (length(record->>'sourceName') > 0),
  constraint required_facts check (record ?& array['summary','category','sourceName','address','services','costNote','availabilityNote'])
);
create index rwn_locations_country_idx on public.rwn_locations(country);
create index rwn_locations_name_id_idx on public.rwn_locations(name, id);
create index rwn_locations_review_idx on public.rwn_locations(last_checked);
alter table public.rwn_locations enable row level security;
grant select on public.rwn_locations to anon, authenticated;
grant insert, update, delete on public.rwn_locations to authenticated;
create policy published_locations on public.rwn_locations for select to anon, authenticated using (published);
create policy editor_read_locations on public.rwn_locations for select to authenticated using ((select rwn_private.is_editor()));
create policy editor_insert_locations on public.rwn_locations for insert to authenticated with check ((select rwn_private.is_editor()));
create policy editor_update_locations on public.rwn_locations for update to authenticated using ((select rwn_private.is_editor())) with check ((select rwn_private.is_editor()));
create policy editor_delete_locations on public.rwn_locations for delete to authenticated using ((select rwn_private.is_editor()));

create table public.rwn_location_history (
  id bigint generated always as identity primary key,
  location_id text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  actor_id uuid,
  changed_at timestamptz not null default now(),
  before_record jsonb,
  after_record jsonb
);
create index rwn_history_location_idx on public.rwn_location_history(location_id, changed_at desc);
alter table public.rwn_location_history enable row level security;
grant select on public.rwn_location_history to authenticated;
create policy editor_history on public.rwn_location_history for select to authenticated using ((select rwn_private.is_editor()));

-- Trigger-only definer: append immutable evidence even when callers cannot write history.
-- Null actor is a database maintenance import, never a fabricated contributor identity.
create function rwn_private.audit_location() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then NEW.updated_at = now(); end if;
  insert into public.rwn_location_history(location_id, operation, actor_id, before_record, after_record)
  values (case when TG_OP = 'DELETE' then OLD.id else NEW.id end, TG_OP, auth.uid(),
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end);
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function rwn_private.audit_location() from public, anon, authenticated;
create trigger rwn_location_audit before insert or update or delete on public.rwn_locations for each row execute function rwn_private.audit_location();

create table public.rwn_reviews (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.rwn_locations(id),
  author_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (length(note) between 10 and 2000),
  created_at timestamptz not null default now()
);
create index rwn_reviews_author_idx on public.rwn_reviews(author_id, created_at desc);
create index rwn_reviews_location_idx on public.rwn_reviews(location_id);
alter table public.rwn_reviews enable row level security;
grant select, insert on public.rwn_reviews to authenticated;
create policy own_reviews on public.rwn_reviews for select to authenticated using (author_id = (select auth.uid()) or (select rwn_private.is_editor()));
create policy submit_review on public.rwn_reviews for insert to authenticated with check (author_id = (select auth.uid()) and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false));

grant all on public.rwn_locations, public.rwn_location_history, public.rwn_members, public.rwn_reviews to service_role;
grant usage, select on sequence public.rwn_location_history_id_seq to service_role;
comment on table public.rwn_locations is 'RWN source-backed catalog. Coordinates for locator/network records indicate coverage, not walk-in locations.';
comment on table public.rwn_location_history is 'Append-only catalog evidence. Null actor_id identifies a maintenance import. Editor access only.';
