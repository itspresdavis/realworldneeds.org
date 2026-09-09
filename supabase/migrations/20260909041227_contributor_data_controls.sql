create policy deny_client_invitations on rwn_private.editor_invitations for all to authenticated using (false) with check (false);
create table public.rwn_account_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  request_type text not null default 'delete_account' check (request_type = 'delete_account')
);
alter table public.rwn_account_requests enable row level security;
grant select, insert on public.rwn_account_requests to authenticated;
grant all on public.rwn_account_requests to service_role;
create policy own_account_request on public.rwn_account_requests for select to authenticated using (user_id = (select auth.uid()) or (select rwn_private.is_editor()));
create policy request_own_deletion on public.rwn_account_requests for insert to authenticated with check (user_id = (select auth.uid()));
comment on table public.rwn_account_requests is 'Administrator worklist for contributor account deletion requests. Process by revoking sessions and deleting the Auth user; related private notes cascade.';
