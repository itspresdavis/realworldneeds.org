alter table public.rwn_locations add column editorial_note text not null default 'Initial source-backed catalog import' check (length(editorial_note) between 10 and 1000);
alter table public.rwn_locations add constraint named_source check (jsonb_typeof(record->'sourceName') = 'string' and length(trim(record->>'sourceName')) > 0);
alter table public.rwn_locations add constraint nonempty_name check (length(trim(name)) > 0);
alter table public.rwn_locations add constraint service_array check (jsonb_typeof(record->'services') = 'array');

-- Pending editor grants are private and can only be prepared by the project owner.
-- Verification comes from auth.users.email_confirmed_at, never user-editable metadata.
create table rwn_private.editor_invitations (
  email text primary key check (email = lower(email)),
  role text not null default 'editor' check (role in ('editor','admin')),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table rwn_private.editor_invitations enable row level security;
revoke all on rwn_private.editor_invitations from public, anon, authenticated;
create function rwn_private.activate_editor() returns trigger language plpgsql security definer set search_path = '' as $$
declare invitation_role text;
begin
  if NEW.email_confirmed_at is null then return NEW; end if;
  delete from rwn_private.editor_invitations where email = lower(NEW.email) and expires_at > now() returning role into invitation_role;
  if invitation_role is not null then
    insert into public.rwn_members(user_id, role) values (NEW.id, invitation_role) on conflict (user_id) do update set role = excluded.role;
  end if;
  return NEW;
end;
$$;
revoke all on function rwn_private.activate_editor() from public, anon, authenticated;
create trigger rwn_activate_editor after insert or update of email_confirmed_at on auth.users for each row execute function rwn_private.activate_editor();

-- Read-only audit worklist in the dashboard; caller permissions and RLS are preserved.
create view public.rwn_editor_queue with (security_invoker = true) as
select id, name, country, kind, last_checked, source_url, latitude, longitude, published, updated_at,
  case when last_checked < to_char(current_date - interval '180 days', 'YYYY-MM-DD') then 'Review due' else 'Within review window' end as review_status,
  'https://www.realworldneeds.org/service/' || id as public_listing_url,
  'https://www.realworldneeds.org/#resource=' || id as globe_url
from public.rwn_locations;
grant select on public.rwn_editor_queue to authenticated, service_role;
comment on view public.rwn_editor_queue is 'Sortable review worklist; underlying row-level permissions apply. Full source facts are in rwn_locations.record.';
