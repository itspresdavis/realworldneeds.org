#!/usr/bin/env python3
"""Real PostgreSQL/RLS tests with simulated Supabase auth, never a hosted database."""
import argparse
import json
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", default="postgres:17.11-bookworm", help="Already installed Docker image reference; never pulled by this runner")
IMAGE = parser.parse_args().image
NAME = "rwn-web-qa-permissions-" + uuid.uuid4().hex[:12]
started = False

def run(*args, input=None, check=True):
    return subprocess.run(args, input=input, text=True, capture_output=True, check=check, cwd=ROOT)

def sql(source):
    result = run("docker", "exec", "-i", NAME, "psql", "-X", "-q",
                 "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres", "-d", "rwn_qa",
                 input=source, check=False)
    print(result.stdout, end="")
    print(result.stderr, end="")
    if result.returncode:
        raise RuntimeError("Isolated PostgreSQL assertion failed")

def literal(value):
    return "'" + value.replace("'", "''") + "'"

try:
    # Inspect first and pin that existing image ID. This runner never pulls.
    image = run("docker", "image", "inspect", IMAGE, "--format", "{{.Id}}").stdout.strip()
    print("PostgreSQL image:", image)
    run("docker", "run", "-d", "--rm", "--pull=never", "--name", NAME,
        "--network", "none", "--read-only",
        "--tmpfs", "/var/lib/postgresql/data:rw,size=160m",
        "--tmpfs", "/var/run/postgresql:rw,size=16m",
        "--tmpfs", "/tmp:rw,size=16m",
        "--memory", "256m", "--cpus", "1", "--pids-limit", "128",
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=rwn_qa", image)
    started = True
    for attempt in range(100):
        if run("docker", "exec", NAME, "psql", "-X", "-h", "127.0.0.1", "-U", "postgres", "-d", "rwn_qa", "-c", "select 1", check=False).returncode == 0:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("Isolated PostgreSQL did not become ready")
    sql((ROOT / "supabase/tests/local-auth-fixture.sql").read_text())
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    baseline = [path for path in migrations if path.name.startswith("202609")]
    candidates = [path for path in migrations if path not in baseline]
    for path in baseline:
        sql(path.read_text())
    for number in [1, 2]:
        record = dict(id="qa-fixture-" + str(number), name="Benign fixture",
                      country="United States", city="Fixture City", kind="direct",
                      lat=42 + number / 100, lng=-71, sourceUrl="https://example.invalid",
                      lastChecked="2026-08-04", category="food", summary="Fixture only",
                      sourceName="Isolated fixture", address="Fixture only", services=["Fixture only"],
                      costNote="Free fixture", availabilityNote="Fixture only")
        sql("insert into public.rwn_locations(id,record,editorial_note) values (" +
            literal(record["id"]) + "," + literal(json.dumps(record)) +
            "::jsonb,'Benign private fixture reason');")
    for role in ["anon", "authenticated"]:
        sql("begin; set local role " + role + "; do $$ begin " +
            "if (select count(*) from public.rwn_locations where editorial_note='Benign private fixture reason')<>2 " +
            "then raise exception 'Expected baseline exposure not reproduced'; end if; " +
            "raise notice 'BASELINE CONFIRMED: " + role + " can read internal editorial reasons'; end $$; rollback;")
    # Reproduce actual hosted historical default grants without touching any
    # external database. These rights bypass row policies for table maintenance.
    sql("grant all privileges on public.rwn_locations,public.rwn_members,public.rwn_reviews,public.rwn_location_history,public.rwn_account_requests to anon,authenticated; "
        "grant all privileges on sequence public.rwn_location_history_id_seq to anon,authenticated; "
        "begin; set local role anon; truncate public.rwn_location_history; rollback;")
    print("BASELINE CONFIRMED: anonymous role can truncate isolated audit history under broad default grants")
    for path in candidates:
        sql(path.read_text())
        print("Applied candidate:", path.name)
    sql((ROOT / "supabase/tests/maintenance-privileges.sql").read_text())
    sql((ROOT / "supabase/tests/permissions.sql").read_text())
    print("PASS: real RLS permissions, contributor isolation, editor history and concurrency")
    sql((ROOT / "supabase/tests/corrections.sql").read_text())
    sql((ROOT / "supabase/tests/correction-workflow.sql").read_text())
    sql((ROOT / "supabase/tests/address-only.sql").read_text())
    sql((ROOT / "supabase/tests/resource-preferences.sql").read_text())
    # Genuine competing connections: a shared durable quota permits exactly one.
    sql("update rwn_private.correction_config set enabled=true, "
        "capability_sha256=encode(sha256(convert_to('synthetic-test-capability-never-configured-remotely-123456','UTF8')),'hex'), "
        "approval_ref='fixture-concurrency',retention_days=2,actor_hour_limit=1,global_hour_limit=10 where singleton;")
    competing = """begin;
    do $$ begin perform set_config('request.headers',jsonb_build_object(
      'x-rwn-correction-key','synthetic-test-capability-never-configured-remotely-123456',
      'x-rwn-correction-approval','fixture-concurrency')::text,true); end $$;
    set local role anon;
    select public.rwn_submit_correction('qa-fixture-1','wrong-hours','Concurrent fixture.',gen_random_uuid(),repeat('e',64));
    commit;"""
    def compete(_):
        return run("docker", "exec", "-i", NAME, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                   "-h", "127.0.0.1", "-U", "postgres", "-d", "rwn_qa", input=competing, check=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        contenders = list(pool.map(compete, range(2)))
    if sum(result.returncode == 0 for result in contenders) != 1 or not any("Correction limit reached" in result.stderr for result in contenders):
        raise RuntimeError("Concurrent correction quota did not permit exactly one report")
    sql("do $$ begin if (select count(*) from rwn_private.corrections)<>1 or "
        "(select count(*) from rwn_private.correction_receipts)<>1 then raise exception 'Concurrent correction receipts incorrect'; end if; end $$; "
        "delete from rwn_private.correction_receipts; delete from rwn_private.correction_events; "
        "delete from rwn_private.corrections; delete from rwn_private.correction_limits; "
        "update rwn_private.correction_config set enabled=false,capability_sha256=null,approval_ref=null,retention_days=null,actor_hour_limit=null,global_hour_limit=null;")
    print("PASS: concurrent anonymous requests respect one durable quota and receipt")

    actual = run("node", "--input-type=module", "-e",
        "import {resources} from './src/data/resources.js';process.stdout.write(JSON.stringify(resources.find(r=>r.id==='centro-pop-carapicuiba')));",
        check=True).stdout
    sql("begin; select set_config('rwn.qa_contact_record'," + literal(actual) + ",true) is not null as fixture_configured;\n" +
        (ROOT / "supabase/tests/contact-only.sql").read_text() + "\nrollback;")
    sql("select has_column_privilege('anon','public.rwn_locations','editorial_note','SELECT') as anon_private_column, " +
        "has_column_privilege('authenticated','public.rwn_locations','editorial_note','SELECT') as contributor_private_column; " +
        "select count(*) as fixture_users_after_rollback from auth.users;")
    print("PASS: all candidate migrations; simulated auth only, no live Supabase verification")
    # Also install every migration into a genuinely empty database on the same
    # isolated instance. This never connects to or drops a hosted database.
    run("docker", "exec", "-i", NAME, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres",
        input="drop database rwn_qa; drop role anon, authenticated, service_role; create database rwn_qa;")
    sql((ROOT / "supabase/tests/local-auth-fixture.sql").read_text())
    for path in migrations:
        sql(path.read_text())
    sql("do $$ begin if exists(select 1 from public.rwn_locations) or exists(select 1 from rwn_private.corrections) or "
        "(select enabled from rwn_private.correction_config where singleton) then raise exception 'Clean install not empty and disabled'; end if; end $$;")
    print("PASS: clean installation of all migrations, empty catalog/queue, intake disabled")

finally:
    if started:
        run("docker", "rm", "-f", NAME)
        print("Removed exact isolated container:", NAME)
