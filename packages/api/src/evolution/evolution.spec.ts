import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createEvolutionStore } from '@librechat/data-schemas';
import { copilotConfigSchema, emptyEvolutionState } from 'librechat-data-provider';
import type { CopilotConfig, EvolutionSource } from 'librechat-data-provider';
import type { EvolutionStore } from '@librechat/data-schemas';
import { calculateWorkbook, workbookSchema, presentationBounds } from './artifacts';
import { createEvaluator, createModelCompletion } from './evaluate';
import { createEvolutionService, nextResearchAt } from './service';
import { createEvolutionRouter } from './handlers';
import { createGitHubResearch } from './github';

let mongo: MongoMemoryServer;
let store: EvolutionStore;
const owner = { id: '111111111111111111111111', role: 'ADMIN' };
const scope = { ownerUserId: owner.id, tenantId: '' };
const commit = 'a'.repeat(40);
const body =
  '---\nname: memory-guide\ndescription: Retrieve corrected scoped memories with evidence.\nlicense: MIT\n---\nCandidate instructions: preserve corrections and provenance.';
const good = {
  currency: 'TRY',
  includeOwnerB: false,
  includeDeleted: false,
  retainProvenance: true,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fixtureFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/chat/completions')) {
    const sent = JSON.parse(String(init?.body));
    const candidate = sent.messages[1].content.includes('Candidate instructions');
    return json({
      choices: [
        {
          message: {
            content: JSON.stringify(
              candidate ? good : { ...good, currency: 'USD', includeOwnerB: true },
            ),
          },
        },
      ],
    });
  }
  if (url.endsWith('/repos/fixture/skills'))
    return json({ full_name: 'fixture/skills', private: false, license: { spdx_id: 'MIT' } });
  if (url.includes('/commits/')) return json({ sha: commit });
  if (url.includes('/git/trees/'))
    return json({
      tree: [{ path: 'memory/SKILL.md', type: 'blob', sha: 'skill-blob' }],
      truncated: false,
    });
  if (url.endsWith('/git/blobs/skill-blob'))
    return json({
      encoding: 'base64',
      content: Buffer.from(body).toString('base64'),
      size: Buffer.byteLength(body),
    });
  if (url.includes('/contents/memory/SKILL.md?'))
    return json({
      encoding: 'base64',
      content: Buffer.from(body).toString('base64'),
      size: Buffer.byteLength(body),
    });
  if (url.includes('/contents/memory?'))
    return json([{ path: 'memory/SKILL.md', type: 'file', sha: 'skill-blob' }]);
  if (url.includes('/contents?')) return json([{ path: 'memory', type: 'dir', sha: 'directory' }]);
  throw new Error(`Unexpected fixture path: ${new URL(url).pathname}`);
});
const configFor = (changes = {}): CopilotConfig =>
  copilotConfigSchema.parse({
    enabled: true,
    evolution: {
      enabled: true,
      ownerUserId: owner.id,
      apiKey: 'fixture-only-not-a-real-key',
      topics: ['memory'],
      sources: [{ topic: 'memory', repository: 'fixture/skills', path: 'memory/SKILL.md' }],
      ...changes,
    },
  });
const serviceFor = (config = configFor()) =>
  createEvolutionService({
    store,
    getConfig: async () => config,
    research: createGitHubResearch(fixtureFetch),
    evaluate: createEvaluator(createModelCompletion(fixtureFetch)),
  });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  mongoose.model(
    'User',
    new mongoose.Schema({ _id: mongoose.Schema.Types.ObjectId, role: String, tenantId: String }),
  );
  store = createEvolutionStore(mongoose);
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.models.User.create({ _id: owner.id, role: owner.role });
  fixtureFetch.mockClear();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('calendar schedule is exactly Monday/Thursday 09:00 Istanbul and survives a missed run', () => {
  const config = configFor().evolution!;
  expect(nextResearchAt(config, new Date('2026-10-21T10:00:00Z'))).toBe('2026-10-22T06:00:00.000Z');
  expect(nextResearchAt(config, new Date('2026-10-22T06:00:00Z'))).toBe('2026-10-26T06:00:00.000Z');
});

test('real GitHub adapter pins content, tests both variants, activates, retains learning across restart and rolls back', async () => {
  const service = serviceFor();
  const initial = await service.status(owner);
  expect(initial.state.nextRunAt).toBeTruthy();
  await service.start('manual', owner);
  await service.drain();
  const result = await service.status(owner);
  expect(result.state.runs[0].status).toBe('completed');
  expect(result.state.runs[0].findings[0].result).toBe('promoted');
  expect(result.state.active.memory?.source.commit).toBe(commit);
  expect(result.state.lessons[0].validated).toBe(true);
  const restarted = serviceFor();
  expect((await restarted.loadSkill(owner, 'memory')).source?.instructions).toContain(
    'Candidate instructions',
  );
  await restarted.learn(owner, { topic: 'memory', text: 'Prefer source-linked corrections.' });
  await restarted.rollback(owner, 'memory');
  const restored = await restarted.status(owner);
  expect(restored.state.active.memory).toBeUndefined();
  expect(
    restored.state.lessons.some((entry) => entry.text === 'Prefer source-linked corrections.'),
  ).toBe(true);
  await restarted.start('manual', owner);
  await restarted.drain();
  expect((await restarted.status(owner)).state.active.memory).toBeUndefined();
  expect((await restarted.status(owner)).state.runs[0].findings[0].result).toBe('retained');
});

test('failed measured candidate never replaces the incumbent', async () => {
  const badFetch = async (input: string | URL | Request, init?: RequestInit) =>
    String(input).endsWith('/chat/completions')
      ? json({
          choices: [{ message: { content: JSON.stringify({ ...good, includeDeleted: true }) } }],
        })
      : fixtureFetch(input, init);
  const service = createEvolutionService({
    store,
    getConfig: async () => configFor(),
    research: createGitHubResearch(fixtureFetch),
    evaluate: createEvaluator(createModelCompletion(badFetch)),
  });
  await service.start('manual', owner);
  await service.drain();
  const result = await service.status(owner);
  expect(result.state.active.memory).toBeUndefined();
  expect(result.state.runs[0].findings[0].result).toBe('failed_tests');
});

test('post-activation failed health check restores the previous binding and keeps learning', async () => {
  let calls = 0;
  const healthFetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/chat/completions') && ++calls === 4)
      return json({
        choices: [{ message: { content: JSON.stringify({ ...good, currency: 'EUR' }) } }],
      });
    return fixtureFetch(input, init);
  };
  const service = createEvolutionService({
    store,
    getConfig: async () => configFor(),
    research: createGitHubResearch(fixtureFetch),
    evaluate: createEvaluator(createModelCompletion(healthFetch)),
  });
  await service.start('manual', owner);
  await service.drain();
  const result = await service.status(owner);
  expect(result.state.active.memory).toBeUndefined();
  expect(result.state.runs[0].findings.map((entry) => entry.result)).toEqual([
    'promoted',
    'rolled_back',
  ]);
  expect(result.state.lessons).toHaveLength(1);
});

test('presentation and finance research run before other topics, without pretending missing model setup passed', async () => {
  const order: string[] = [];
  const source = (topic: 'finance' | 'presentations' | 'memory'): EvolutionSource => ({
    topic,
    repository: 'fixture/skills',
    commit,
    path: 'SKILL.md',
    url: 'https://github.com/fixture/skills',
    license: 'MIT',
    content: body,
    files: {},
    digest: topic,
    discoveredAt: new Date().toISOString(),
    kind: 'skill',
    compatible: true,
  });
  const config = configFor({ topics: ['memory', 'finance', 'presentations'], apiKey: undefined });
  const service = createEvolutionService({
    store,
    getConfig: async () => config,
    research: async (topic) => {
      order.push(topic);
      return [source(topic as 'memory')];
    },
  });
  await service.start('manual', owner);
  await service.drain();
  expect(order).toEqual(['finance', 'presentations', 'memory']);
  expect(
    (await service.status(owner)).state.runs[0].findings.every(
      (entry) => entry.result === 'setup_required',
    ),
  ).toBe(true);
});

test('database lease fences stale workers and concurrent runs', async () => {
  const clock = new Date();
  const later = new Date(clock.getTime() + 1000);
  expect(await store.claim(scope, 'old', later, clock)).toBe(true);
  expect(await store.claim(scope, 'other', later, clock)).toBe(false);
  expect(await store.claim(scope, 'new', new Date(later.getTime() + 1000), later)).toBe(true);
  expect(await store.save(scope, emptyEvolutionState(), 'old', later)).toBe(false);
  expect(await store.save(scope, emptyEvolutionState(), 'new', later)).toBe(true);
});

test('cancellation prevents a late worker from committing an activation', async () => {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createEvolutionService({
    store,
    getConfig: async () => configFor(),
    research: async () => {
      await wait;
      return [];
    },
  });
  await service.start('manual', owner);
  await expect(service.start('manual', owner)).rejects.toMatchObject({ code: 'EVOLUTION_BUSY' });
  await service.cancel(owner);
  release();
  await service.drain();
  expect((await service.status(owner)).state.runs[0].status).toBe('cancelled');
});

test('owner/tenant authorization and HTTP validation stay at the request boundary', async () => {
  const service = serviceFor();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    let user = { ...owner, tenantId: '' };
    if (req.headers['x-other-user']) user = { ...user, id: '222222222222222222222222' };
    else if (req.headers['x-other-tenant']) user = { ...user, tenantId: 'other' };
    Object.assign(req, { user });
    next();
  });
  app.use(createEvolutionRouter(service));
  expect((await request(app).get('/').set('x-other-user', '1')).status).toBe(403);
  expect((await request(app).get('/').set('x-other-tenant', '1')).status).toBe(403);
  expect(
    (
      await request(app)
        .post('/lessons')
        .send({ topic: 'memory', text: 'ok', ownerUserId: 'other' })
    ).status,
  ).toBe(400);
  expect(
    (await request(app).post('/lessons').send({ topic: 'memory', text: 'Use provenance.' })).status,
  ).toBe(200);
  const result = await request(app).get('/');
  expect(result.status).toBe(200);
  expect(result.body).not.toHaveProperty('apiKey');
});

test('finance interpreter handles references and rejects cycles and executable formulas', () => {
  const model = workbookSchema.parse({
    sheet: 'Model',
    currency: 'TRY',
    period: '2026',
    source: 'fixture',
    cells: [
      { ref: 'B1', value: 100 },
      { ref: 'B2', value: { formula: 'B1*(1-0.25)' } },
    ],
  });
  expect(calculateWorkbook(model).B2).toBe(75);
  expect(() =>
    calculateWorkbook({ ...model, cells: [{ ref: 'B1', value: { formula: 'B1+1' } }] }),
  ).toThrow('CYCLIC_FORMULA');
  expect(() =>
    calculateWorkbook({ ...model, cells: [{ ref: 'B1', value: { formula: 'WEBSERVICE(B2)' } }] }),
  ).toThrow('UNSAFE_FORMULA');
});

test('rendered presentation geometry rejects overflow and overlapping text blocks', () => {
  const page =
    '<page width="960" height="540"><block xMin="20" yMin="20" xMax="400" yMax="80"><word xMin="20" yMin="20" xMax="40" yMax="40">A</word></block><block xMin="20" yMin="70" xMax="400" yMax="120"><word xMin="20" yMin="70" xMax="40" yMax="90">B</word></block></page>';
  expect(presentationBounds(page)).toEqual({ inBounds: true, noOverlap: false });
  expect(presentationBounds(page.replace('xMax="40"', 'xMax="1000"')).inBounds).toBe(false);
});

test('authenticated discovery filters private results before reading source and pins public skill files', async () => {
  const paths: string[] = [];
  const searchFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    paths.push(url);
    if (url.includes('/search/code?'))
      return json({
        items: [
          { path: 'SKILL.md', repository: { full_name: 'private/secret', private: true } },
          { path: 'memory/SKILL.md', repository: { full_name: 'fixture/skills', private: false } },
        ],
      });
    return fixtureFetch(input, init);
  };
  const config = configFor({
    sources: [],
    githubToken: 'fixture-token',
    pluginsPerTopic: 0,
  }).evolution!;
  const result = await createGitHubResearch(searchFetch)(
    'memory',
    config,
    new AbortController().signal,
  );
  expect(result[0].commit).toBe(commit);
  expect(result[0].compatible).toBe(true);
  expect(paths.some((path) => path.includes('/repos/private/'))).toBe(false);
  expect(paths.some((path) => path.includes('/git/trees/'))).toBe(false);
});

test('a per-skill proprietary license cannot be overridden by an MIT frontmatter claim', async () => {
  const licenseFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/contents/memory?'))
      return json([
        { path: 'memory/SKILL.md', type: 'file', sha: 'skill-blob' },
        { path: 'memory/LICENSE.txt', type: 'file', sha: 'license-blob' },
      ]);
    if (url.includes('/contents/memory/LICENSE.txt?')) {
      const content = 'Source available only. All other rights reserved.';
      return json({
        encoding: 'base64',
        size: content.length,
        content: Buffer.from(content).toString('base64'),
      });
    }
    return fixtureFetch(input, init);
  };
  const result = await createGitHubResearch(licenseFetch)(
    'memory',
    configFor().evolution!,
    new AbortController().signal,
  );
  expect(result[0].license).toBe('UNKNOWN');
});

test('plugin research records an exact source revision without activating an unverified adapter', async () => {
  const pluginFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/search/code?')) return json({ items: [] });
    if (url.includes('/search/repositories?'))
      return json({
        items: [{ full_name: 'fixture/plugin', private: false, license: { spdx_id: 'MIT' } }],
      });
    if (url.includes('/commits/')) return json({ sha: commit });
    throw new Error('Unexpected plugin fixture path');
  };
  const config = configFor({ sources: [], githubToken: 'fixture-token' });
  const complete = jest.fn(async () => good);
  const service = createEvolutionService({
    store,
    getConfig: async () => config,
    research: createGitHubResearch(pluginFetch),
    evaluate: createEvaluator(complete),
  });
  await service.start('manual', owner);
  await service.drain();
  const result = await service.status(owner);
  expect(result.state.runs[0].findings[0]).toMatchObject({
    repository: 'fixture/plugin',
    commit,
    result: 'unsupported_adapter',
  });
  expect(complete).not.toHaveBeenCalled();
  expect(result.state.active.memory).toBeUndefined();
});

test('a retained correction supersedes stale guidance in the runtime after a service restart', async () => {
  const service = serviceFor();
  await service.learn(owner, { topic: 'memory', text: 'Prefer USD for reports.' });
  const old = (await service.status(owner)).state.lessons[0];
  await service.learn(owner, {
    topic: 'memory',
    text: 'Prefer TRY for reports.',
    supersedes: old.id,
  });
  const restarted = serviceFor();
  const context = await restarted.loadSkill(owner, 'memory');
  expect(context.retainedMethods).toContain('Prefer TRY');
  expect(context.retainedMethods).not.toContain('Prefer USD');
});
