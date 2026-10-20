-- Optional telemetry and intake tables.
-- FILE ONLY. This migration is not applied.
-- The repository's editorial project is cytfrxldixdapjaxcqzf.
-- Supabase project RWN-WEB (ref bbtjojbsprmituftbehl) is a different project.
-- Do not run this file against either database as part of the draft change.
-- No IP, user agent, URL query, or location columns.

create table if not exists public.rum_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  schema_version smallint not null default 2 check (schema_version between 0 and 10),
  event_type text not null check (event_type in ('performance','client_error','unhandled_rejection','webgl_context_lost')),
  route text not null check (route in ('finder','service','local_need_directory','local_directory','need_directory','region_directory','directory','country_directory','policy','other')),
  viewport_class text check (viewport_class in ('small','medium','large')),
  lcp_ms int check (lcp_ms is null or lcp_ms between 0 and 120000),
  inp_ms int check (inp_ms is null or inp_ms between 0 and 120000),
  fcp_ms int check (fcp_ms is null or fcp_ms between 0 and 120000),
  ttfb_ms int check (ttfb_ms is null or ttfb_ms between 0 and 120000),
  dom_ready_ms int check (dom_ready_ms is null or dom_ready_ms between 0 and 120000),
  long_tasks int check (long_tasks is null or long_tasks between 0 and 10000),
  cls numeric(6,3) check (cls is null or (cls >= 0 and cls <= 10)),
  error_name text check (error_name is null or length(error_name) <= 80),
  error_file text check (error_file is null or length(error_file) <= 80),
  error_line int check (error_line is null or error_line between 0 and 1000000),
  error_column int check (error_column is null or error_column between 0 and 1000000),
  release text check (release is null or length(release) <= 64),
  vercel_env text check (vercel_env is null or vercel_env in ('production','preview','development'))
);

create index if not exists rum_events_received_at_idx on public.rum_events (received_at desc);
create index if not exists rum_events_type_route_idx on public.rum_events (event_type, route, received_at desc);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('correction','new_listing','contact')),
  resource_id text check (resource_id is null or length(resource_id) <= 200),
  message text not null check (length(message) between 5 and 5000),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  status text not null default 'new' check (status in ('new','reviewed','resolved','spam')),
  vercel_env text check (vercel_env is null or vercel_env in ('production','preview','development'))
);

create index if not exists submissions_created_at_idx on public.submissions (created_at desc);

-- No policies: anon and authenticated cannot read or write through the Data API.
-- The server secret key uses a role that bypasses RLS. Table owners are forced
-- through RLS as well.
alter table public.rum_events enable row level security;
alter table public.submissions enable row level security;
alter table public.rum_events force row level security;
alter table public.submissions force row level security;

revoke all on public.rum_events, public.submissions from public, anon, authenticated;
grant select, insert on public.rum_events, public.submissions to service_role;
