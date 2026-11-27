begin;
do $$ declare base jsonb; patch jsonb; begin
  select record into base from public.rwn_locations where id='qa-fixture-1';
  update public.rwn_locations set record=record||'{"datasetId":"fixture","sourceRecordId":"001"}'::jsonb where id='qa-fixture-1';
  -- A withheld row must not free the identity for accidental republication.
  update public.rwn_locations set published=false where id='qa-fixture-1';
  begin
    update public.rwn_locations set record=record||'{"datasetId":"fixture","sourceRecordId":"001"}'::jsonb where id='qa-fixture-2';
    raise exception 'Duplicate source identity accepted';
  exception when unique_violation then null; end;
  foreach patch in array array[
    '{"datasetId":"fixture"}'::jsonb, '{"sourceRecordId":"001"}'::jsonb,
    '{"datasetId":null,"sourceRecordId":"001"}'::jsonb,
    '{"datasetId":"fixture","sourceRecordId":1}'::jsonb,
    '{"datasetId":"fixture","sourceRecordId":" 001"}'::jsonb,
    '{"datasetId":"","sourceRecordId":"001"}'::jsonb
  ] loop
    begin
      update public.rwn_locations set record=base||patch where id='qa-fixture-1';
      raise exception 'Invalid source identity accepted: %',patch;
    exception when check_violation then null; end;
  end loop;
  -- Legitimate separate datasets and separate source rows remain distinct.
  update public.rwn_locations set record=record||'{"datasetId":"other","sourceRecordId":"001"}'::jsonb where id='qa-fixture-2';
  update public.rwn_locations set record=record||'{"datasetId":"fixture","sourceRecordId":"002"}'::jsonb where id='qa-fixture-2';
  raise notice 'PASS: source identity uniqueness, withheld protection and malformed provenance';
end $$;
rollback;
