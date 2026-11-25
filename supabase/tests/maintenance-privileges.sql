-- Disposable database only. Privilege assertions do not mutate hosted objects.
begin;
do $$ declare object text; role_name text; permission text; begin
  foreach object in array array['rwn_locations','rwn_members','rwn_reviews','rwn_location_history','rwn_account_requests'] loop
    foreach role_name in array array['anon','authenticated'] loop
      foreach permission in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if has_table_privilege(role_name,'public.'||object,permission) then raise exception '% still has % on %',role_name,permission,object; end if;
      end loop;
    end loop;
    if object<>'rwn_locations' and has_table_privilege('anon','public.'||object,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Anonymous private-table grant on %',object; end if;
  end loop;
  foreach role_name in array array['anon','authenticated'] loop
    if has_sequence_privilege(role_name,'public.rwn_location_history_id_seq','USAGE,SELECT,UPDATE') then raise exception '% can manipulate audit sequence',role_name; end if;
  end loop;
  if not has_table_privilege('authenticated','public.rwn_members','SELECT')
    or not has_table_privilege('authenticated','public.rwn_location_history','SELECT')
    or not has_table_privilege('authenticated','public.rwn_reviews','INSERT')
    or not has_table_privilege('authenticated','public.rwn_account_requests','INSERT')
    or not has_table_privilege('authenticated','public.rwn_locations','INSERT,UPDATE,DELETE') then raise exception 'Required role-based row operations lost'; end if;
end $$;
set local role anon;
do $$ begin
  begin truncate public.rwn_location_history; raise exception 'Anonymous can truncate immutable history'; exception when insufficient_privilege then null; end;
  begin perform nextval('public.rwn_location_history_id_seq'); raise exception 'Anonymous can advance audit sequence'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin truncate public.rwn_members; raise exception 'Authenticated can erase reviewer memberships'; exception when insufficient_privilege then null; end;
  begin perform setval('public.rwn_location_history_id_seq',1); raise exception 'Authenticated can reset audit sequence'; exception when insufficient_privilege then null; end;
  raise notice 'PASS: RWN maintenance/sequence rights denied; required row privileges retained';
end $$;
reset role;
rollback;
