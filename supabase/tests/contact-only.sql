-- The isolated runner supplies the actual published contact-only catalog record
-- in a transaction-local setting. No production listing is written by this test.
do $$
declare
  original jsonb := current_setting('rwn.qa_contact_record')::jsonb;
  candidate jsonb;
begin
  if original->>'id' <> 'centro-pop-carapicuiba' then raise exception 'Expected actual source fixture'; end if;
  insert into public.rwn_locations(id,record) values (original->>'id',original);
  if not exists(select 1 from public.rwn_locations where id=original->>'id'
    and latitude is null and longitude is null and kind='locator') then
    raise exception 'Actual contact-only record did not preserve its location semantics';
  end if;
  foreach candidate in array array[
    original || '{"kind":"direct"}'::jsonb,
    original || '{"lat":42}'::jsonb,
    original || '{"lng":-71}'::jsonb,
    original || '{"kind":"direct","locationPrecision":"exact"}'::jsonb,
    original || '{"kind":"direct","locationPrecision":"exact","lat":91,"lng":-71}'::jsonb,
    original || '{"kind":"direct","locationPrecision":"exact","lat":42,"lng":181}'::jsonb,
    original - array['phone','accessUrl'],
    original - 'phoneAccess',
    original - 'eligibility',
    original || '{"coverageNote":""}'::jsonb,
    original || '{"country":""}'::jsonb,
    original || '{"accessUrl":"javascript:alert(1)"}'::jsonb,
    original || '{"accessUrl":"https://user:pass@example.invalid"}'::jsonb
  ] loop
    candidate := candidate || '{"id":"qa-invalid-location"}'::jsonb;
    begin
      insert into public.rwn_locations(id,record) values(candidate->>'id',candidate);
      raise exception 'Invalid location contract was accepted: %',candidate;
    exception when check_violation or not_null_violation then null;
    end;
  end loop;
  candidate := original || '{"id":"qa-valid-mapped","kind":"direct","locationPrecision":"exact","lat":42,"lng":-71}'::jsonb;
  insert into public.rwn_locations(id,record) values(candidate->>'id',candidate);
  if not exists(select 1 from public.rwn_locations where id='qa-valid-mapped' and latitude=42 and longitude=-71) then
    raise exception 'Valid mapped coordinates were not preserved';
  end if;
  raise notice 'PASS: actual contact-only record, 13 invalid contract cases, valid mapped record';
end $$;
