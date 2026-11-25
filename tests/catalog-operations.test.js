import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { resources } from '../src/data/resources.js';
import { fingerprint } from '../scripts/catalog-sync-core.mjs';

const workflow = await readFile('.github/workflows/catalog-health.yml', 'utf8');
const sha = 'a'.repeat(40);
function stepCommand(id) {
  const section = workflow.split(/^      - name: /m).find(text => text.includes(`        id: ${id}\n`));
  assert.ok(section, `Missing executable step ${id}`);
  const lines = section.split('\n');
  const index = lines.findIndex(line => line.startsWith('        run: '));
  assert.ok(index >= 0, `Missing command ${id}`);
  const inline = lines[index].slice('        run: '.length);
  return inline === '|' ? lines.slice(index + 1).filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n') : inline;
}
function execute(id, directory, extra = {}) {
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stepCommand(id)], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, REPORT_DIR: directory, GITHUB_ENV: join(directory, 'github-env'), GITHUB_STEP_SUMMARY: join(directory, 'summary.md'), GITHUB_SHA: sha, SOURCE_SAMPLE_REQUESTED: 'false', ...extra },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
const read = async (directory, name) => JSON.parse(await readFile(join(directory, name), 'utf8'));

test('scheduled reporting requires complete owner approval and the canonical repository; manual reporting remains available', () => {
  const expression = workflow.match(/    if: >-\n([\s\S]+?)\n    runs-on:/)?.[1];
  assert.ok(expression);
  const approved = { RWN_CATALOG_MONITOR_ENABLED: 'true', RWN_CATALOG_MONITOR_OWNER: 'fixture-owner', RWN_CATALOG_MONITOR_ESCALATION_OWNER: 'fixture-escalation', RWN_CATALOG_MONITOR_APPROVAL_REF: 'reviewed-decision-fixture' };
  const permitted = (event, vars, repository = 'itspresdavis/RWN-WEB') => vm.runInNewContext(`Boolean(${expression})`, { github: { event_name: event, repository }, vars });
  const empty = Object.fromEntries(Object.keys(approved).map(key => [key, '']));
  assert.equal(permitted('workflow_dispatch', empty), true);
  assert.equal(permitted('schedule', empty), false);
  assert.equal(permitted('schedule', approved), true);
  assert.equal(permitted('schedule', approved, 'someone/fork'), false);
  assert.equal(permitted('pull_request', approved), false);
  for (const key of Object.keys(approved)) assert.equal(permitted('schedule', { ...approved, [key]: '' }), false, key);
  assert.equal(permitted('schedule', { ...approved, RWN_CATALOG_MONITOR_ENABLED: 'false' }), false);
});

test('actual default workflow commands produce public reports and a deterministic catalog receipt without source fetching', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rwn-catalog-ops-'));
  try {
    for (const id of ['prepare', 'health', 'coverage', 'summary']) {
      const result = execute(id, directory);
      assert.equal(result.status, 0, `${id}: ${result.stderr}`);
    }
    assert.equal(await readFile(join(directory, 'github-env'), 'utf8'), `REPORT_DIR=${directory}\n`, 'the prepared path must be exported to subsequent GitHub steps');
    const health = await read(directory, 'catalog-health.json');
    const coverage = await read(directory, 'catalog-coverage.json');
    const receipt = await read(directory, 'report-receipt.json');
    assert.equal(health.totals.listings, resources.length);
    assert.equal(coverage.staticSnapshot.listings, resources.length);
    assert.equal(health.structural.passed, true);
    assert.equal(health.links.status, 'not-checked');
    assert.equal(coverage.dynamicFeeds.includedInCounts, false);
    assert.equal(receipt.outcome, 'report-complete');
    assert.equal(receipt.sourceSha, sha);
    assert.equal(receipt.catalogHash, fingerprint(resources));
    assert.equal(receipt.asOf, health.asOf);
    assert.equal(health.asOf, coverage.asOf);
    assert.equal(receipt.sourceReachability.checked, 0);
    assert.match(receipt.lockfileHash, /^[a-f0-9]{64}$/);
    const original = await readFile(join(directory, 'report-receipt.json'), 'utf8');
    assert.equal(execute('summary', directory).status, 0);
    assert.equal(await readFile(join(directory, 'report-receipt.json'), 'utf8'), original);
    const summary = await readFile(join(directory, 'summary.md'), 'utf8');
    assert.match(summary, /USDA dynamic seasonal results are excluded/);
    assert.doesNotMatch(summary, /https?:\/\/|@/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('optional source failures and unavailable reports retain truthful receipts and fail the job', async () => {
  const cases = [
    { outcomes: { reachable: 19, broken: 1, unknown: 0, blocked: 0 }, expected: 'needs-review' },
    { outcomes: { reachable: 19, broken: 0, unknown: 1, blocked: 0 }, expected: 'incomplete' },
    { outcomes: { reachable: 0, broken: 0, unknown: 0, blocked: 20 }, status: 'blocked', expected: 'incomplete' },
    { missing: true, expected: 'incomplete' },
  ];
  for (const fixture of cases) {
    const directory = await mkdtemp(join(tmpdir(), 'rwn-catalog-ops-failure-'));
    try {
      await writeFile(join(directory, 'catalog-health.json'), JSON.stringify({ asOf: '2026-11-07', structural: { passed: true }, reviewQueue: { candidates: [] } }));
      await writeFile(join(directory, 'catalog-coverage.json'), JSON.stringify({ asOf: '2026-11-07', staticSnapshot: { listings: 20 } }));
      if (!fixture.missing) await writeFile(join(directory, 'catalog-source-health.json'), JSON.stringify({ links: { status: fixture.status || 'sampled', checked: 20, outcomes: fixture.outcomes } }));
      const result = execute('summary', directory, { SOURCE_SAMPLE_REQUESTED: 'true' });
      assert.equal(result.status, 1, result.stderr);
      assert.equal((await read(directory, 'report-receipt.json')).outcome, fixture.expected);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('workflow keeps read-only credentials, explicit source opt-in, bounded execution and seven-day artifacts', () => {
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /default: false\n        type: boolean/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.check_source_links == true/);
  assert.match(stepCommand('sources'), /--check-links --limit 20/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error|npm (?:ci|install|run build)|supabase|curl |webhook|issues: write/);
  for (const action of workflow.matchAll(/uses: (\S+)/g)) assert.match(action[1], /@[a-f0-9]{40}$/);
});
