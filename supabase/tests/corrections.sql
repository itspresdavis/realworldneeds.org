-- Local synthetic fixtures only. Every row and configuration change rolls back.
begin;
do $$ declare object record; begin
  if has_schema_privilege('anon','rwn_private','USAGE') then raise exception 'Anonymous gained private schema usage'; end if;
  for object in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rwn_private' loop
    if has_function_privilege('anon',object.oid,'EXECUTE') then raise exception 'Anonymous can execute private function %',object.proname; end if;
  end loop;
  for object in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rwn_private' and c.relkind in ('r','v','m','p') loop
    if has_table_privilege('anon',object.oid,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Anonymous private table grant %',object.relname; end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  if public.rwn_correction_status() then raise exception 'Intake enabled without approval'; end if;
  begin
    perform public.rwn_submit_correction('qa-fixture-1','wrong-hours','',gen_random_uuid(),repeat('a',64));
    raise exception 'Disabled intake accepted a report';
  exception when sqlstate 'PT503' then null; end;
  begin perform * from rwn_private.corrections; raise exception 'Anonymous queue readable'; exception when insufficient_privilege then null; end;
  begin perform * from rwn_private.correction_config; raise exception 'Capability config readable'; exception when insufficient_privilege then null; end;
  begin perform public.rwn_correction_queue(); raise exception 'Anonymous review RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update rwn_private.correction_config set enabled=true,
  capability_sha256=encode(sha256(convert_to('synthetic-test-capability-never-configured-remotely-123456','UTF8')),'hex'),
  approval_ref='fixture-local-only',retention_days=2,actor_hour_limit=2,global_hour_limit=4 where singleton;
do $$ begin
  perform set_config('request.headers',jsonb_build_object('x-rwn-correction-key','synthetic-test-capability-never-configured-remotely-123456','x-rwn-correction-approval','wrong-approval')::text,true);
end $$;
set local role anon;
do $$ begin
  if public.rwn_correction_status() then raise exception 'Wrong approval accepted'; end if;
end $$;
reset role;
do $$ begin
  perform set_config('request.headers',jsonb_build_object('x-rwn-correction-key','synthetic-test-capability-never-configured-remotely-123456','x-rwn-correction-approval','fixture-local-only')::text,true);
end $$;
set local role anon;
do $$ declare accepted jsonb; begin
  if public.rwn_correction_status() is not true then raise exception 'Configured intake unavailable'; end if;
  accepted:=public.rwn_submit_correction('qa-fixture-1','wrong-address','Synthetic correction note.', '00000000-0000-4000-8000-000000000001',repeat('a',64));
  if accepted<>'{"accepted":true}'::jsonb then raise exception 'Unexpected public response'; end if;
  perform public.rwn_submit_correction('qa-fixture-1','wrong-address','Synthetic correction note.', '00000000-0000-4000-8000-000000000001',repeat('a',64));
  begin
    perform public.rwn_submit_correction('qa-fixture-1','wrong-address','Changed payload.', '00000000-0000-4000-8000-000000000001',repeat('a',64));
    raise exception 'Mismatched retry accepted';
  exception when sqlstate 'PT409' then null; end;
  perform public.rwn_submit_correction('qa-fixture-1','wrong-address','Synthetic correction note.', '00000000-0000-4000-8000-000000000002',repeat('a',64));
  begin
    perform public.rwn_submit_correction('qa-fixture-1','wrong-hours','Another report.',gen_random_uuid(),repeat('a',64));
    raise exception 'Actor quota bypassed';
  exception when sqlstate 'PT429' then null; end;
  begin
    perform public.rwn_submit_correction('not-a-listing','wrong-hours','',gen_random_uuid(),repeat('b',64));
    raise exception 'Unknown listing accepted';
  exception when sqlstate 'PT404' then null; end;
  begin
    perform public.rwn_submit_correction('qa-fixture-1','other','',gen_random_uuid(),repeat('b',64));
    raise exception 'Unsupported category accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.rwn_submit_correction('qa-fixture-1','wrong-hours',repeat('x',1001),gen_random_uuid(),repeat('b',64));
    raise exception 'Oversized note accepted';
  exception when invalid_parameter_value then null; end;
  perform public.rwn_submit_correction('qa-fixture-1','wrong-hours','Another report.',gen_random_uuid(),repeat('b',64));
  perform public.rwn_submit_correction('qa-fixture-2','closed-service','Different location.',gen_random_uuid(),repeat('c',64));
  begin
    perform public.rwn_submit_correction('qa-fixture-2','broken-source','Global cap.',gen_random_uuid(),repeat('d',64));
    raise exception 'Global quota bypassed';
  exception when sqlstate 'PT429' then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from rwn_private.corrections)<>3 then raise exception 'Duplicates were not collapsed'; end if;
  if (select count(*) from rwn_private.correction_receipts)<>4 then raise exception 'Retry created additional receipts'; end if;
  if (select count from rwn_private.correction_limits where bucket='global')<>4 then raise exception 'Rejected transactions consumed quota'; end if;
  if exists(select 1 from rwn_private.correction_events where to_jsonb(correction_events)::text like '%Synthetic correction note.%') then raise exception 'Submission text copied into event history'; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('b0de7236-ea12-42d2-9201-555500000011','correction-editor@example.invalid',now()),
 ('b0de7236-ea12-42d2-9201-555500000012','correction-contributor@example.invalid',now()),
 ('b0de7236-ea12-42d2-9201-555500000013','correction-unconfirmed@example.invalid',null);
insert into public.rwn_members(user_id,role) values
 ('b0de7236-ea12-42d2-9201-555500000011','editor'),
 ('b0de7236-ea12-42d2-9201-555500000013','editor');
do $$ begin
  perform set_config('rwn.qa_catalog_before',(select md5(string_agg(record::text,id order by id)) from public.rwn_locations),true);
  perform set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000012","role":"authenticated","user_metadata":{"role":"admin"}}',true);
end $$;
set local role authenticated;
do $$ begin
  begin perform public.rwn_correction_queue(); raise exception 'Contributor review allowed'; exception when insufficient_privilege then null; end;
  begin perform * from rwn_private.corrections; raise exception 'Contributor raw queue readable'; exception when insufficient_privilege then null; end;
  begin perform rwn_private.purge_corrections(); raise exception 'Contributor purge allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000013","role":"authenticated"}',true); end $$;
set local role authenticated;
do $$ begin
  begin perform public.rwn_correction_queue(); raise exception 'Unconfirmed member allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000011","role":"authenticated"}',true); end $$;
set local role authenticated;
do $$ declare listing jsonb; report_id uuid; result jsonb; begin
  listing:=public.rwn_correction_queue();
  if listing->'reports'->0->>'sourceUrl' <> 'https://example.invalid' or listing->'reports'->0->>'lastChecked' <> '2026-08-04' then raise exception 'Trusted source snapshot missing'; end if;
  if jsonb_array_length(listing->'reports')<>3 then raise exception 'Editor queue incomplete'; end if;
  report_id:=(listing->'reports'->0->>'id')::uuid;
  begin
    perform public.rwn_decide_correction(report_id,1,'ready','urgent','self','Source reviewed; evidence required.','');
    raise exception 'Terminal decision without evidence';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.rwn_decide_correction(report_id,1,'ready','urgent','self','Unsafe reference must be denied.','https://user:pass@example.invalid');
    raise exception 'Credential URL accepted';
  exception when invalid_parameter_value then null; end;
  result:=public.rwn_decide_correction(report_id,1,'ready','urgent','self','Official source supports the correction.','https://example.invalid/source');
  if result->'report'->>'status'<>'ready' or (result->'report'->>'revision')::integer<>2 then raise exception 'Reviewed candidate not recorded'; end if;
  begin
    perform public.rwn_decide_correction(report_id,1,'rejected','normal','keep','Stale decision must fail.','https://example.invalid/source');
    raise exception 'Stale revision accepted';
  exception when sqlstate 'PT409' then null; end;
  result:=public.rwn_correction_queue(0,'all',report_id);
  if jsonb_array_length(result->'events')<>2 then raise exception 'Decision history incomplete'; end if;
  if result->'events'->0->>'actorId'<>'b0de7236-ea12-42d2-9201-555500000011' then raise exception 'Actor not tied to trusted identity'; end if;
  begin update rwn_private.correction_events set reason='Tampered private history.'; raise exception 'Editor can rewrite history'; exception when insufficient_privilege then null; end;
  begin delete from rwn_private.correction_events; raise exception 'Editor can delete history'; exception when insufficient_privilege then null; end;
  begin update rwn_private.correction_config set enabled=true; raise exception 'Editor can enable intake'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A ready report alone did not change any catalog row. A separate explicit
-- editor action uses the existing location policy/revision/audit boundary.
-- The outer fixture keeps this independent action reversible.
do $$ begin
  if (select md5(string_agg(record::text,id order by id)) from public.rwn_locations)<>current_setting('rwn.qa_catalog_before') then raise exception 'Ready decision changed public catalog'; end if;
end $$;
savepoint reviewed_catalog_change;
set local role authenticated;
do $$ declare revision timestamptz; affected integer; begin
  select updated_at into revision from public.rwn_locations where id='qa-fixture-1';
  update public.rwn_locations set record=jsonb_set(record,'{summary}','"Synthetic source-backed correction after separate editorial action."'::jsonb),
    editorial_note='Synthetic correction independently checked against its official source.'
    where id='qa-fixture-1' and updated_at=revision;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Separate reviewed catalog edit failed'; end if;
  if not exists(select 1 from public.rwn_location_history where location_id='qa-fixture-1'
      and actor_id=auth.uid() and after_record->'record'->>'summary'='Synthetic source-backed correction after separate editorial action.')
    then raise exception 'Reviewed catalog edit lacks immutable evidence'; end if;
end $$;
reset role;
rollback to savepoint reviewed_catalog_change;
delete from public.rwn_members where user_id='b0de7236-ea12-42d2-9201-555500000011';
set local role authenticated;
do $$ begin
  begin perform public.rwn_correction_queue(); raise exception 'Revoked editor can read queue'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select md5(string_agg(record::text,id order by id)) from public.rwn_locations)<>current_setting('rwn.qa_catalog_before') then raise exception 'Correction changed public catalog'; end if;
end $$;
update rwn_private.corrections set created_at=now()-interval '3 days';
update rwn_private.correction_limits set starts_at=now()-interval '3 days';
do $$ begin
  if (rwn_private.purge_corrections()->>'reports')::integer<>3 then raise exception 'Approved operator retention failed'; end if;
  if exists(select 1 from rwn_private.correction_events) or exists(select 1 from rwn_private.correction_receipts) or exists(select 1 from rwn_private.correction_limits) then raise exception 'Expired correction data retained'; end if;
end $$;
insert into rwn_private.corrections(resource_id,listing_name,source_url,last_checked,category,note,fingerprint,created_at)
select 'retention-fixture','Synthetic retention fixture','https://example.invalid','2026-08-04','wrong-hours','',i::text,now()-interval '3 days' from generate_series(1,1001) i;
do $$ declare removed integer; begin
  removed := (rwn_private.purge_corrections()->>'reports')::integer;
  if removed<>1000 or (select count(*) from rwn_private.corrections)<>1 then raise exception 'Operator purge is not bounded'; end if;
  if (rwn_private.purge_corrections()->>'reports')::integer<>1 then raise exception 'Operator purge cannot continue'; end if;
end $$;
-- A single report can have many dedupe receipts and reviewer decisions. The
-- bound must include those children, not only the number of parent reports.
insert into rwn_private.corrections(id,resource_id,listing_name,source_url,last_checked,category,note,fingerprint,created_at)
values('00000000-0000-4000-8000-000000001001','child-retention-fixture','Synthetic child retention fixture','https://example.invalid','2026-08-04','wrong-hours','','child-retention-fixture',now()-interval '3 days');
insert into rwn_private.correction_receipts(submission_id,fingerprint,report_id)
select gen_random_uuid(),i::text,'00000000-0000-4000-8000-000000001001' from generate_series(1,1001) i;
insert into rwn_private.correction_events(report_id,status,priority,reason)
select '00000000-0000-4000-8000-000000001001','open','normal','Synthetic retention event.' from generate_series(1,1001);
do $$ declare removed jsonb; begin
  removed := rwn_private.purge_corrections();
  if removed <> '{"reports":0,"receipts":1000,"events":1000,"rateBuckets":0}'::jsonb then raise exception 'Child deletion work exceeded its bound or counts are incomplete: %',removed; end if;
  if (select count(*) from rwn_private.corrections)<>1 or (select count(*) from rwn_private.correction_receipts)<>1 or (select count(*) from rwn_private.correction_events)<>1 then raise exception 'Parent removed before its children drained'; end if;
  removed := rwn_private.purge_corrections();
  if removed <> '{"reports":1,"receipts":1,"events":1,"rateBuckets":0}'::jsonb then raise exception 'Final child/parent drain incorrect: %',removed; end if;
  raise notice 'PASS: correction gates, durable duplicates/quotas, reviewer isolation, revisions, immutable history, unchanged catalog and retention';
end $$;
rollback;
