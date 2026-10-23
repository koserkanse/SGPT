export class EvolutionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export type EvolutionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Bound both streaming and Content-Length responses before parsing untrusted JSON. */
export async function boundedJson(response: Response, maxBytes = 2_000_000): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new EvolutionError(
      response.status === 429 || response.status === 403 ? 'RATE_LIMITED' : 'UPSTREAM_FAILED',
    );
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new EvolutionError('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new EvolutionError('EMPTY_RESPONSE');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new EvolutionError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new EvolutionError('INVALID_RESPONSE');
  }
}
