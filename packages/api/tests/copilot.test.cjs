const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const apiRequire = createRequire(require.resolve('@librechat/api/copilot'));
const express = apiRequire('express');
const { createCopilotRouter } = apiRequire('@librechat/api/copilot');

const servers = [];
async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
after(() =>
  Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  ),
);

test('real runtime discovery and OpenDots bridge enforce identity and preserve streaming', async () => {
  const requests = [];
  const upstream = express();
  upstream.use(express.json());
  upstream.use((req, res) => {
    requests.push({
      path: req.path,
      body: req.body,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
    });
    if (req.path === '/api/models') return res.json([{ id: 'home', models: ['qwen'] }]);
    if (req.method === 'PUT' && req.path === '/api/dots/scout/model') return res.json(req.body);
    if (req.path === '/api/workspace')
      return res.json({ spaces: [], dots: [], conversations: [], setup: { missing: [] } });
    if (req.path === '/api/copilotkit/agent/scout/run') {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"type":"RUN_STARTED"}\n\n');
      res.end('data: {"type":"RUN_FINISHED"}\n\n');
      return;
    }
    res.status(500).json({ error: 'secret-from-upstream' });
  });
  const origin = await serve(upstream);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: req.headers['test-user'] ?? 'owner', role: 'ADMIN', tenantId: 'tenant' };
    req.config = {
      config: {
        copilot: {
          enabled: true,
          apiKey: 'test-model-key',
          openDots: {
            url: origin,
            ownerUserId: 'owner',
            token: 'test-owner-token-at-least-24-characters',
          },
        },
      },
    };
    next();
  });
  app.use('/api/copilot', createCopilotRouter({ resolveSecret: (value) => value }));
  const base = await serve(app);
  const status = await (await fetch(`${base}/api/copilot/status`)).json();
  assert.equal(status.ready, true);
  assert.equal(JSON.stringify(status).includes('test-model-key'), false);
  assert.equal(JSON.stringify(status).includes('test-owner-token'), false);
  const discovery = await fetch(`${base}/api/copilot/runtime/info`);
  assert.equal(discovery.status, 200, await discovery.text());
  assert.equal((await fetch(`${base}/api/copilot/runtime/threads`)).status, 403);
  assert.equal(
    (
      await fetch(`${base}/api/copilot/runtime/agent/default/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: 'another-user:thread' }),
      })
    ).status,
    403,
  );
  const denied = await fetch(`${base}/api/copilot/dots/workspace`, {
    headers: { 'test-user': 'other-admin' },
  });
  assert.equal(denied.status, 403);
  assert.equal(requests.length, 0);
  const workspace = await fetch(`${base}/api/copilot/dots/workspace`, {
    headers: { cookie: 'private-cookie=not-forwarded', authorization: 'Bearer browser-jwt' },
  });
  assert.equal(workspace.status, 200);
  assert.equal(requests[0].authorization, 'Bearer test-owner-token-at-least-24-characters');
  assert.equal(requests[0].cookie, undefined);
  assert.equal((await fetch(`${base}/api/copilot/dots/models`)).status, 200);
  const selection = { modelConnectionId: 'home', modelId: 'qwen' };
  const saved = await fetch(`${base}/api/copilot/dots/dots/scout/model`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), selection);
  const beforeDenied = requests.length;
  assert.equal(
    (
      await fetch(`${base}/api/copilot/dots/dots/scout/model`, {
        method: 'PUT',
        headers: { 'test-user': 'other-admin', 'content-type': 'application/json' },
        body: JSON.stringify(selection),
      })
    ).status,
    403,
  );
  assert.equal(requests.length, beforeDenied);
  const stream = await fetch(`${base}/api/copilot/dots/runtime/agent/scout/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  assert.match(await stream.text(), /RUN_FINISHED/);
  const failure = await fetch(`${base}/api/copilot/dots/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('secret-from-upstream'), false);
  assert.equal(
    (await fetch(`${base}/api/copilot/dots/workspace?url=https://evil.example`)).status,
    403,
  );
});

test('compatible runtime preserves model routing and streams a tool call and its continuation', async () => {
  const calls = [];
  const model = express();
  model.use(express.json());
  model.post('/v1/chat/completions', (req, res) => {
    calls.push({ body: req.body, authorization: req.headers.authorization });
    const continuation = req.body.messages.some((message) => message.role === 'tool');
    const delta = continuation
      ? { role: 'assistant', content: 'Result: 42' }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'fixture-call',
              type: 'function',
              function: { name: 'sgpt_add', arguments: '{"a":17,"b":25}' },
            },
          ],
        };
    res.setHeader('content-type', 'text/event-stream');
    for (const choice of [
      { index: 0, delta, finish_reason: null },
      { index: 0, delta: {}, finish_reason: continuation ? 'stop' : 'tool_calls' },
    ]) {
      res.write(
        `data: ${JSON.stringify({
          id: 'fixture-completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture-qwen',
          choices: [choice],
        })}\n\n`,
      );
    }
    res.end('data: [DONE]\n\n');
  });
  const upstream = await serve(model);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'owner', role: 'ADMIN', tenantId: 'tenant' };
    req.config = {
      config: {
        copilot: {
          enabled: true,
          baseUrl: `${upstream}/v1`,
          model: 'fixture-qwen',
          maxSteps: 8,
        },
      },
    };
    next();
  });
  app.use('/api/copilot', createCopilotRouter({ resolveSecret: (value) => value }));
  const base = await serve(app);
  const status = await (await fetch(`${base}/api/copilot/status`)).json();
  assert.equal(status.ready, true);
  assert.equal(JSON.stringify(status).includes(upstream), false);
  const messages = [{ id: 'user-message', role: 'user', content: 'Add 17 and 25 with sgpt_add.' }];
  const tool = {
    name: 'sgpt_add',
    description: 'Add two integers',
    parameters: {
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  };
  async function run(id, runMessages) {
    const result = await fetch(`${base}/api/copilot/runtime/agent/default/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        threadId: 'tenant:owner:compatible-test',
        runId: id,
        state: {},
        messages: runMessages,
        tools: [tool],
        context: [],
        forwardedProps: { model: 'untrusted-model-override', apiKey: 'untrusted-key-override' },
      }),
    });
    assert.equal(result.status, 200);
    const text = await result.text();
    const events = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    assert.equal(
      events.some((event) => event.type === 'RUN_ERROR'),
      false,
      text,
    );
    return events;
  }
  const first = await run('first-run', messages);
  assert(
    first.some((event) => event.type === 'TOOL_CALL_START' && event.toolCallName === 'sgpt_add'),
  );
  const args = first
    .filter((event) => event.type === 'TOOL_CALL_ARGS')
    .map((event) => event.delta)
    .join('');
  const { a, b } = JSON.parse(args);
  assert.equal(a + b, 42);
  const second = await run('second-run', [
    ...messages,
    {
      id: 'assistant-message',
      role: 'assistant',
      toolCalls: [
        {
          id: 'fixture-call',
          type: 'function',
          function: { name: 'sgpt_add', arguments: args },
        },
      ],
    },
    { id: 'tool-message', role: 'tool', toolCallId: 'fixture-call', content: String(a + b) },
  ]);
  assert.equal(
    second
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => event.delta)
      .join(''),
    'Result: 42',
  );
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.body.model, 'fixture-qwen');
    assert.equal(call.body.stream, true);
    assert.equal(call.authorization, 'Bearer not-required');
    assert.equal(JSON.stringify(call).includes('untrusted-key-override'), false);
  }
});
