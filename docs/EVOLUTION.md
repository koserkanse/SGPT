# Capability improvement

SGPT owns this workflow; it does not require CopilotKit Intelligence to schedule
research or retain learning. The native Copilot workspace consumes activated
skills through `load_evolved_skill` and can generate verified editable artifacts
through `create_verified_artifact`. OpenDots remains a separate integration.

## Local setup

Merge the `copilot.evolution` block in [librechat.evolution.yaml](../librechat.evolution.yaml)
into the existing ignored `librechat.yaml`. This preserves the OpenDots connection.
The feature is disabled by default when the block is absent.

Set `ownerUserId` to the owner account's LibreChat user ID, or resolve it from
`OPENDOTS_OWNER_USER_ID`. The account must be an administrator or a member of
`copilot.allowedUserIds`. For a tenant account, also set its exact `tenantId`.
Only that owner and tenant can see or change the registry, methods or evidence.
The background worker uses deployment configuration, not per-request overrides.

Install the artifact engines on macOS:

```sh
brew install --cask libreoffice
brew install poppler
```

Point `libreOfficePath`, `pdfTextPath` and optional `pdfImagePath` at the installed
binaries. On a Linux host these can be `/usr/bin/libreoffice`, `/usr/bin/pdftotext`
and `/usr/bin/pdftoppm`. These are host executables, not commands supplied by a
candidate. Source package scripts and install commands are not executed.

Use an existing persistent MongoDB, or start the dedicated local database:

```sh
docker compose -f compose.evolution-local.yaml up -d
```

For that database, set `MONGO_URI=mongodb://127.0.0.1:27021/SGPT` in the ignored
root `.env`. Its data lives in the persistent Docker volume `sgpt-evolution-mongodb`;
back it up with MongoDB's backup tools. Do not use a RAM/tmpfs database
for retained learning. `SCHEDULES_SINGLE_PROCESS=true` is appropriate for the
separate LibreChat schedule engine only when this is actually a single API process;
the capability worker itself uses database leases and fencing across instances.

Build the changed workspaces, then run the API and frontend normally:

```sh
npm run build:data-provider
npm run build:data-schemas
npm run build:api
npm run backend:dev
# In a second terminal, with the local API port configured:
PORT=3098 BACKEND_PORT=3088 HOST=127.0.0.1 npm run frontend:dev
```

Open `/copilot?mode=evolution` in the logged-in application. The panel shows the
next run, eight topics, current versions, retained methods and research history.
It supports research now, cancellation, pause/resume, corrections and rollback.

## Model and GitHub access

Evaluation uses an OpenAI-compatible chat-completions endpoint. Configure
`apiKey`, `baseUrl` and `model` under `copilot.evolution`; an omitted evaluation
key inherits `copilot.apiKey`. Secrets support environment references and the
existing encrypted admin secret registry. Never commit populated keys.

For the example template, add `EVOLUTION_API_KEY` to the ignored `.env`. A local
OpenAI-compatible server can use its own URL/model and a dummy key if that server
does not enforce authentication. The native Copilot chat has its own model/key
settings. Adding a key to `.env` requires an API restart.

GitHub REST requests can use `EVOLUTION_GITHUB_TOKEN`, or `githubCliPath` can point
to an already authenticated GitHub CLI. The CLI adapter only issues `GET` API
requests and does not copy its credential into application storage. Without either,
public unauthenticated GitHub limits apply. GitHub stars rank the discovery shortlist;
they never establish that a candidate passes evaluation or should be activated.
`sources` can pin a particular repository, skill path and optional exact commit:

```yaml
sources:
  - topic: finance
    repository: owner/repository
    path: skills/finance/SKILL.md
    # Optional immutable source revision:
    # ref: <40-character commit SHA>
```

Research still runs when model setup is incomplete. Compatible candidates are
reported as waiting for setup, and nothing is promoted. No production fixture
mode substitutes pretend model responses. Tests use labeled provider fixtures
in isolated test databases.

## What runs

The configurable defaults are Monday and Thursday at 09:00 Europe/Istanbul.
Presentations and finance run before the other six topics. A persisted due time
survives process restarts; missed occurrences coalesce into a single catch-up run.
Pausing preserves the schedule, and cancelling fences late writes from an old
worker. A crashed worker's lease expires before another worker can take over.

Authenticated discovery searches actual public `SKILL.md` files and filters private
repositories before fetching source. An additional plugin search records open-source
projects separately (`pluginsPerTopic`, default 1); configured `sources` restrict
that topic to the explicitly selected sources.

For each discovered candidate, the worker records the exact repository commit,
license, source path and content digest. Nested license exceptions, unknown
licenses, unavailable references and unsupported tool/code requirements prevent
automatic activation. The initial adapter supports bounded Markdown instruction
skills and their local Markdown references. Executable plugins, MCP deployments
and core-library upgrades are reported as requiring an integration adapter;
this version does not install arbitrary repositories or replace core dependencies.

The incumbent and candidate run the same versioned instruction suite with the
same model and retained methods. Mandatory checks must all pass; the total score
must meet `minimumScore` and improve by `improvementMargin`. The final composed
skill is tested again, committed atomically to the registry, then loaded back and
health-tested. A failed health test restores the previous binding. Owner rollback
also blocks that exact source digest from immediate automatic reactivation.

## Evaluation scope

The initial suite is `sgpt-instruction-v1`:

- **Presentations:** generates editable text-based PPTX, renders PDF with LibreOffice,
  checks all supplied Turkish text, rendered text bounds/block overlap, source numbers, source labels and slide count,
  and records PPTX/PDF plus an optional actual PDF preview image.
- **Finance:** generates an editable XLSX, checks formula-based derived values,
  currency, period, sources, cash reconciliation and a scenario against reference
  answers. Formula caches are deliberately set to zero before LibreOffice independently
  recalculates the workbook, so a cached expected answer cannot satisfy the check.
- **Other topics:** deterministic instruction-contract cases cover UI text/state
  handling, cancellation/idempotency, MCP call discipline, memory correction and
  isolation, Turkish document extraction, and CRM deduplication/authorization.

These are initial synthetic regression cases, not a claim of universally best
capabilities or a full MCP deployment benchmark. Presentation previews do not
constitute a comprehensive visual review. The initial artifact tools generate
text slides and a single-sheet workbook with arithmetic cell-reference formulas;
charts, supplied brand templates, NPV/IRR and arbitrary spreadsheet functions
require broader artifact adapters and fixtures before their automatic promotion
can be claimed. Candidate package code is never used as its own grader.

Learning is separate from source versions. Successful evaluation retains an
evidence-linked method for the topic. Owners can add preferences and superseding
corrections. Applicable methods are supplied to both compared variants and loaded
by the native Copilot even when no upgraded skill is active. A rollback retains
learning and records why the version was blocked. This is retrievable knowledge,
not model-weight training.

Registry data and history persist in MongoDB. Evidence files have scoped IDs and
authenticated downloads; their retention defaults to 30 days, enforced on reads
and by a TTL index. An expired evidence file returns 404 while the run's receipt
remains in retained history. Configuration controls source/response sizes, timeouts,
candidate count and the retained run/method/version history.

## Verification

```sh
node node_modules/jest/bin/jest.js --config packages/api/jest.config.mjs --runInBand --coverage=false packages/api/src/evolution/evolution.spec.ts packages/api/src/copilot/policy.spec.ts packages/api/src/admin/secrets.spec.ts
npm exec --workspace client -- jest --runInBand --coverage=false src/components/Copilot/__tests__/Evolution.spec.tsx
SGPT_TEST_OFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice SGPT_TEST_PDF_TEXT_PATH=/opt/homebrew/bin/pdftotext SGPT_TEST_PDF_IMAGE_PATH=/opt/homebrew/bin/pdftoppm NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config packages/api/jest.config.mjs --runInBand --coverage=false packages/api/src/evolution/artifacts.integration.spec.ts
```

The last suite performs real PPTX/PDF/XLSX work and a complete presentation/finance
upgrade cycle with a deterministic external-model fixture and real MongoDB.
It does not spend live model credits. Run workspace TypeScript checks, affected
builds and Lighthouse after integration changes.
