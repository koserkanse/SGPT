# Seko and the default specialist team

The OpenDots starter catalog is [config/assistants/defaults.json](../config/assistants/defaults.json).
It provides Seko as the general personal assistant, followed by presentation and
finance specialists, then research, documents, sales/CRM, agents/MCP, Generative UI,
and memory/learning specialists. Profiles use Turkish instructions and explicit
research/memory settings. Connected-app access stays unconfigured until real
connections are set up.

With OpenDots running on its local port, preview the changes from the project root:

```sh
node --env-file=integrations/opendots/.env scripts/provision-assistants.mts
```

Add `--apply` to install them in the authenticated local workspace. The command
reuses an existing SGPT Space, retains profiles with matching names, and configures
an untouched initial Dot as Seko without changing its ID or removing Space grants.
It verifies all catalog names after saving. Rerunning it preserves existing user
instructions and does not create a second copy of the team. The existing owner
token is read from the ignored environment and is never printed.

These are OpenDots specialist agents. Their current pinned service shares its
configured model. They do not automatically become LibreChat Agent Builder records,
receive arbitrary machine access, or gain native Copilot's artifact/evolution tools.
Use Agent Builder for independently selected providers/models; see [MODELS.md](MODELS.md).
A profile's requested workflow is not proof that a service or tool is connected.

The SGPT OpenDots fork supports `CONVERSATION_BACKEND=local`: conversations,
agent state, memory and task receipts persist in the local SQLite database without
a CopilotKit account, project key or evaluation license. Native SGPT evolution
learning remains in its separate local MongoDB store. Keep SQLite on a durable
local disk, outside folders synchronized to cloud storage when local-only storage
is required. Existing user data should be moved with SQLite's backup API.

Local preference tools can read, save and correct retained preferences when memory
permission is enabled. Interrupted turns retain their history and error receipts;
stale run writes are fenced and a repeated run ID does not execute its actions again.
Hosted Automatic Learning, managed channels and other remote services are optional
features, not substitutes for the local memory store. A model endpoint still has to
be configured and verified. The open-source CopilotKit runtime is a software
dependency; its hosted account and evaluation license are not required in local mode.
