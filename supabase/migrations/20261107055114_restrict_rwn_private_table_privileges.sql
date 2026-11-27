-- Historical hosted default grants gave client roles table-maintenance rights.
-- RLS does not protect TRUNCATE or sequence mutation. Limit only RWN objects;
-- keep existing row policies, catalog field grants and owner audit triggers.
revoke all privileges on table public.rwn_members, public.rwn_reviews,
  public.rwn_location_history, public.rwn_account_requests
  from public, anon, authenticated;
grant select on table public.rwn_members, public.rwn_location_history to authenticated;
grant select, insert on table public.rwn_reviews, public.rwn_account_requests to authenticated;
revoke all privileges on sequence public.rwn_location_history_id_seq from public, anon, authenticated;
revoke insert, update, delete on table public.rwn_locations from public, anon;
revoke truncate, references, trigger, maintain on table public.rwn_locations from public, anon, authenticated;
