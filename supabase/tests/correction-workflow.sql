-- Synthetic local-only data. No real account, provider change, or hosted test report.
begin;
update rwn_private.correction_config set enabled=true,
  capability_sha256=encode(sha256(convert_to('synthetic-test-capability-never-configured-remotely-123456','UTF8')),'hex'),
  approval_ref='fixture-workflow',retention_days=2,actor_hour_limit=50,global_hour_limit=100 where singleton;
insert into auth.users(id,email,email_confirmed_at) values ('b0de7236-ea12-42d2-9201-555500000031','workflow-editor@example.invalid',now());
insert into public.rwn_members(user_id,role) values ('b0de7236-ea12-42d2-9201-555500000031','editor');
update public.rwn_locations set record=record||'{"serviceAccess":[{"id":"meals"}]}'::jsonb where id='qa-fixture-1';
do $$ begin
  perform set_config('request.headers',jsonb_build_object('x-rwn-correction-key','synthetic-test-capability-never-configured-remotely-123456','x-rwn-correction-approval','fixture-workflow')::text,true);
end $$;
set local role anon;
do $$ declare result jsonb; begin
  result:=public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','Synthetic service detail.','00000000-0000-4000-8000-000000000021',repeat('a',64),'{"serviceId":"meals","proposedCorrection":"Unverified user suggestion","sourceUrl":"https://example.invalid/source","replyContact":"synthetic@example.invalid"}');
  if result<>'{"accepted":true}'::jsonb then raise exception 'Private details leaked in receipt'; end if;
  perform public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','Synthetic service detail.','00000000-0000-4000-8000-000000000021',repeat('a',64),'{"serviceId":"meals","proposedCorrection":"Unverified user suggestion","sourceUrl":"https://example.invalid/source","replyContact":"synthetic@example.invalid"}');
  begin
    perform public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','Synthetic service detail.','00000000-0000-4000-8000-000000000021',repeat('a',64),'{"replyContact":"different@example.invalid"}');
    raise exception 'Different reply information reused a receipt';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','',gen_random_uuid(),repeat('a',64),'{"serviceId":"imaginary-route"}');
    raise exception 'Invented service context accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','',gen_random_uuid(),repeat('a',64),'{"sourceUrl":"https://user:pass@example.invalid"}');
    raise exception 'Unsafe proposed source accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.rwn_submit_correction_v2('qa-fixture-1','wrong-hours','',gen_random_uuid(),repeat('a',64),'{"replyContact":"private"}');
    raise exception 'Unbounded reply route accepted';
  exception when invalid_parameter_value then null; end;
  begin perform reply_contact from rwn_private.corrections; raise exception 'Anonymous reply contact disclosure'; exception when insufficient_privilege then null; end;
  perform public.rwn_submit_correction_v2('rwn-website','accessibility','Synthetic keyboard barrier.',gen_random_uuid(),repeat('b',64),'{}');
  begin perform public.rwn_submit_correction('qa-fixture-2','accessibility','',gen_random_uuid(),repeat('b',64)); raise exception 'Wrong accessibility context accepted'; exception when invalid_parameter_value then null; end;
  perform public.rwn_submit_correction_v2('qa-fixture-2','wrong-hours','Unverified report text.','00000000-0000-4000-8000-000000000022',repeat('c',64),'{"proposedCorrection":"Unverified proposed hours"}');
end $$;
reset role;
do $$ begin
  if (select count(*) from rwn_private.correction_receipts)<>3 then raise exception 'Submission retry duplicated receipt'; end if;
  if not exists(select 1 from rwn_private.corrections where service_id='meals' and reply_contact='synthetic@example.invalid' and original_record->>'id'='qa-fixture-1') then raise exception 'Report context not persisted'; end if;
  if exists(select 1 from rwn_private.correction_events where to_jsonb(correction_events)::text like '%synthetic@example.invalid%') then raise exception 'Private email in decision events'; end if;
  perform set_config('rwn.qa_workflow_id',(select id::text from rwn_private.corrections where resource_id='qa-fixture-2'),true);
  perform set_config('request.jwt.claims','{"sub":"b0de7236-ea12-42d2-9201-555500000031","role":"authenticated"}',true);
end $$;
set local role authenticated;
do $$ declare report_id uuid:=current_setting('rwn.qa_workflow_id')::uuid; revision timestamptz; result jsonb; begin
  select updated_at into revision from public.rwn_locations where id='qa-fixture-2';
  begin perform public.rwn_apply_correction(report_id,1,revision,'{"hours":"Verified hours"}','Independent source review.','https://example.invalid/source'); raise exception 'Unreviewed report applied'; exception when invalid_parameter_value then null; end;
  perform public.rwn_decide_correction(report_id,1,'rejected','normal','self','Source does not support this proposal.','https://example.invalid/source');
  begin perform public.rwn_decide_correction(report_id,2,'ready','normal','keep','Must reopen for source review first.','https://example.invalid/source'); raise exception 'Rejected report jumped to ready'; exception when invalid_parameter_value then null; end;
  perform public.rwn_decide_correction(report_id,2,'in-review','normal','self','Reopening after new official evidence.','https://example.invalid/source');
  perform public.rwn_decide_correction(report_id,3,'ready','normal','self','Independent official source review complete.','https://example.invalid/source');
  begin perform public.rwn_apply_correction(report_id,4,revision-interval '1 second','{"hours":"Verified hours"}','Independent source review.','https://example.invalid/source'); raise exception 'Stale catalog revision applied'; exception when sqlstate 'PT409' then null; end;
  begin perform public.rwn_apply_correction(report_id,4,revision,'{"lastChecked":"2026-11-07"}','Independent source review.','https://example.invalid/source'); raise exception 'Broad freshness changed from a narrow correction'; exception when invalid_parameter_value then null; end;
  result:=public.rwn_apply_correction(report_id,4,revision,'{"hours":"Monday 9–12, independently reviewed fixture"}','Independent source review.','https://example.invalid/source');
  if result->'report'->>'status'<>'applied' or (result->'report'->>'revision')::integer<>5 then raise exception 'Application receipt incorrect'; end if;
  perform public.rwn_apply_correction(report_id,4,revision,'{"hours":"Monday 9–12, independently reviewed fixture"}','Independent source review.','https://example.invalid/source');
  begin perform public.rwn_apply_correction(report_id,4,revision,'{"hours":"Different retry"}','Independent source review.','https://example.invalid/source'); raise exception 'Changed retry applied twice'; exception when sqlstate 'PT409' then null; end;
  if (select record->>'hours' from public.rwn_locations where id='qa-fixture-2')<>'Monday 9–12, independently reviewed fixture' then raise exception 'Independent reviewed value missing'; end if;
  if not exists(select 1 from public.rwn_location_history where location_id='qa-fixture-2' and actor_id=auth.uid() and after_record->'record'->>'hours'='Monday 9–12, independently reviewed fixture') then raise exception 'Applied catalog change missing audit actor'; end if;
  begin perform public.rwn_decide_correction(report_id,5,'ready','normal','keep','Do not overwrite publication workflow.','https://example.invalid/source'); raise exception 'Applied status changed by generic review'; exception when invalid_parameter_value then null; end;
  begin perform public.rwn_resolve_correction(report_id,5,auth.uid(),'{}','abcdef012345'); raise exception 'Reviewer forged publication through direct RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from rwn_private.correction_events where report_id=current_setting('rwn.qa_workflow_id')::uuid and status='applied')<>1 then raise exception 'Duplicate catalog publication event'; end if;
  update rwn_private.correction_config set enabled=false where singleton;
  perform set_config('rwn.qa_applied_record',(select record::text from public.rwn_locations where id='qa-fixture-2'),true);
end $$;
set local role anon;
do $$ declare result jsonb; report_id uuid:=current_setting('rwn.qa_workflow_id')::uuid; begin
  begin perform public.rwn_resolve_correction(report_id,5,'b0de7236-ea12-42d2-9201-555500000031',current_setting('rwn.qa_applied_record')::jsonb||'{"hours":"Old public snapshot"}','abcdef012345'); raise exception 'Unpublished correction resolved'; exception when sqlstate 'PT409' then null; end;
  begin perform public.rwn_resolve_correction(report_id,5,'b0de7236-ea12-42d2-9201-555500000099',current_setting('rwn.qa_applied_record')::jsonb,'abcdef012345'); raise exception 'Unknown operator resolved report'; exception when insufficient_privilege then null; end;
  result:=public.rwn_resolve_correction(report_id,5,'b0de7236-ea12-42d2-9201-555500000031',current_setting('rwn.qa_applied_record')::jsonb,'abcdef012345');
  if result->'report'->>'status'<>'resolved' or result->'report'->>'resolvedRelease'<>'abcdef012345' then raise exception 'Confirmed publication receipt missing'; end if;
  perform public.rwn_resolve_correction(report_id,5,'b0de7236-ea12-42d2-9201-555500000031',current_setting('rwn.qa_applied_record')::jsonb,'abcdef012345');
end $$;
reset role;
do $$ begin
  if (select count(*) from rwn_private.correction_events where report_id=current_setting('rwn.qa_workflow_id')::uuid and status='resolved')<>1 then raise exception 'Publication retry duplicated event'; end if;
  perform set_config('request.headers','{}',true);
end $$;
set local role anon;
do $$ begin
  begin perform public.rwn_resolve_correction(current_setting('rwn.qa_workflow_id')::uuid,5,'b0de7236-ea12-42d2-9201-555500000031',current_setting('rwn.qa_applied_record')::jsonb,'abcdef012345'); raise exception 'Missing server capability resolved report'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin raise notice 'PASS: private details, accessibility context, review transitions, atomic catalog application, CAS/retry, source dates, release verification, denied roles'; end $$;
rollback;
