-- Forward-only contract extension; published factual addresses do not need invented coordinates.
-- Validate the full service access contract in producers/API as well. Existing rows
-- are validated under the replacement constraint before this transaction commits.
do $$ begin
perform set_config('lock_timeout','2s',true);
alter table public.rwn_locations drop constraint rwn_location_coordinate_contract;
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
  when record->>'locationPrecision' = 'address' then
    kind='direct' and latitude is null and longitude is null
    and jsonb_typeof(record->'city')='string' and length(trim(record->>'city'))>0
    and length(trim(country))>0
    and jsonb_typeof(record->'address')='string' and length(trim(record->>'address')) between 8 and 400
    and position(',' in record->>'address')>0
    and record->>'address' !~* 'https?://|(^|[^a-z])p[.]?[ ]*o[.]?[ ]*box([^a-z]|$)|post[ ]+office[ ]+box'
    and jsonb_typeof(record->'serviceAccess')='array'
    and jsonb_path_exists(record, '$.serviceAccess[*] ? ((@.mode == "walk-in" || @.mode == "intake") && @.address == $address && @.sourceUrl like_regex "^https://[^/@ ]+" && @.reviewedAt like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}$")', jsonb_build_object('address',record->'address'))
  else latitude is not null and longitude is not null end
, false));

end $$;
