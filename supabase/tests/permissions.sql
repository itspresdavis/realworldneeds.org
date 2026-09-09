-- Run with the Supabase SQL editor or execute_sql. Everything rolls back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
('b0de7236-ea12-42d2-9201-555500000001','rwn-policy-editor@example.invalid',now()),
('b0de7236-ea12-42d2-9201-555500000002','rwn-policy-contributor@example.invalid',now());
insert into public.rwn_members(user_id,role) values ('b0de7236-ea12-42d2-9201-555500000001','editor');
select set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000002","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ declare affected integer; begin
  if (select count(*) from public.rwn_locations) = 0 then raise exception 'Contributor cannot read published records'; end if;
  if (select count(*) from public.rwn_members) <> 0 then raise exception 'Membership leaked'; end if;
  update public.rwn_locations set editorial_note='Unauthorized contributor change';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Contributor changed catalog'; end if;
  begin
    insert into public.rwn_members(user_id,role) values ('b0de7236-ea12-42d2-9201-555500000002','admin');
    raise exception 'Contributor escalated privileges';
  exception when insufficient_privilege then null; end;
  insert into public.rwn_reviews(location_id,author_id,note) select id,'b0de7236-ea12-42d2-9201-555500000002','Policy verification note; rolled back.' from public.rwn_locations limit 1;
  begin
    insert into public.rwn_reviews(location_id,author_id,note) select id,'b0de7236-ea12-42d2-9201-555500000001','Forged author; must be rejected.' from public.rwn_locations limit 1;
    raise exception 'Review author could be forged';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000001","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ declare target text; revision timestamptz; affected integer; begin
  select id,updated_at into target,revision from public.rwn_locations limit 1;
  update public.rwn_locations set editorial_note='Editor permission verification; rolled back.',published=false where id=target and updated_at=revision;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Editor update failed'; end if;
  if not exists(select 1 from public.rwn_location_history where location_id=target and actor_id='b0de7236-ea12-42d2-9201-555500000001' and operation='UPDATE') then raise exception 'Audit event missing'; end if;
  if not exists(select 1 from public.rwn_locations where id=target and not published) then raise exception 'Editor cannot read withheld record'; end if;
  update public.rwn_locations set editorial_note='Stale version must not write.' where id=target and updated_at=revision;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Optimistic concurrency failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  if exists(select 1 from public.rwn_locations where not published) then raise exception 'Withheld listing leaked'; end if;
  if exists(select 1 from public.rwn_reviews) then raise exception 'Private review leaked'; end if;
  if exists(select 1 from public.rwn_location_history) then raise exception 'Audit history leaked'; end if;
end $$;
reset role;
rollback;
