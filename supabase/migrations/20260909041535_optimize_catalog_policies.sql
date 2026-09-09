alter policy published_locations on public.rwn_locations to anon;
alter policy editor_read_locations on public.rwn_locations using (published or (select rwn_private.is_editor()));
alter policy submit_review on public.rwn_reviews with check (author_id = (select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create extension if not exists pg_trgm with schema extensions;
create index rwn_locations_search_idx on public.rwn_locations using gin (search_text extensions.gin_trgm_ops);
