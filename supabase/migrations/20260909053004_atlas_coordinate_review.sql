-- A review worklist, not an assertion that coincident points are incorrect.
-- Shared venues and multiple services at one address can be legitimate.
create or replace view public.rwn_coordinate_review
with (security_invoker = true) as
with locations as (
  select id, name, country, kind, latitude, longitude, source_url,
         record->>'address' as address,
         record->>'locationPrecision' as declared_precision,
         last_checked, published,
         count(*) over (partition by latitude, longitude) as shared_coordinate_count
  from public.rwn_locations
)
select *,
  case
    when kind <> 'direct' then 'Coverage marker — not a walk-in destination'
    when shared_coordinate_count > 1 then 'Review shared coordinates'
    when declared_precision is distinct from 'exact' then 'Confirm source coordinate precision'
    when latitude = round(latitude::numeric, 2)
      and longitude = round(longitude::numeric, 2) then 'Review rounded coordinates'
    else 'Source-declared location'
  end as coordinate_review,
  'https://www.realworldneeds.org/service/' || id as listing_url
from locations;

comment on view public.rwn_coordinate_review is
  'Coordinate evidence worklist. Flags require source review; they do not authorize automatic geocoding or coordinate replacement.';
grant select on public.rwn_coordinate_review to authenticated, service_role;
