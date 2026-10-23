# SGPT local installation

The current durable working copy on this Mac is `/Users/serkankose/Developer/SGPT`.
It runs outside the Documents folder's cloud synchronization. The original
Documents checkout is preserved; it is not the running copy.

Open [SGPT Copilot](http://127.0.0.1:3098/copilot?mode=dots) and select Seko or a
specialist. The app is single-owner at the OpenDots bridge. Existing local login
and owner credentials stay in ignored environment files; do not replace them.

## Start after a restart

Start Docker Desktop and the existing `sgpt-evolution-mongo` container first. Then
run each service in its own terminal from this working copy:

```sh
# Terminal 1: LibreChat API
npm run backend:dev

# Terminal 2: frontend (the API in the existing .env listens on 3088)
cd client
BACKEND_PORT=3088 HOST=127.0.0.1 PORT=3098 npm run dev -- --host 127.0.0.1 --port 3098 --strictPort

# Terminal 3: OpenDots
cd integrations/opendots
npm run start
```

For a fresh installation, follow [COPILOT.md](COPILOT.md) first. After changing
OpenDots source, run `npm run build` in that folder before starting it. The current
services were started independently of this chat; OS login autostart is not installed.

## Local storage and models

OpenDots uses `CONVERSATION_BACKEND=local` and its SQLite database under
`integrations/opendots/data/`. Conversations, agent state, preference memory and
background task receipts survive service restarts. Preserve `OWNER_ID`; back up
SQLite consistently with its backup API. Evolution and LibreChat use the existing
Docker MongoDB volume `sgpt-evolution-mongodb`.

The model runs on the owner's home machine over the configured private Tailscale
connection. Its exact private address and credential belong only in ignored
configuration. If the home machine or connection is unavailable, local history
remains available, but new model responses require the connection to recover.

CopilotKit's open-source SDK is a code dependency. Local mode requires no CopilotKit
account, Intelligence key or evaluation license and disables setup/SDK telemetry.
External research and other connected services remain explicit integrations. See
[MODELS.md](MODELS.md) for independent LibreChat agent models and OpenDots' shared
model setting, and [ASSISTANTS.md](ASSISTANTS.md) for the default team.
