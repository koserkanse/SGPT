# Local, home-hosted and remote models

LibreChat agents retain their own provider and model parameters. Register a local
or home-hosted OpenAI-compatible server as a custom endpoint, then select that
provider and model in each agent's Agent Builder settings. Other agents can keep
using an existing remote provider. These choices do not require every model to
run on the same computer.

Merge [librechat.models.yaml](../librechat.models.yaml) with the existing ignored
`librechat.yaml`; do not replace the existing OpenDots or evolution configuration.
Add `HOME_MODEL_BASE_URL` to the ignored `.env`, pointing at the trusted server's
API URL ending in `/v1`. Keep private hostnames and addresses out of committed
configuration. If authentication is required, store `HOME_MODEL_API_KEY` in `.env`
and use the commented key references in the template. `not-required` is only a
placeholder for a server which already accepts unauthenticated requests.

The custom endpoint discovers model IDs through `/v1/models`. Discovery means a
server advertises a model, not that the model is loaded or has passed agent tests.
Use the exact advertised ID. An embedding model does not perform chat or tools.
Before assigning a model to specialist work, verify generation, streaming,
structured tool arguments and continuation after the tool result. Presentation
and finance capabilities still require their own existing regression checks.

The native `/copilot` workspace has a separate deployment model:

- Omit `copilot.baseUrl` to preserve the existing `provider/model` configuration.
- Set `copilot.baseUrl` to use an OpenAI-compatible chat-completions endpoint;
  `copilot.model` is then the exact server model ID, without a provider prefix.
- Compatible servers may omit `copilot.apiKey` when authentication is not needed.
  A placeholder header is supplied for the client SDK; this does not create a
  server credential or disable authentication on the model server.
- `baseUrl` can use an environment reference. Invalid/unresolved URLs fail closed;
  the integration does not fall back to a different provider.
- `copilot.maxSteps` bounds model/tool iterations, from 1 to 20. Its default stays
  1 for existing deployments. The example uses 8 so a model can load guidance,
  invoke an artifact tool and explain its result in one turn.
- Optional `copilot.maxOutputTokens` bounds each model response, from 128 to 32768.
  Provider endpoints and credentials are not accepted from chat request overrides.

The native Copilot pane uses one deployment model. Use LibreChat Agent Builder for
independent per-agent provider/model choices. OpenDots is a separate integration:
its current pinned version uses a shared model configuration, with
`OPENAI_BASE_URL`, `OPENAI_MODEL` and `OPENAI_API_KEY` in its own `.env`. Changing its
model does not change its conversation backend. The SGPT OpenDots fork supports persistent
local SQLite conversations without an Intelligence account; optional Intelligence mode
requires its own explicit connection.

The evolution evaluator has its own `baseUrl`, `model` and `apiKey` fields. Point
them at the chosen evaluator explicitly. An existing evaluation key can be inherited
from Copilot, but the evaluator's URL/model are not implicitly changed along with it.

After changing local configuration, restart the API. If OpenDots settings changed,
restart that service too. Saved agents, learning and research history remain in
their existing databases.
