-- Contact-only records represent published phone/web access with no verified
-- walk-in coordinates. Ordinary mapped records must still have both coordinates;
-- the original latitude/longitude range checks continue to apply.
alter table public.rwn_locations alter column latitude drop not null;
alter table public.rwn_locations alter column longitude drop not null;
alter table public.rwn_locations add constraint rwn_location_coordinate_contract
check (coalesce(
  case when record->>'locationPrecision' = 'contact-only' then
    kind in ('locator', 'network')
    and latitude is null and longitude is null
    and length(trim(country)) > 0
    and jsonb_typeof(record->'coverageNote') = 'string'
    and length(trim(record->>'coverageNote')) > 0
    and jsonb_typeof(record->'eligibility') = 'string'
    and length(trim(record->>'eligibility')) > 0
    and jsonb_typeof(record->'address') = 'string'
    and length(trim(record->>'address')) > 0
    and (coalesce(record->>'phone', '') = '' or (
      jsonb_typeof(record->'phone') = 'string' and length(trim(record->>'phone')) > 0
      and jsonb_typeof(record->'phoneAccess') = 'string' and length(trim(record->>'phoneAccess')) > 0
    ))
    and (coalesce(record->>'accessUrl', '') = '' or (
      jsonb_typeof(record->'accessUrl') = 'string'
      and record->>'accessUrl' ~ '^https://[^/@[:space:]]+([/?#]|$)'
    ))
    and (length(trim(coalesce(record->>'phone', ''))) > 0
      or length(trim(coalesce(record->>'accessUrl', ''))) > 0)
  else latitude is not null and longitude is not null end
, false));
