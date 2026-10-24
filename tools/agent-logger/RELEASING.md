# Release Agent Logger

Run commands from `tools/agent-logger`. The core SDK supports Node.js 22.13+ ESM;
the optional plugin is tested against Google ADK 2.3.0. This package is a community
contribution, not an official Google release.

## 1. Verify locally

```sh
npm ci
npm run release:check
npm run demo
```

`release:check` scans Git candidates for credentials and private paths, then runs
formatting, lint, strict types, tests and audit. It builds a
tarball, checks its allowlist and API-key exclusion, installs it in a temporary
application, verifies typed SDK imports and the installed CLI, then runs its
ADK plugin with an offline model and real function tool. No AI key is needed.

Optional live tests use `.env` (copy `.env.example` only if `.env` does not exist):

```sh
npm run demo:gemini
npm run demo:story
npm run demo:story -- --repo ../your-project
```

The story demo opts into local content capture and sends only the selected public
README/package excerpts to Gemini when `--repo` is provided. It never reads `.env`
from the subject repository or edits that repository. Check the printed delivery
status and view its JSONL log with `node dist/cli.js view <path>`.

To test the packed SDK around another repository's existing test suite:

```sh
npm run test:repo -- ../trusted-node-project
```

This clones committed `HEAD` into a temporary directory, installs dependencies
without install hooks, and executes its `npm test`. Only run it on repositories
you trust: their test command is code. The original checkout is unchanged.
Results remain in ignored `.agent-logs/repository-validation.json` and
`.agent-logs/repository-test-output.txt`. Run `release:check` first to create the
current tarball. Uncommitted subject changes are not copied.

## 2. Confirm npm identity and scope

```sh
npm login
npm whoami
```

The package name is `@meldhandi/agent-logger`. Publish it only if you own or can
publish in the `meldhandi` scope. Otherwise set a scope you own, update application
imports accordingly, and rerun validation:

```sh
npm pkg set name="@YOUR_NPM_USERNAME/agent-logger"
npm install --package-lock-only --ignore-scripts
npm run release:check
```

For the first publish, keep `0.1.0` only if that version does not already exist.
For later releases use `npm version patch --no-git-tag-version` (or the appropriate
minor/major bump), then rerun `release:check`.

## 3. Publish the verified archive

Review the `archive` filename printed by `release:check`, then:

```sh
# Default scope/version; adjust if renamed or bumped.
npm publish ./meldhandi-agent-logger-0.1.0.tgz --access public
npm view @meldhandi/agent-logger@0.1.0 version dist.integrity
```

Publishing requires npm 2FA or a suitable granular token. Prefer interactive npm
login for a manual release; keep registry tokens out of source files. See npm's
[scoped publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [2FA requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).
Publish the exact archive validated by the script; repack and retest after changes.

## Failure decisions

| Failure                                             | Action                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Any test, type, lint, audit, or package check fails | Stop the release and fix it; do not bypass checks.                                                          |
| Gemini 401/403                                      | Correct key/project restrictions; never print the key.                                                      |
| Gemini 404                                          | Choose a model available to that project.                                                                   |
| Gemini 429 or 5xx                                   | Respect quotas/provider recovery; do not automatically replay agent/tool effects.                           |
| Sink failure, queue drop, or write timeout          | Agent continues; delivery is unsuccessful. Fix storage/limits and treat logs as incomplete.                 |
| Sink timeout                                        | Outcome is unknown; no automatic write retry. Later writes to that sink fail until a new logger is created. |
| Stream consumer stops early                         | SDK closes the source iterator and records interruption.                                                    |
| Empty model answer                                  | Demo fails rather than reporting success.                                                                   |
| npm E401/EOTP                                       | Log in again and complete the npm security challenge.                                                       |
| npm E403 or scope ownership failure                 | Use an authorized scope; never work around permissions.                                                     |
| Version already published                           | Bump the version, repack, and revalidate.                                                                   |

Do not publish `.env`, logs, story outputs, subject-repository data, or test fixtures.
The package allowlist includes only `dist`, README, this guide, LICENSE and metadata.
Only JavaScript and declarations from `dist` are included; source maps are excluded.

## Push the contribution

From the repository root, review and stage only this contribution:

```sh
git switch feat/agent-logger-tool
git diff --check
git add tools/agent-logger tools/README.md
git diff --cached --stat
git commit -m "feat(tools): add agent logger SDK"
git push -u origin feat/agent-logger-tool
```

Keep the contribution's tests and examples in Git for reviewers. They contain
synthetic fixtures and temporary-directory helpers, not your local test results.
`.env`, `.npmrc`, logs, dependencies, generated builds and archives stay local.
