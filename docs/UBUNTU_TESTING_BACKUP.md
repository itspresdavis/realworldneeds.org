# RWN-WEB: GitHub primary, Ubuntu testing backup

The canonical working repository is `rwn-mini:/home/prestond03/projects/RWN-WEB`.
GitHub repository: https://github.com/iamhuvr/RWN-WEB.
Vercel: team `anlos`, project `rwn-web` (`prj_504G7M2lhnU5NlmfSAEyY4UdA4DX`).
The Git production branch is `main`; its public domain is https://realworldneeds.org.

## Test a committed change

Commit source changes on a branch first. Fetch origin before selecting a remote branch.
The tools test the resolved commit, never uncommitted files in the working directory.

```sh
ssh rwn-mini
cd /home/prestond03/projects/RWN-WEB
git fetch origin
python3 scripts/quality-backend.py --ref HEAD
```

The default `auto` provider reads the latest GitHub Quality run for that exact SHA:

- A successful run passes.
- A running/queued run stays pending (exit 2).
- A real test failure, cancellation, timeout, unknown state, or API/authentication error stops (exit 1).
- An explicit GitHub billing-blocked failed job with no executed steps runs Ubuntu validation.
- If there is no run, a fresh, account-verified exhausted-allowance observation can authorize the backup until its expiry. Without evidence, it stops.

`--provider github` never falls back.
`--provider ubuntu` explicitly tests the backup, even when GitHub has passed.
No command changes the GitHub billing budget, buys minutes, starts background polling, or registers a GitHub self-hosted runner.

The Ubuntu launcher is `rwn-web-test` (same arguments). From the Mac:

```sh
ssh rwn-mini 'rwn-web-test --ref HEAD'
```

## Allowance evidence and reset

On October 29, 2026 the signed-in `iamhuvr` dashboard showed $12.00 of $12.00 included Actions compute consumed, and a reset in 3 days. The CLI OAuth credential lacks the billing `user` scope, so the saved observation is explicitly identified as a dashboard observation.

Machine-local evidence: `~/.config/rwn-web-quality/allowance.json`.
It expires conservatively at November 1, 2026 00:00 UTC. The selector checks GitHub first even before expiry and will not use stale evidence afterward. Recheck https://github.com/settings/billing in the correct account before updating evidence. Never invent an allowance or extend expiry without checking.

When minutes return, use the normal PR or main Quality workflow. The workflow also accepts manual `workflow_dispatch` from the GitHub Actions page. This solution preserves GitHub as the primary test environment.

## What Ubuntu runs

The validator exports an immutable Git archive into a new run folder, excluding tracked generated `dist` and `node_modules`. It runs the same gates as GitHub:

1. `npm ci`
2. `npm run check` (syntax, data, production build, scale, Node tests)
3. `node scripts/browser-globe-touch-v4.mjs`
4. `npm run test:browser:qa`

Rendered browser QA still runs after a failed touch test; the overall result remains failed. Validation failures stop before browser testing. Chrome must be present and Node must be version 24.

A host lock prevents concurrent tests from colliding on fixed preview/Chrome ports. Build and unit-test processes use lower priority and two distinct physical cores. Browser phases use normal scheduling across the available CPUs so timing checks are not starved. All stages use a minimal environment and fresh home/browser data, with short private temporary paths for Chrome sockets. Stage timeouts terminate their process groups. Credentials are not copied into test exports.

The existing source checkout, its generated/dependency modifications, RWN CORE, and other running services are preserved.

Results: `~/.local/state/rwn-web-quality/runs/<run>/receipt.json`, stage logs, source archive, and QA artifacts. Receipts include the full SHA, Git tree, source hashes, validator hash, runtime versions, timestamps, and every stage result. Failed/interrupted runs remain failed and keep their diagnostics. Nothing automatically deletes evidence.

## Deploy the exact tested source

```sh
python3 scripts/release-tested.py --ref HEAD --target preview
```

This checks Quality, verifies the Vercel team/project, exports the exact commit into a new release folder and deploys that source. It never uploads the dirty working folder. Vercel builds the source again with its target environment; this is source provenance, not a claim that a local build artifact is promoted unchanged.

To reuse a fresh passing Ubuntu receipt and avoid repeating a long suite:

```sh
python3 scripts/release-tested.py --ref FULL_SHA --receipt /absolute/path/to/receipt.json --target preview
```

The receipt must be at most 24 hours old; commit, tree, archive hash, validator hash and all four stages must match. Use `--dry-run` to check the gate and inspect deployment input without uploading.

A production build can be staged without moving public domains:

```sh
python3 scripts/release-tested.py --ref FULL_SHA --receipt /absolute/path/to/receipt.json --target production-stage
```

Inspect and test that production deployment before an explicitly requested live release. Promote the recorded staged production URL using `vercel --scope anlos promote URL`. Promoting a preview can rebuild it with production variables; stage production first when the same deployment must be promoted.

The Ubuntu launcher is `rwn-web-release`. Release evidence lives under `~/.local/state/rwn-web-quality/releases/`.

## Limits

GitHub Free does not provide protected branches for this private repository. Vercel's existing Git integration can deploy a direct push/merge to main before GitHub testing finishes. The helper is a release gate only when used; it cannot prevent a separate direct push or Vercel deployment. Do not merge/push untested source to main. Account upgrades, branch protections, and automatic domain-assignment settings are unchanged.

These tests cover the repository's implemented checks. Passing them does not establish physical-phone acceptance, live account/payment workflows, all production environment behavior, or all possible defects.

## Maintain the tooling

```sh
python3 tests/ubuntu-quality.test.py
python3 tests/quality-backend.test.py
python3 tests/release-tested.test.py
```

All three are also checked in the Quality workflow and the Ubuntu validator's check stage.
