-- Disabled until an approved operator, retention/abuse policy and scoped server
-- capability are configured. No service-role credential or automatic publication.
create table rwn_private.correction_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  capability_sha256 text check (capability_sha256 ~ '^[0-9a-f]{64}$'),
  approval_ref text check (length(approval_ref) between 8 and 160),
  retention_days integer check (retention_days between 1 and 365),
  actor_hour_limit integer check (actor_hour_limit between 1 and 100),
  global_hour_limit integer check (global_hour_limit between 1 and 10000),
  check (not enabled or (capability_sha256 is not null and approval_ref is not null
    and retention_days is not null and actor_hour_limit is not null and global_hour_limit is not null))
);
insert into rwn_private.correction_config(singleton) values (true);
create table rwn_private.corrections (
  id uuid primary key default gen_random_uuid(),
  resource_id text not null,
  listing_name text not null,
  source_url text not null,
  last_checked text not null,
  category text not null check (category in ('wrong-address','wrong-hours','closed-service','disconnected-phone','eligibility-change','no-longer-free','duplicate','broken-source')),
  note text not null check (length(note) <= 1000),
  fingerprint text not null,
  status text not null default 'open' check (status in ('open','in-review','ready','rejected','duplicate')),
  priority text not null default 'normal' check (priority in ('urgent','normal','low')),
  assigned_to uuid,
  revision integer not null default 1,
  duplicate_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rwn_corrections_retention_idx on rwn_private.corrections(created_at,id);
create index rwn_corrections_queue_idx on rwn_private.corrections(status,created_at,id);
create index rwn_corrections_fingerprint_idx on rwn_private.corrections(fingerprint,created_at);
create table rwn_private.correction_receipts (
  submission_id uuid primary key,
  fingerprint text not null,
  report_id uuid not null references rwn_private.corrections(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index rwn_correction_receipts_report_idx on rwn_private.correction_receipts(report_id,created_at,submission_id);
create table rwn_private.correction_limits (
  bucket text not null,
  starts_at timestamptz not null,
  count integer not null check (count > 0),
  primary key(bucket,starts_at)
);
create index rwn_correction_limits_retention_idx on rwn_private.correction_limits(starts_at,bucket);
create table rwn_private.correction_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references rwn_private.corrections(id) on delete restrict,
  status text not null,
  priority text not null,
  assigned_to uuid,
  actor_id uuid,
  reason text not null check (length(reason) between 10 and 1000),
  evidence_url text not null default '',
  created_at timestamptz not null default now()
);
create index rwn_correction_events_idx on rwn_private.correction_events(report_id,created_at,id);
alter table rwn_private.correction_config enable row level security;
alter table rwn_private.corrections enable row level security;
alter table rwn_private.correction_receipts enable row level security;
alter table rwn_private.correction_limits enable row level security;
alter table rwn_private.correction_events enable row level security;
revoke all on rwn_private.correction_config,rwn_private.corrections,rwn_private.correction_receipts,rwn_private.correction_limits,rwn_private.correction_events from public,anon,authenticated,service_role;
revoke all on sequence rwn_private.correction_events_id_seq from public,anon,authenticated,service_role;

-- Only narrow entry points run as owner. Public intake wrappers are definers
-- so anonymous callers do not gain USAGE on the pre-existing private schema.
-- This capability intentionally permits anonymous intake, never table access.
create function rwn_private.correction_ingest_enabled() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare headers jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb); key text;
begin
  key := headers->>'x-rwn-correction-key';
  if key is null or key !~ '^[A-Za-z0-9_-]{43,128}$' then return false; end if;
  return exists(select 1 from rwn_private.correction_config where singleton and enabled
    and capability_sha256=encode(sha256(convert_to(key,'UTF8')),'hex')
    and approval_ref=headers->>'x-rwn-correction-approval');
end $$;

create function rwn_private.correction_editor() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and exists(select 1 from auth.users u join public.rwn_members m on m.user_id=u.id
      where u.id=auth.uid() and u.email_confirmed_at is not null and m.role in ('editor','admin'));
$$;

create function rwn_private.correction_json(r rwn_private.corrections) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',r.id,'resourceId',r.resource_id,'listingName',r.listing_name,
    'sourceUrl',r.source_url,'lastChecked',r.last_checked,'category',r.category,'note',r.note,'status',r.status,'priority',r.priority,
    'assignedTo',r.assigned_to,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
    'duplicateCount',r.duplicate_count);
$$;

create function rwn_private.submit_correction(p_resource_id text,p_category text,p_note text,p_submission_id uuid,p_actor text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg rwn_private.correction_config; report_fingerprint text; prior rwn_private.correction_receipts; report_id uuid;
  title text; source text; checked text; headers jsonb; hour_start timestamptz := date_trunc('hour',now()); current_count integer; bucket_key text; maximum integer;
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
    or p_category is null or p_category not in ('wrong-address','wrong-hours','closed-service','disconnected-phone','eligibility-change','no-longer-free','duplicate','broken-source')
    or p_note is null or length(p_note)>1000 or p_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    or p_submission_id is null or p_actor is null or p_actor !~ '^[0-9a-f]{64}$'
    then raise sqlstate '22023' using message='Invalid correction fields'; end if;
  report_fingerprint := encode(sha256(convert_to(jsonb_build_array(p_resource_id,p_category,btrim(p_note))::text,'UTF8')),'hex');
  select * into prior from rwn_private.correction_receipts where submission_id=p_submission_id;
  if found then
    if prior.fingerprint<>report_fingerprint then raise sqlstate 'PT409' using message='Retry does not match'; end if;
    return jsonb_build_object('accepted',true);
  end if;
  select name,source_url,last_checked into title,source,checked from public.rwn_locations where id=p_resource_id and published;
  if not found then raise sqlstate 'PT404' using message='Listing not available'; end if;
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
    insert into rwn_private.corrections(resource_id,listing_name,source_url,last_checked,category,note,fingerprint,priority)
      values(p_resource_id,title,source,checked,p_category,btrim(p_note),report_fingerprint,case when p_category in ('wrong-address','closed-service') then 'urgent' else 'normal' end)
      returning id into report_id;
    insert into rwn_private.correction_events(report_id,status,priority,reason)
      values(report_id,'open',case when p_category in ('wrong-address','closed-service') then 'urgent' else 'normal' end,'Public correction received; awaiting source review.');
  end if;
  insert into rwn_private.correction_receipts(submission_id,fingerprint,report_id) values(p_submission_id,report_fingerprint,report_id);
  return jsonb_build_object('accepted',true);
end $$;

create function rwn_private.correction_queue(p_page integer,p_status text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report rwn_private.corrections; rows jsonb; events jsonb; more boolean;
begin
  if rwn_private.correction_editor() is not true then raise insufficient_privilege using message='Editor required'; end if;
  if p_page is null or p_page not between 0 and 9999 or p_status is null or p_status not in ('all','open','in-review','ready','rejected','duplicate') then raise invalid_parameter_value using message='Invalid queue page'; end if;
  if p_id is not null then
    select * into report from rwn_private.corrections where id=p_id;
    if not found then raise sqlstate 'PT404' using message='Report not found'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('status',e.status,'priority',e.priority,'assignedTo',e.assigned_to,'reason',e.reason,'evidenceUrl',e.evidence_url,'actorId',e.actor_id,'createdAt',e.created_at) order by e.created_at desc,e.id desc),'[]'::jsonb) into events
      from (select * from rwn_private.correction_events where report_id=p_id order by created_at desc,id desc limit 50) e;
    return jsonb_build_object('report',rwn_private.correction_json(report),'events',events);
  end if;
  select coalesce(jsonb_agg(rwn_private.correction_json(r) order by r.created_at,r.id),'[]'::jsonb) into rows
    from (select * from rwn_private.corrections where p_status='all' or status=p_status order by created_at,id offset p_page*20 limit 20) r;
  select exists(select 1 from rwn_private.corrections where p_status='all' or status=p_status offset p_page*20+20 limit 1) into more;
  return jsonb_build_object('reports',rows,'page',p_page,'hasMore',more);
end $$;

create function rwn_private.decide_correction(p_id uuid,p_revision integer,p_status text,p_priority text,p_assignment text,p_reason text,p_evidence_url text) returns jsonb
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
  assigned := case when p_assignment='self' then auth.uid() when p_assignment='unassigned' then null else report.assigned_to end;
  update rwn_private.corrections set status=p_status,priority=p_priority,assigned_to=assigned,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into report;
  insert into rwn_private.correction_events(report_id,status,priority,assigned_to,actor_id,reason,evidence_url)
    values(p_id,p_status,p_priority,assigned,auth.uid(),btrim(p_reason),p_evidence_url);
  -- "ready" is a review candidate only. No location is inserted or updated.
  return jsonb_build_object('report',rwn_private.correction_json(report));
end $$;

-- Operator-only retention procedure; not scheduled or granted to client roles.
-- The approved report period also applies to its receipts and decision events.
-- Restrictive foreign keys prevent uncounted cascading deletes. Raw IPs and
-- submitted-note snapshots are never stored in event history.
create function rwn_private.purge_corrections() returns jsonb
language plpgsql set search_path='' set lock_timeout='2s' as $$
declare days integer; targets uuid[]; removed_reports bigint; removed_receipts bigint; removed_events bigint; removed_limits bigint;
begin
  select retention_days into days from rwn_private.correction_config where singleton;
  if days is null then raise invalid_parameter_value using message='Retention policy not approved'; end if;
  -- Lock at most 1,000 expired parents. FOR UPDATE conflicts with the FK key
  -- locks taken by child inserts, preventing new children inside this batch.
  -- Contention exceeding two seconds aborts the whole transaction for retry.
  select coalesce(array_agg(r.id),'{}'::uuid[]) into targets from (
    select id from rwn_private.corrections where created_at < now()-make_interval(days=>days)
    order by created_at,id limit 1000 for update
  ) r;
  -- At most 4,000 rows are deleted in total. Child-first bounded batches and
  -- RESTRICT foreign keys make the counts complete even for high-fanout reports.
  delete from rwn_private.correction_receipts where submission_id in (
    select submission_id from rwn_private.correction_receipts where report_id=any(targets)
    order by report_id,created_at,submission_id limit 1000);
  get diagnostics removed_receipts=row_count;
  delete from rwn_private.correction_events where id in (
    select id from rwn_private.correction_events where report_id=any(targets)
    order by report_id,created_at,id limit 1000);
  get diagnostics removed_events=row_count;
  delete from rwn_private.corrections r where r.id=any(targets)
    and not exists(select 1 from rwn_private.correction_receipts x where x.report_id=r.id)
    and not exists(select 1 from rwn_private.correction_events e where e.report_id=r.id);
  get diagnostics removed_reports=row_count;
  delete from rwn_private.correction_limits where (bucket,starts_at) in (select bucket,starts_at from rwn_private.correction_limits
    where starts_at < now()-interval '48 hours' order by starts_at,bucket limit 1000);
  get diagnostics removed_limits=row_count;
  return jsonb_build_object('reports',removed_reports,'receipts',removed_receipts,'events',removed_events,'rateBuckets',removed_limits);
end $$;

create function public.rwn_correction_status() returns boolean language sql security definer set search_path='' as $$ select rwn_private.correction_ingest_enabled(); $$;
create function public.rwn_submit_correction(p_resource_id text,p_category text,p_note text,p_submission_id uuid,p_actor text) returns jsonb language sql security definer set search_path='' as $$ select rwn_private.submit_correction(p_resource_id,p_category,p_note,p_submission_id,p_actor); $$;
create function public.rwn_correction_queue(p_page integer default 0,p_status text default 'open',p_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select rwn_private.correction_queue(p_page,p_status,p_id); $$;
create function public.rwn_decide_correction(p_id uuid,p_revision integer,p_status text,p_priority text,p_assignment text,p_reason text,p_evidence_url text) returns jsonb language sql security invoker set search_path='' as $$ select rwn_private.decide_correction(p_id,p_revision,p_status,p_priority,p_assignment,p_reason,p_evidence_url); $$;

revoke all on function rwn_private.correction_ingest_enabled(),rwn_private.correction_editor(),rwn_private.correction_json(rwn_private.corrections),rwn_private.submit_correction(text,text,text,uuid,text),rwn_private.correction_queue(integer,text,uuid),rwn_private.decide_correction(uuid,integer,text,text,text,text,text),rwn_private.purge_corrections(),public.rwn_correction_status(),public.rwn_submit_correction(text,text,text,uuid,text),public.rwn_correction_queue(integer,text,uuid),public.rwn_decide_correction(uuid,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.rwn_correction_status(),public.rwn_submit_correction(text,text,text,uuid,text) to anon;
grant execute on function rwn_private.correction_queue(integer,text,uuid),rwn_private.decide_correction(uuid,integer,text,text,text,text,text),public.rwn_correction_queue(integer,text,uuid),public.rwn_decide_correction(uuid,integer,text,text,text,text,text) to authenticated;
comment on table rwn_private.correction_config is 'Intake starts disabled. Configure only after explicit operational approval, secure capability setup and hosted acceptance.';
comment on table rwn_private.correction_events is 'Private append-only reviewer decisions; no submission text snapshots. Retention purge remains an operator action.';
