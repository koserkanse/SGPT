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

OpenDots conversations require Intelligence in addition to a working model. For
local evaluation, follow the pinned upstream setup guide and the CLI's actual
readiness checks. An account and the user's acceptance of the current evaluation
agreement are prerequisites. The CLI deliberately refuses to accept terms from a
coding agent. Never replace that gate with an invented key or a simulated service.

Local evaluation needs at least 4 Docker CPUs, 12 GiB RAM and 40 GiB free storage.
The renewable evaluation license is not a production deployment. Pages, Dot
profiles and Space configuration stay in the existing OpenDots SQLite database;
conversation and automatic-learning storage is supplied by the selected Intelligence
instance. Native SGPT evolution learning remains in its separate MongoDB store.
Setting memory permissions or a learning-container ID does not create or verify the
underlying service.
