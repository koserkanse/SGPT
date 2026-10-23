import { z } from 'zod';
import { readFile } from 'node:fs/promises';

const profileSchema = z.object({
  key: z.string(),
  name: z.string().min(1).max(40),
  instructions: z.string().min(3).max(2000),
  researchAllowed: z.boolean(),
  memoryAllowed: z.boolean(),
  appsAllowed: z.literal(false),
});
const catalog = z
  .object({
    version: z.literal(1),
    space: z.object({ name: z.string(), description: z.string() }),
    assistants: z.array(profileSchema),
  })
  .parse(
    JSON.parse(
      await readFile(new URL('../config/assistants/defaults.json', import.meta.url), 'utf8'),
    ),
  );
const dotSchema = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  spaceId: z.string(),
  spaceIds: z.array(z.string()),
});
const spaceSchema = z.object({ id: z.string(), name: z.string() });
const workspaceSchema = z.object({
  spaces: z.array(spaceSchema),
  dots: z.array(dotSchema),
  conversations: z.array(z.unknown()),
  setup: z.object({ missing: z.array(z.string()) }),
});
const token = process.env.OWNER_TOKEN;
if (!token) throw new Error('OWNER_TOKEN must come from the existing OpenDots environment.');
const base = 'http://127.0.0.1:4310/api';
async function request(path: string, body?: object, method = 'POST'): Promise<unknown> {
  const response = await fetch(base + path, {
    method: body ? method : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`OpenDots request failed (${response.status}); no credentials logged.`);
  return response.json();
}
const workspace = workspaceSchema.parse(await request('/workspace'));
console.log('Profiles:', catalog.assistants.map((profile) => profile.name).join(', '));
if (!process.argv.includes('--apply')) {
  console.log('Preview only. Add --apply to provision profiles in the existing local workspace.');
  process.exit(0);
}
let space = workspace.spaces.find((item) => item.name === catalog.space.name);
space ??= spaceSchema.parse(await request('/spaces', catalog.space));
const starterInstructions =
  'Be thoughtful, practical, and concise. Help the user think clearly and follow through.';
for (const { key, ...profile } of catalog.assistants) {
  if (workspace.dots.some((dot) => dot.name === profile.name)) {
    console.log('Kept existing profile:', profile.name);
    continue;
  }
  const starter =
    key === 'seko' && workspace.conversations.length === 0
      ? workspace.dots.find((dot) => dot.name === 'Dot' && dot.instructions === starterInstructions)
      : undefined;
  const body = {
    ...profile,
    spaceId: space.id,
    spaceIds: [...new Set([...(starter?.spaceIds ?? []), space.id])],
  };
  if (starter) {
    await request(`/dots/${encodeURIComponent(starter.id)}`, body, 'PUT');
    console.log('Configured initial assistant:', profile.name);
  } else {
    await request('/dots', body);
    console.log('Created profile:', profile.name);
  }
}
const verified = workspaceSchema.parse(await request('/workspace'));
for (const profile of catalog.assistants) {
  if (!verified.dots.some((dot) => dot.name === profile.name))
    throw new Error(`Profile verification failed: ${profile.name}`);
}
console.log('Verified profile count:', catalog.assistants.length);
console.log('Remaining conversation setup:', verified.setup.missing.join(', ') || 'none');
