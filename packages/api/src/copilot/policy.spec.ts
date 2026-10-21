import { copilotConfigSchema } from 'librechat-data-provider';
import {
  canUseCopilot,
  canUseDots,
  resolveCopilotConfig,
  isRuntimeRequestAllowed,
  isDotRequestAllowed,
  threadPrefix,
} from './policy';

const owner = { id: 'owner', role: 'ADMIN', tenantId: 'tenant-a' };
const config = copilotConfigSchema.parse({
  enabled: true,
  openDots: { url: 'http://127.0.0.1:4310', ownerUserId: owner.id, token: 'a'.repeat(32) },
});

test('Copilot stays opt-in and grants administrators or named users only', () => {
  expect(canUseCopilot(undefined, owner)).toBe(false);
  expect(canUseCopilot(config, owner)).toBe(true);
  expect(canUseCopilot(config, { id: 'other', role: 'USER' })).toBe(false);
  expect(canUseCopilot({ ...config, allowedUserIds: ['other'] }, { id: 'other' })).toBe(true);
  expect(canUseCopilot({ ...config, enabled: false }, owner)).toBe(false);
});

test('OpenDots owner is distinct from LibreChat admin access', () => {
  expect(canUseDots(config, owner)).toBe(true);
  expect(canUseDots(config, { id: 'other-admin', role: 'ADMIN' })).toBe(false);
});

test('resolve server-side credential references and fail closed when missing', () => {
  const input = {
    ...config,
    apiKey: '${MODEL_KEY}',
    openDots: { ...config.openDots, ownerUserId: '${OWNER_ID}', token: '${OWNER_TOKEN}' },
  };
  const env: Record<string, string> = {
    MODEL_KEY: 'model-key',
    OWNER_ID: 'owner',
    OWNER_TOKEN: 'x'.repeat(32),
  };
  const resolved = resolveCopilotConfig(input, (value) =>
    value.replace(/^\$\{(.+)\}$/, (_match, name: string) => env[name] ?? ''),
  );
  expect(resolved?.apiKey).toBe('model-key');
  expect(resolved?.openDots?.ownerUserId).toBe('owner');
  expect(resolveCopilotConfig(input, () => undefined)?.openDots).toBeUndefined();
  expect(resolveCopilotConfig(input, (value) => value)?.apiKey).toBeUndefined();
  expect(resolveCopilotConfig(input, (value) => value)?.openDots).toBeUndefined();
});

test('SDK global routes and other tenants/users cannot access a thread', () => {
  const body = { threadId: `${threadPrefix(owner)}thread` };
  expect(isRuntimeRequestAllowed('POST', '/agent/default/run', body, owner)).toBe(true);
  expect(isRuntimeRequestAllowed('POST', '/agent/default/connect', body, owner)).toBe(true);
  expect(
    isRuntimeRequestAllowed('POST', '/agent/default/run', body, { ...owner, tenantId: 'tenant-b' }),
  ).toBe(false);
  expect(
    isRuntimeRequestAllowed('POST', '/agent/default/run', body, { ...owner, id: 'other' }),
  ).toBe(false);
  expect(isRuntimeRequestAllowed('GET', '/threads', {}, owner)).toBe(false);
  expect(isRuntimeRequestAllowed('GET', '/inspector-metadata', {}, owner)).toBe(false);
  expect(isRuntimeRequestAllowed('POST', '/agent/default/stop/%', body, owner)).toBe(false);
  expect(
    isRuntimeRequestAllowed(
      'POST',
      `/agent/default/stop/${encodeURIComponent(body.threadId)}`,
      { threadId: 'other' },
      owner,
    ),
  ).toBe(false);
});

test('only the intended OpenDots bridge surface is exposed', () => {
  expect(isDotRequestAllowed('GET', '/workspace')).toBe(true);
  expect(isDotRequestAllowed('POST', '/runtime/agent/scout/run')).toBe(true);
  expect(isDotRequestAllowed('POST', '/conversations/thread/reviewed-page')).toBe(true);
  expect(isDotRequestAllowed('POST', '/conversations/thread/connection-actions')).toBe(true);
  expect(isDotRequestAllowed('PATCH', '/settings')).toBe(false);
  expect(isDotRequestAllowed('POST', '/connections')).toBe(false);
  expect(isDotRequestAllowed('GET', '/runtime/threads')).toBe(false);
  expect(isDotRequestAllowed('GET', '//evil.example/workspace')).toBe(false);
});
