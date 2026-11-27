-- One provider dataset row has one catalog identity, including withheld rows.
-- Never delete/merge records to make this migration pass: conflicts need review.
alter table public.rwn_locations add constraint rwn_source_identity_pair check (
  (not (record ? 'datasetId') and not (record ? 'sourceRecordId')) or
  (jsonb_typeof(record->'datasetId') = 'string' and
   jsonb_typeof(record->'sourceRecordId') = 'string' and
   length(btrim(record->>'datasetId')) between 1 and 160 and
   length(btrim(record->>'sourceRecordId')) between 1 and 160 and
   record->>'datasetId' = btrim(record->>'datasetId') and
   record->>'sourceRecordId' = btrim(record->>'sourceRecordId')) is true
);
create unique index rwn_locations_source_identity_idx
  on public.rwn_locations ((record->>'datasetId'), (record->>'sourceRecordId'))
  where record ? 'datasetId';
