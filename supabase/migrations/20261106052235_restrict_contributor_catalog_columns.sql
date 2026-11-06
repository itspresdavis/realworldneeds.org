-- A new authenticated signup is a contributor, not an editor. RLS controls
-- rows; it does not hide editorial_note columns in published rows.
revoke select on public.rwn_locations from authenticated;
revoke select (editorial_note) on public.rwn_locations from authenticated;
grant select (
  id, record, name, country, kind, latitude, longitude,
  source_url, last_checked, search_text, published, updated_at
) on public.rwn_locations to authenticated;

-- Editor/admin INSERT/UPDATE/DELETE rights remain subject to is_editor() RLS.
-- The API reads the public field allowlist after edits; internal reasons remain
-- available to editors in the RLS-protected immutable location history.
