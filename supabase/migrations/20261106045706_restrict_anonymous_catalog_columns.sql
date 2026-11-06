-- A table-level SELECT grant includes columns added later, including the
-- internal editorial_note. Public readers need published facts, not reasons
-- supplied by editors. RLS continues to limit anonymous rows to published ones.
revoke select on public.rwn_locations from public, anon;
revoke select (editorial_note) on public.rwn_locations from public, anon;
grant select (
  id,
  record,
  name,
  country,
  kind,
  latitude,
  longitude,
  source_url,
  last_checked,
  search_text,
  published,
  updated_at
) on public.rwn_locations to anon;

-- Authenticated/editor and service-role grants are unchanged. New columns do
-- not become anonymously readable unless explicitly included in a migration.
