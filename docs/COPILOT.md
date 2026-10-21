# SGPT: CopilotKit and OpenDots

SGPT is a LibreChat fork. `/copilot` adds a CopilotKit v2 conversation with controlled
Generative UI (tables and interactive choices) and sandboxed open-ended UI. The OpenDots
tab connects to the actual OpenDots workspace: select a specialist, create or resume a
conversation, review page drafts, and approve connected-service operations.

## Local development

Use Node.js 24 and npm. Clone with submodules, or run `git submodule update --init --recursive`.

```sh
npm ci
npm run build:packages
cp .env.example .env
cp librechat.copilot.yaml librechat.yaml
```

Configure a MongoDB connection in `.env` and set `COPILOT_API_KEY` to the key for the
configured model. The `copilot.model` value uses CopilotKit's `provider/model` syntax.
Credentials stay on the server; they are never returned by the status endpoint.

For Copilot without OpenDots, remove `copilot.openDots` from your local `librechat.yaml`.
For OpenDots on the same host, change its URL to `http://127.0.0.1:4310` in that file.
The checked-in configuration uses Docker's service name.

Start the backend and frontend in separate terminals:

```sh
npm run backend:dev
npm run frontend:dev
```

Open the frontend, register your first account, and use the Copilot sidebar entry.
Administrators have access when enabled; grant additional users through
`copilot.allowedUserIds`. Regular Copilot chats use bounded in-memory history and are
temporary. They are separate from LibreChat's persistent conversations and do not use
LibreChat's model routing, balances, or per-provider budgets. The integration has its
own request limit and explicitly authorized users.

## OpenDots

The upstream source is pinned as `integrations/opendots`. It keeps its MIT license and
its own release history. See its [setup](../integrations/opendots/docs/SETUP.md) and
[computer setup](../integrations/opendots/docs/COMPUTERS.md).

OpenDots is a single-owner application. Set `OPENDOTS_OWNER_USER_ID` in `.env` to your
LibreChat account ID and use the same ID in `copilot.openDots.ownerUserId`. Only that
authenticated account can use the bridge, even if another user is an administrator.
The bridge does not make OpenDots multi-tenant.

Create an owner token with `openssl rand -hex 32`; store it as `OPENDOTS_OWNER_TOKEN` in
the root `.env` and as `OWNER_TOKEN` in the OpenDots `.env`. Do not commit either file.
Set these values in the root `.env` when using the Compose overlay:

```dotenv
COPILOT_API_KEY=
OPENDOTS_OWNER_USER_ID=
OPENDOTS_OWNER_TOKEN=
CPK_INTELLIGENCE_API_KEY=
CPK_TELEMETRY_ID=
OPENDOTS_MODEL_API_KEY=
OPENDOTS_MODEL=gpt-4.1-mini
```

The OpenDots application is open source. Its conversation storage requires CopilotKit
Intelligence: hosted, a local Docker evaluation, or licensed self-hosting. Obtain the
project key and telemetry ID with the upstream setup workflow; do not paste credentials
into this chat or commit them. A missing connection is displayed as a setup state.

For an independent development process, use the upstream source:

```sh
cd integrations/opendots
npm ci
cp .env.example .env
npm run dev
```

Set its `OWNER_ID`, `OWNER_TOKEN`, Intelligence connection, and model variables before
starting conversations. The SDK version inside the pinned OpenDots app is managed by
that app independently of the LibreChat integration.

## Docker

Complete the root `.env` using the LibreChat example and the variables above, then run:

```sh
docker compose -f docker-compose.yml -f compose.copilot.yaml up --build -d
```

This builds the modified LibreChat source and the pinned OpenDots source. It persists
OpenDots metadata in its own volume and binds the standalone workspace to loopback on
port 4310. Model and Intelligence credentials are still required. Create/configure Dots
through that standalone workspace, then open the OpenDots tab in LibreChat.

Voice, channel configuration, document editing, and live computer takeover remain in
the standalone OpenDots application. The integrated surface provides text conversations,
structured tool activity, page-save reviews, and connected-service approvals. Computer
services and external app connections are not provisioned by the overlay.

## Boundaries and maintenance

The twice-weekly research, evaluated instruction-skill upgrades and retained
learning workflow is described in [Capability improvement](EVOLUTION.md).
The broader adapter roadmap and topic priorities remain in
[ADR-001](evolution/ADR-001.md) and the [program definition](evolution/program.yaml).

- LibreChat JWT, same-origin checks, and strict per-user configuration run before the bridge.
- Regular runtime thread IDs are scoped to the authenticated user and tenant. Global
  SDK history, inspector, and administration routes are not exposed.
- OpenDots credentials are attached server-side to a fixed origin and allowlisted routes;
  redirects, arbitrary URL forwarding, and incoming browser credentials are rejected.
- UI approvals use upstream receipts and idempotent tool-call IDs. Approval details for
  connected-service operations come from the server's pending action record.
- Keep the owner token in the secret registry so admin configuration reads redact it.
- Update the OpenDots submodule deliberately, then check its API contracts and run the
  focused integration tests. Pull LibreChat changes from `upstream` onto your fork.

References: [LibreChat](https://github.com/LibreChat-AI/LibreChat),
[CopilotKit](https://github.com/CopilotKit/CopilotKit),
[OpenDots](https://github.com/CopilotKit/OpenDots).

## Verification

After building the shared workspaces, run the focused checks:

```sh
npx jest --config packages/api/jest.config.mjs --runInBand --coverage=false packages/api/src/copilot/policy.spec.ts packages/api/src/admin/secrets.spec.ts
node --test packages/api/tests/copilot.test.cjs
npm exec --workspace client -- jest --runInBand --coverage=false src/components/Copilot/__tests__/Cards.spec.tsx
npm run build:client
npm run lighthouse
```

The runtime/bridge test uses the real CopilotKit runtime and a local HTTP fixture for the
external OpenDots API. It verifies discovery, user/tenant boundaries, streaming, credential
forwarding, forbidden routes, and safe error responses. It does not call a live model.
Live model chat and durable OpenDots conversations require your own model and Intelligence
credentials. Run `npx tsc --noEmit` in `client`, `packages/api`, and `packages/data-provider`
when changing these workspaces.
