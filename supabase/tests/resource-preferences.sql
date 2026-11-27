begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','preferences-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','preferences-b@example.invalid',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
insert into public.rwn_resource_preferences(user_id,topics,area,consent_version)
 values ('10000000-0000-4000-8000-000000000001','{food}','Boston',1);
update public.rwn_resource_preferences set topics='{food,water}' where user_id=auth.uid();
do $$ begin
 if (select topics from public.rwn_resource_preferences where user_id=auth.uid()) <> '{food,water}'::text[] then raise exception 'owner update failed'; end if;
 begin
  update public.rwn_resource_preferences set user_id='10000000-0000-4000-8000-000000000002';
  raise exception 'owner reassignment allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","is_anonymous":false}',true);
do $$ begin
 if exists(select 1 from public.rwn_resource_preferences) then raise exception 'another account can read answers'; end if;
 delete from public.rwn_resource_preferences where user_id='10000000-0000-4000-8000-000000000001';
 if found then raise exception 'another account can erase answers'; end if;
 begin
  insert into public.rwn_resource_preferences(user_id,topics,area,consent_version) values ('10000000-0000-4000-8000-000000000001','{health}','',1);
  raise exception 'another account can create answers';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","is_anonymous":true}',true);
do $$ begin if exists(select 1 from public.rwn_resource_preferences) then raise exception 'anonymous auth read allowed'; end if; end $$;
set local role anon;
do $$ begin
 begin perform * from public.rwn_resource_preferences; raise exception 'public read allowed'; exception when insufficient_privilege then null; end;
 begin truncate public.rwn_resource_preferences; raise exception 'public truncate allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
delete from public.rwn_resource_preferences where user_id=auth.uid();
do $$ begin if exists(select 1 from public.rwn_resource_preferences) then raise exception 'owner erase failed'; end if; end $$;
reset role;
rollback;
