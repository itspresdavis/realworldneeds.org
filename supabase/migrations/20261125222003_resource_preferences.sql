-- Optional, user-owned preferences. No service-role client or public read policy.
begin;
create table public.rwn_resource_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  topics text[] not null default '{}' check (
    cardinality(topics) <= 7 and array_position(topics, null) is null
    and topics <@ array['food','water','clothing','shelter','health','hygiene','referral']::text[]
  ),
  area text not null default '' check (char_length(area) <= 80 and area !~ '[[:cntrl:]]'),
  consent_version integer not null check (consent_version = 1),
  updated_at timestamptz not null default now()
);
alter table public.rwn_resource_preferences enable row level security;
revoke all on public.rwn_resource_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.rwn_resource_preferences to authenticated;
create policy resource_preferences_select on public.rwn_resource_preferences for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');
create policy resource_preferences_insert on public.rwn_resource_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');
create policy resource_preferences_update on public.rwn_resource_preferences for update to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false')
  with check ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');
create policy resource_preferences_delete on public.rwn_resource_preferences for delete to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');
comment on table public.rwn_resource_preferences is 'Opt-in broad resource topics and coarse place. User can clear immediately; account removal cascades. No editorial role is granted.';
commit;
