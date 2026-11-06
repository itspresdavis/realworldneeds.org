-- ONLY for scripts/qa-postgres-permissions.py's isolated PostgreSQL container.
-- These stand-ins simulate JWT claims; they do not implement or test Supabase Auth.
do $$ begin
  if current_database() <> 'rwn_qa' then raise exception 'Isolated QA database required'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
create function auth.uid() returns uuid language sql stable as $$
  select (auth.jwt()->>'sub')::uuid;
$$;
