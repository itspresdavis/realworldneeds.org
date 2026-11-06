import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// This source contract deliberately follows all committed migrations in order.
// It catches a later table-wide grant reopening private/new columns. It does
// not replace executing supabase/tests/permissions.sql on an isolated database.
test("anonymous and authenticated catalog grants expose only public columns after all migrations", async () => {
  const grants = new Map();
  const roleGrants = (role) => {
    if (!grants.has(role)) grants.set(role, new Set());
    return grants.get(role);
  };
  const names = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const sql = (await readFile(`supabase/migrations/${name}`, "utf8")).replace(
      /--[^\n]*/g,
      "",
    );
    const statements =
      /\b(grant|revoke)\s+(select|all)\s*(?:\(([^)]+)\))?\s+on\s+(?:table\s+)?public\.rwn_locations\s+(to|from)\s+([^;]+);/gi;
    for (const [, action, , columns, , roles] of sql.matchAll(statements)) {
      const values = columns
        ? columns.split(",").map((column) => column.trim())
        : ["*"];
      for (const role of roles
        .split(",")
        .map((role) => role.trim().toLowerCase())) {
        for (const value of values) {
          if (action.toLowerCase() === "grant") roleGrants(role).add(value);
          else roleGrants(role).delete(value);
        }
      }
    }
  }
  const anonymous = new Set([...roleGrants("public"), ...roleGrants("anon")]);
  assert.equal(
    anonymous.has("*"),
    false,
    "anonymous readers must not inherit a table-level SELECT grant",
  );
  assert.equal(
    anonymous.has("editorial_note"),
    false,
    "editorial reasons are internal data",
  );
  assert.deepEqual(
    [...anonymous].sort(),
    [
      "id",
      "record",
      "name",
      "country",
      "kind",
      "latitude",
      "longitude",
      "source_url",
      "last_checked",
      "search_text",
      "published",
      "updated_at",
    ].sort(),
  );
  const contributor = new Set([...roleGrants("public"), ...roleGrants("authenticated")]);
  assert.deepEqual([...contributor].sort(), [...anonymous].sort(),
    "new authenticated contributors must not gain private editorial columns");
});

test("database permission fixtures exercise internal-column denial alongside public facts", async () => {
  const sql = await readFile("supabase/tests/permissions.sql", "utf8");
  assert.match(
    sql,
    /has_column_privilege\('anon', 'public\.rwn_locations', 'editorial_note', 'SELECT'\)/,
  );
  assert.match(
    sql,
    /perform editorial_note from public\.rwn_locations limit 1;[\s\S]*exception when insufficient_privilege/,
  );
  assert.match(
    sql,
    /perform id,record,name,country,kind,source_url,last_checked,latitude,longitude,updated_at,published/,
  );
  assert.match(sql, /rollback;\s*$/);
});
