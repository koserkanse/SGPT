import { copilotConfigSchema, SystemRoles } from 'librechat-data-provider';
import type { CopilotConfig } from 'librechat-data-provider';

export type CopilotUser = { id: string; role?: string; tenantId?: string };

export function resolveCopilotConfig(
  input: unknown,
  resolveSecret: (value: string) => string | undefined,
): CopilotConfig | undefined {
  const parsed = copilotConfigSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const config = parsed.data;
  const resolve = (value: string): string | undefined => {
    const result = resolveSecret(value)?.trim();
    return result && !result.includes('${') && result !== 'user_provided' ? result : undefined;
  };
  config.apiKey = config.apiKey ? resolve(config.apiKey) : undefined;
  if (config.baseUrl) {
    const value = resolve(config.baseUrl);
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return undefined;
      config.baseUrl = url.toString().replace(/\/$/, '');
    } catch {
      return undefined;
    }
  }
  if (config.evolution) {
    config.evolution.apiKey = config.evolution.apiKey
      ? resolve(config.evolution.apiKey)
      : config.apiKey;
    config.evolution.githubToken = config.evolution.githubToken
      ? resolve(config.evolution.githubToken)
      : undefined;
    config.evolution.ownerUserId = resolve(config.evolution.ownerUserId) ?? '';
    if (!config.evolution.ownerUserId) config.evolution.enabled = false;
  }
  if (config.openDots) {
    const token = resolve(config.openDots.token);
    const owner = resolve(config.openDots.ownerUserId);
    if (!token || token.length < 24 || !owner) config.openDots = undefined;
    else {
      config.openDots.token = token;
      config.openDots.ownerUserId = owner;
    }
  }
  return config;
}

/** Compatible servers may intentionally have no API authentication. */
export function hasCopilotModel(config?: CopilotConfig): boolean {
  return !!config && !!(config.baseUrl || config.apiKey);
}

export function canUseCopilot(config: CopilotConfig | undefined, user?: CopilotUser): boolean {
  return !!(
    config?.enabled &&
    user &&
    (user.role === SystemRoles.ADMIN || config.allowedUserIds.includes(user.id))
  );
}

export function canUseDots(config: CopilotConfig, user: CopilotUser): boolean {
  return !!config.openDots && config.openDots.ownerUserId === user.id;
}

export const threadPrefix = (user: CopilotUser): string =>
  `${user.tenantId ?? 'default'}:${user.id}:`;

/** Only expose the SSE runner surface; its global thread/history routes are not user-scoped. */
export function isRuntimeRequestAllowed(
  method: string,
  path: string,
  body: unknown,
  user: CopilotUser,
): boolean {
  if (method === 'GET' && path === '/info') return true;
  if (method !== 'POST') return false;
  const match = path.match(/^\/agent\/default\/(run|connect|stop\/([^/]+))$/);
  if (!match) return false;
  const bodyThread =
    body && typeof body === 'object' && 'threadId' in body ? body.threadId : undefined;
  let thread: unknown = bodyThread;
  try {
    if (match[2]) thread = decodeURIComponent(match[2]);
  } catch {
    return false;
  }
  return (
    typeof thread === 'string' &&
    thread.startsWith(threadPrefix(user)) &&
    thread.length > threadPrefix(user).length &&
    (bodyThread === undefined || bodyThread === thread)
  );
}

/** Fixed upstream routes keep the bridge from becoming an arbitrary owner-token proxy. */
export function isDotRequestAllowed(method: string, path: string): boolean {
  if (method === 'GET' && path === '/workspace') return true;
  if (method === 'POST' && path === '/conversations') return true;
  if (
    method === 'GET' &&
    /^\/conversations\/[^/]+\/(reviewed-page\/[^/]+|connection-approvals\/[^/]+|connection-actions\/[^/]+)$/.test(
      path,
    )
  )
    return true;
  if (
    method === 'POST' &&
    /^\/conversations\/[^/]+\/(reviewed-page|connection-actions)$/.test(path)
  )
    return true;
  if (method === 'GET' && path === '/runtime/info') return true;
  return method === 'POST' && /^\/runtime\/agent\/[^/]+\/(run|connect|stop\/[^/]+)$/.test(path);
}
