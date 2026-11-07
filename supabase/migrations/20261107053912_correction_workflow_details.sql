-- Additive upgrade. Existing reports/receipts retain identity; intake remains disabled.
-- Optional reply contacts and proposals stay in the private queue only.
alter table rwn_private.corrections
  add column service_id text not null default '',
  add column proposed_correction text not null default '' check (length(proposed_correction)<=1000),
  add column proposed_source_url text not null default '' check (length(proposed_source_url)<=2048),
  add column reply_contact text not null default '' check (length(reply_contact)<=254),
  add column original_record jsonb not null default '{}'::jsonb,
  add column catalog_updated_at timestamptz,
  add column applied_record jsonb,
  add column applied_changes jsonb,
  add column applied_catalog_revision timestamptz,
  add column resolved_release text,
  add column resolved_at timestamptz;
alter table rwn_private.corrections drop constraint corrections_category_check;
alter table rwn_private.corrections add constraint corrections_category_check check(category in ('wrong-address','wrong-hours','closed-service','disconnected-phone','eligibility-change','no-longer-free','duplicate','broken-source','accessibility'));
alter table rwn_private.corrections drop constraint corrections_status_check;
alter table rwn_private.corrections add constraint corrections_status_check check(status in ('open','in-review','ready','applied','resolved','rejected','duplicate'));

create or replace function rwn_private.correction_json(r rwn_private.corrections) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',r.id,'resourceId',r.resource_id,'listingName',r.listing_name,
    'sourceUrl',r.source_url,'lastChecked',r.last_checked,'category',r.category,'note',r.note,'status',r.status,'priority',r.priority,
    'assignedTo',r.assigned_to,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,'duplicateCount',r.duplicate_count,
    'serviceId',r.service_id,'proposedCorrection',r.proposed_correction,'proposedSourceUrl',r.proposed_source_url,'replyContact',r.reply_contact,
    'originalRecord',r.original_record,'catalogUpdatedAt',r.catalog_updated_at,'appliedRecord',r.applied_record,'appliedChanges',r.applied_changes,
    'appliedCatalogRevision',r.applied_catalog_revision,'resolvedRelease',r.resolved_release,'resolvedAt',r.resolved_at);
$$;

create or replace function rwn_private.submit_correction_v2(p_resource_id text,p_category text,p_note text,p_submission_id uuid,p_actor text,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg rwn_private.correction_config; report_fingerprint text; prior rwn_private.correction_receipts; report_id uuid;
  title text; source text; checked text; headers jsonb; hour_start timestamptz := date_trunc('hour',now()); current_count integer; bucket_key text; maximum integer; listing jsonb; catalog_revision timestamptz; details jsonb;
begin
  -- Serializes the small bounded intake transaction, including duplicate checks
  -- and quota increments. A rejected transaction does not persist partial work.
  -- Reject missing/wrong capabilities before acquiring the shared lock.
  if rwn_private.correction_ingest_enabled() is not true then raise sqlstate 'PT503' using message='Correction intake unavailable'; end if;
  select * into cfg from rwn_private.correction_config where singleton for update;
  headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  -- Recheck the locked row in case approval was revoked while waiting.
  if cfg.enabled is not true or cfg.capability_sha256 is distinct from encode(sha256(convert_to(headers->>'x-rwn-correction-key','UTF8')),'hex')
    or cfg.approval_ref is distinct from headers->>'x-rwn-correction-approval'
    then raise sqlstate 'PT503' using message='Correction intake unavailable'; end if;
  if p_resource_id is null or length(p_resource_id) not between 1 and 160
    or p_category is null or p_category not in ('wrong-address','wrong-hours','closed-service','disconnected-phone','eligibility-change','no-longer-free','duplicate','broken-source','accessibility')
    or ((p_resource_id='rwn-website') is distinct from (p_category='accessibility'))
    or p_note is null or length(p_note)>1000 or p_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    or p_submission_id is null or p_actor is null or p_actor !~ '^[0-9a-f]{64}$'
    then raise sqlstate '22023' using message='Invalid correction fields'; end if;
  if p_details is null or jsonb_typeof(p_details)<>'object'
    or exists(select 1 from jsonb_each(p_details) where key not in ('serviceId','proposedCorrection','sourceUrl','replyContact') or jsonb_typeof(value)<>'string')
    then raise invalid_parameter_value using message='Invalid optional fields'; end if;
  details:=jsonb_build_object('serviceId',btrim(coalesce(p_details->>'serviceId','')),
    'proposedCorrection',btrim(coalesce(p_details->>'proposedCorrection','')),
    'sourceUrl',btrim(coalesce(p_details->>'sourceUrl','')),'replyContact',btrim(coalesce(p_details->>'replyContact','')));
  if length(details->>'serviceId')>80 or length(details->>'proposedCorrection')>1000 or length(details->>'sourceUrl')>2048 or length(details->>'replyContact')>254
    or exists(select 1 from jsonb_each_text(details) where value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
    or (details->>'sourceUrl'<>'' and (details->>'sourceUrl' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' or position(chr(92) in details->>'sourceUrl')>0))
    or (details->>'replyContact'<>'' and details->>'replyContact' !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$')
    then raise invalid_parameter_value using message='Invalid optional details'; end if;
  -- Retain the original fingerprint when no new fields were supplied, so old
  -- clients can safely retry a submission accepted before this upgrade.
  report_fingerprint := encode(sha256(convert_to((jsonb_build_array(p_resource_id,p_category,btrim(p_note)) ||
    case when details='{"serviceId":"","proposedCorrection":"","sourceUrl":"","replyContact":""}'::jsonb then '[]'::jsonb else jsonb_build_array(details) end)::text,'UTF8')),'hex');
  select * into prior from rwn_private.correction_receipts where submission_id=p_submission_id;
  if found then
    if prior.fingerprint<>report_fingerprint then raise sqlstate 'PT409' using message='Retry does not match'; end if;
    return jsonb_build_object('accepted',true);
  end if;
  if p_resource_id='rwn-website' then
    title:='RWN website'; source:='https://www.realworldneeds.org/accessibility'; checked:='';
    listing:=jsonb_build_object('id','rwn-website','name',title,'sourceUrl',source);
  else
    select name,source_url,last_checked,record,updated_at into title,source,checked,listing,catalog_revision from public.rwn_locations where id=p_resource_id and published;
    if not found then raise sqlstate 'PT404' using message='Listing not available'; end if;
  end if;
  if details->>'serviceId'<>'' and not exists(select 1 from jsonb_array_elements(coalesce(listing->'serviceAccess','[]'::jsonb)) route where route->>'id'=details->>'serviceId') then raise invalid_parameter_value using message='Unknown service route'; end if;
  foreach bucket_key in array array['global',p_actor] loop
    maximum := case when bucket_key='global' then cfg.global_hour_limit else cfg.actor_hour_limit end;
    insert into rwn_private.correction_limits(bucket,starts_at,count) values(bucket_key,hour_start,1)
      on conflict(bucket,starts_at) do update set count=rwn_private.correction_limits.count+1
      returning count into current_count;
    if current_count>maximum then raise sqlstate 'PT429' using message='Correction limit reached'; end if;
  end loop;
  select id into report_id from rwn_private.corrections where corrections.fingerprint=report_fingerprint
    and created_at>now()-interval '24 hours' order by created_at,id limit 1;
  if found then
    update rwn_private.corrections set duplicate_count=duplicate_count+1 where id=report_id;
  else
    insert into rwn_private.corrections(resource_id,listing_name,source_url,last_checked,category,note,fingerprint,priority,service_id,proposed_correction,proposed_source_url,reply_contact,original_record,catalog_updated_at)
      values(p_resource_id,title,source,checked,p_category,btrim(p_note),report_fingerprint,case when p_category in ('wrong-address','closed-service') then 'urgent' else 'normal' end,details->>'serviceId',details->>'proposedCorrection',details->>'sourceUrl',details->>'replyContact',listing,catalog_revision)
      returning id into report_id;
    insert into rwn_private.correction_events(report_id,status,priority,reason)
      values(report_id,'open',case when p_category in ('wrong-address','closed-service') then 'urgent' else 'normal' end,'Public correction received; awaiting source review.');
  end if;
  insert into rwn_private.correction_receipts(submission_id,fingerprint,report_id) values(p_submission_id,report_fingerprint,report_id);
  return jsonb_build_object('accepted',true);
end $$;

create or replace function rwn_private.submit_correction(p_resource_id text,p_category text,p_note text,p_submission_id uuid,p_actor text) returns jsonb
language sql security definer set search_path='' as $$
 select rwn_private.submit_correction_v2(p_resource_id,p_category,p_note,p_submission_id,p_actor,'{}'::jsonb);
$$;
create function public.rwn_submit_correction_v2(p_resource_id text,p_category text,p_note text,p_submission_id uuid,p_actor text,p_details jsonb) returns jsonb
language sql security definer set search_path='' as $$ select rwn_private.submit_correction_v2(p_resource_id,p_category,p_note,p_submission_id,p_actor,p_details); $$;

create or replace function rwn_private.correction_queue(p_page integer,p_status text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report rwn_private.corrections; rows jsonb; events jsonb; more boolean;
begin
  if rwn_private.correction_editor() is not true then raise insufficient_privilege using message='Editor required'; end if;
  if p_page is null or p_page not between 0 and 9999 or p_status is null or p_status not in ('all','open','in-review','ready','applied','resolved','rejected','duplicate') then raise invalid_parameter_value using message='Invalid queue page'; end if;
  if p_id is not null then
    select * into report from rwn_private.corrections where id=p_id;
    if not found then raise sqlstate 'PT404' using message='Report not found'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('status',e.status,'priority',e.priority,'assignedTo',e.assigned_to,'reason',e.reason,'evidenceUrl',e.evidence_url,'actorId',e.actor_id,'createdAt',e.created_at) order by e.created_at desc,e.id desc),'[]'::jsonb) into events
      from (select * from rwn_private.correction_events where report_id=p_id order by created_at desc,id desc limit 50) e;
    return jsonb_build_object('report',rwn_private.correction_json(report),'events',events,'currentCatalog',(select jsonb_build_object('record',record,'updatedAt',updated_at,'published',published) from public.rwn_locations where id=report.resource_id));
  end if;
  select coalesce(jsonb_agg(rwn_private.correction_json(r) order by r.created_at,r.id),'[]'::jsonb) into rows
    from (select * from rwn_private.corrections where p_status='all' or status=p_status order by created_at,id offset p_page*20 limit 20) r;
  select exists(select 1 from rwn_private.corrections where p_status='all' or status=p_status offset p_page*20+20 limit 1) into more;
  return jsonb_build_object('reports',rows,'page',p_page,'hasMore',more);
end $$;
create or replace function rwn_private.decide_correction(p_id uuid,p_revision integer,p_status text,p_priority text,p_assignment text,p_reason text,p_evidence_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report rwn_private.corrections; assigned uuid;
begin
  if rwn_private.correction_editor() is not true then raise insufficient_privilege using message='Editor required'; end if;
  if p_id is null or p_revision is null or p_revision<1
    or p_status is null or p_status not in ('open','in-review','ready','rejected','duplicate')
    or p_priority is null or p_priority not in ('urgent','normal','low')
    or p_assignment is null or p_assignment not in ('keep','self','unassigned')
    or p_reason is null or length(btrim(p_reason)) not between 10 and 1000
    or p_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    or p_evidence_url is null or length(p_evidence_url)>2048
    or (p_evidence_url<>'' and p_evidence_url !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$')
    or (p_status in ('ready','rejected','duplicate') and p_evidence_url='')
    then raise invalid_parameter_value using message='Invalid review decision'; end if;
  select * into report from rwn_private.corrections where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Report not found'; end if;
  if report.revision<>p_revision then raise sqlstate 'PT409' using message='Report changed'; end if;
  if report.status in ('applied','resolved') or (report.status in ('rejected','duplicate') and p_status not in (report.status,'in-review')) then raise invalid_parameter_value using message='Reopen a terminal report for review before another decision'; end if;
  assigned := case when p_assignment='self' then auth.uid() when p_assignment='unassigned' then null else report.assigned_to end;
  update rwn_private.corrections set status=p_status,priority=p_priority,assigned_to=assigned,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into report;
  insert into rwn_private.correction_events(report_id,status,priority,assigned_to,actor_id,reason,evidence_url)
    values(p_id,p_status,p_priority,assigned,auth.uid(),btrim(p_reason),p_evidence_url);
  -- "ready" is a review candidate only. No location is inserted or updated.
  return jsonb_build_object('report',rwn_private.correction_json(report));
end $$;

-- An approved report is applied to the authoritative catalog atomically. This
-- does not update the static snapshot, public pages or caches: release is separate.
create function rwn_private.apply_correction(p_id uuid,p_revision integer,p_catalog_revision timestamptz,p_changes jsonb,p_reason text,p_evidence_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report rwn_private.corrections; listing public.rwn_locations; field record;
begin
  if rwn_private.correction_editor() is not true then raise insufficient_privilege using message='Editor required'; end if;
  if p_id is null or p_revision is null or p_revision<1 or p_catalog_revision is null
    or p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb
    or p_reason is null or length(btrim(p_reason)) not between 10 and 1000 or p_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    or p_evidence_url is null or length(p_evidence_url)>2048 or p_evidence_url !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' or position(chr(92) in p_evidence_url)>0
    then raise invalid_parameter_value using message='Invalid reviewed catalog change'; end if;
  for field in select key,value from jsonb_each(p_changes) loop
    if field.key not in ('summary','hours','phone','eligibility') or jsonb_typeof(field.value)<>'string'
      or length(btrim(field.value#>>'{}')) not between 1 and (case when field.key in ('summary','eligibility') then 2000 else 1000 end)
      or (field.value#>>'{}') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
      then raise invalid_parameter_value using message='Unsupported catalog change'; end if;
  end loop;
  select * into report from rwn_private.corrections where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Report not found'; end if;
  select * into listing from public.rwn_locations where id=report.resource_id for update;
  if not found then raise sqlstate 'PT404' using message='Listing not found'; end if;
  -- A lost response can be retried without a second catalog edit or audit event.
  if report.status='applied' and report.revision=p_revision+1 and report.applied_changes=p_changes
    and listing.updated_at=report.applied_catalog_revision and listing.record=report.applied_record
    then return jsonb_build_object('report',rwn_private.correction_json(report)); end if;
  if report.revision<>p_revision or listing.updated_at<>p_catalog_revision then raise sqlstate 'PT409' using message='Report or catalog changed'; end if;
  if report.status<>'ready' then raise invalid_parameter_value using message='Review the source before applying a correction'; end if;
  -- Service-specific facts require a full source review, not a generic overwrite.
  if listing.record ? 'serviceAccess' and p_changes ?| array['hours','eligibility'] then raise invalid_parameter_value using message='Review the specific service routes in the full catalog'; end if;
  if listing.record || p_changes = listing.record then raise invalid_parameter_value using message='No catalog change supplied'; end if;
  update public.rwn_locations set record=record||p_changes,editorial_note=btrim(p_reason)
    where id=report.resource_id returning * into listing;
  update rwn_private.corrections set status='applied',revision=revision+1,updated_at=clock_timestamp(),
    applied_record=listing.record,applied_changes=p_changes,applied_catalog_revision=listing.updated_at
    where id=p_id returning * into report;
  insert into rwn_private.correction_events(report_id,status,priority,assigned_to,actor_id,reason,evidence_url)
    values(p_id,'applied',report.priority,report.assigned_to,auth.uid(),btrim(p_reason),p_evidence_url);
  return jsonb_build_object('report',rwn_private.correction_json(report));
end $$;
create function public.rwn_apply_correction(p_id uuid,p_revision integer,p_catalog_revision timestamptz,p_changes jsonb,p_reason text,p_evidence_url text) returns jsonb
language sql security invoker set search_path='' as $$ select rwn_private.apply_correction(p_id,p_revision,p_catalog_revision,p_changes,p_reason,p_evidence_url); $$;

-- Only the existing server capability can record release verification. The API
-- independently verifies a confirmed editor and the exact deployed public record.
-- No reviewer-supplied URL, release claim or arbitrary RPC can bypass this gate.
create function rwn_private.correction_server_authorized() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare headers jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb); key text;
begin
  key:=headers->>'x-rwn-correction-key';
  if key is null or key !~ '^[A-Za-z0-9_-]{43,128}$' then return false; end if;
  return exists(select 1 from rwn_private.correction_config where singleton and approval_ref=headers->>'x-rwn-correction-approval'
    and retention_days is not null and capability_sha256=encode(sha256(convert_to(key,'UTF8')),'hex'));
end $$;
create function rwn_private.resolve_correction(p_id uuid,p_revision integer,p_actor uuid,p_record jsonb,p_release text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report rwn_private.corrections; listing public.rwn_locations;
begin
  if rwn_private.correction_server_authorized() is not true
    or not exists(select 1 from auth.users u join public.rwn_members m on m.user_id=u.id where u.id=p_actor and u.email_confirmed_at is not null and m.role in ('editor','admin'))
    then raise insufficient_privilege using message='Verified operator required'; end if;
  if p_id is null or p_revision is null or p_revision<1 or p_record is null or jsonb_typeof(p_record)<>'object' or p_release is null or p_release !~ '^[0-9a-f]{12}$'
    then raise invalid_parameter_value using message='Invalid publication evidence'; end if;
  select * into report from rwn_private.corrections where id=p_id for update;
  if not found then raise sqlstate 'PT404' using message='Report not found'; end if;
  select * into listing from public.rwn_locations where id=report.resource_id for share;
  if not found or listing.published is not true or listing.record is distinct from p_record or report.applied_record is distinct from p_record
    then raise sqlstate 'PT409' using message='Published record differs from reviewed catalog'; end if;
  if report.status='resolved' and report.revision=p_revision+1 and report.resolved_release=p_release then return jsonb_build_object('report',rwn_private.correction_json(report)); end if;
  if report.revision<>p_revision then raise sqlstate 'PT409' using message='Report changed'; end if;
  if report.status<>'applied' then raise invalid_parameter_value using message='Catalog application required'; end if;
  update rwn_private.corrections set status='resolved',revision=revision+1,updated_at=clock_timestamp(),resolved_at=clock_timestamp(),resolved_release=p_release where id=p_id returning * into report;
  insert into rwn_private.correction_events(report_id,status,priority,assigned_to,actor_id,reason,evidence_url)
    values(p_id,'resolved',report.priority,report.assigned_to,p_actor,'Public release verified against the reviewed catalog record.','https://www.realworldneeds.org/data/release.json');
  return jsonb_build_object('report',rwn_private.correction_json(report));
end $$;
create function public.rwn_resolve_correction(p_id uuid,p_revision integer,p_actor uuid,p_record jsonb,p_release text) returns jsonb
language sql security definer set search_path='' as $$ select rwn_private.resolve_correction(p_id,p_revision,p_actor,p_record,p_release); $$;
revoke all on function rwn_private.correction_server_authorized(),rwn_private.submit_correction_v2(text,text,text,uuid,text,jsonb),public.rwn_submit_correction_v2(text,text,text,uuid,text,jsonb),rwn_private.apply_correction(uuid,integer,timestamptz,jsonb,text,text),public.rwn_apply_correction(uuid,integer,timestamptz,jsonb,text,text),rwn_private.resolve_correction(uuid,integer,uuid,jsonb,text),public.rwn_resolve_correction(uuid,integer,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.rwn_submit_correction_v2(text,text,text,uuid,text,jsonb),public.rwn_resolve_correction(uuid,integer,uuid,jsonb,text) to anon;
grant execute on function rwn_private.apply_correction(uuid,integer,timestamptz,jsonb,text,text),public.rwn_apply_correction(uuid,integer,timestamptz,jsonb,text,text) to authenticated;
