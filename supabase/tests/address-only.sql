begin;
do $$ declare base jsonb; candidate jsonb; patch jsonb; begin
  select record into base from public.rwn_locations where id='qa-fixture-2';
  base:=base||'{"locationPrecision":"address","lat":null,"lng":null,"address":"10 Fixture Street, Fixture City, US","serviceAccess":[{"mode":"walk-in","address":"10 Fixture Street, Fixture City, US","sourceUrl":"https://example.invalid/source","reviewedAt":"2026-11-07"}]}'::jsonb;
  update public.rwn_locations set record=base where id='qa-fixture-2';
  if (select latitude is not null or longitude is not null from public.rwn_locations where id='qa-fixture-2') then raise exception 'Address-only point manufactured'; end if;
  foreach patch in array array[
    '{"lat":42}'::jsonb, '{"lng":-71}'::jsonb, '{"kind":"locator"}'::jsonb,
    '{"city":""}'::jsonb, '{"country":""}'::jsonb, '{"address":"Somewhere"}'::jsonb,
    '{"address":"P.O. Box 12, Fixture City, US"}'::jsonb,
    '{"serviceAccess":[]}'::jsonb, '{"serviceAccess":[{"mode":"contact","address":"10 Fixture Street, Fixture City, US"}]}'::jsonb,
    '{"serviceAccess":[{"mode":"walk-in","address":"Another entrance, Fixture City, US"}]}'::jsonb
  ] loop
    begin
      candidate:=base||patch;
      update public.rwn_locations set record=candidate where id='qa-fixture-2';
      raise exception 'Invalid address-only contract accepted: %',patch;
    exception when check_violation then null; end;
  end loop;
  raise notice 'PASS: address-only physical facts without fictional coordinates and 10 invalid contracts';
end $$;
rollback;
