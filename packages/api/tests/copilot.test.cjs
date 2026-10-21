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
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
    });
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
