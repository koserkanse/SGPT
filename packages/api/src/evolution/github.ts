import { z } from 'zod';
import { load } from 'js-yaml';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { EvolutionConfig, EvolutionSource, EvolutionTopic } from 'librechat-data-provider';
import type { EvolutionFetch } from './http';
import { topicHints, topicQueries, pluginQueries } from './catalog';
import { boundedJson, EvolutionError } from './http';

const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const repoSchema = z.object({
  full_name: repoName,
  private: z.boolean(),
  stargazers_count: z.number().default(0),
  license: z.object({ spdx_id: z.string() }).nullable(),
});
const entrySchema = z.object({ path: z.string(), type: z.string(), sha: z.string() });
const treeSchema = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(entrySchema).max(15000),
});
const blobSchema = z.object({
  encoding: z.literal('base64'),
  content: z.string(),
  size: z.number().min(0),
});
const shaSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const frontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    license: z.string().optional(),
    'allowed-tools': z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();
const codeTerms: Record<EvolutionTopic, string> = {
  presentations: 'presentation',
  finance: 'finance',
  'generative-ui': 'generative',
  agents: 'agent',
  mcp: 'MCP',
  memory: 'memory',
  documents: 'document',
  'sales-crm': 'CRM',
};
const segmentPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const exec = promisify(execFile);

export function createGitHubResearch(fetcher: EvolutionFetch = fetch) {
  // Only share responses inside one run, never across credentials or future source revisions.
  const caches = new WeakMap<AbortSignal, Map<string, unknown>>();
  return async (
    topic: EvolutionTopic,
    config: EvolutionConfig,
    signal: AbortSignal,
  ): Promise<EvolutionSource[]> => {
    let cache = caches.get(signal);
    if (!cache) {
      cache = new Map();
      caches.set(signal, cache);
    }
    const request = async (path: string): Promise<unknown> => {
      signal.throwIfAborted();
      if (cache.has(path)) return cache.get(path);
      let value: unknown;
      if (config.githubCliPath) {
        let stdout: string;
        try {
          stdout = (
            await exec(
              config.githubCliPath,
              ['api', '--hostname', 'github.com', '--method', 'GET', path],
              {
                signal,
                timeout: config.requestTimeoutMs,
                maxBuffer: config.maxResponseBytes,
                encoding: 'utf8',
              },
            )
          ).stdout;
        } catch {
          signal.throwIfAborted();
          throw new EvolutionError('GITHUB_REQUEST_FAILED');
        }
        try {
          value = JSON.parse(stdout);
        } catch {
          throw new EvolutionError('INVALID_RESPONSE');
        }
      } else {
        value = await boundedJson(
          await fetcher(`https://api.github.com${path}`, {
            headers: {
              accept: 'application/vnd.github+json',
              'x-github-api-version': '2022-11-28',
              ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
            redirect: 'error',
          }),
          config.maxResponseBytes,
        );
      }
      cache.set(path, value);
      return value;
    };
    const configured = config.sources.filter((source) => source.topic === topic);
    let candidates = configured;
    if (!configured.length && (config.githubCliPath || config.githubToken)) {
      // REST code search's legacy syntax has no public-only qualifier. Require the
      // repository's explicit private=false before any source is fetched or retained.
      const result = z
        .object({
          items: z.array(
            z.object({
              path: z.string(),
              repository: z.object({ full_name: repoName, private: z.boolean() }),
            }),
          ),
        })
        .parse(
          await request(
            `/search/code?q=${encodeURIComponent(`${codeTerms[topic]} filename:SKILL.md`)}&per_page=${config.candidatesPerTopic * 3}`,
          ),
        );
      const ranked: { topic: EvolutionTopic; repository: string; path: string; stars: number }[] =
        [];
      for (const hit of result.items.filter((item) => !item.repository.private)) {
        if (!/(^|\/)SKILL\.md$/i.test(hit.path)) continue;
        const repo = repoSchema.parse(await request(`/repos/${hit.repository.full_name}`));
        if (repo.private || !repo.license || !config.allowedLicenses.includes(repo.license.spdx_id))
          continue;
        ranked.push({
          topic,
          repository: repo.full_name,
          path: hit.path,
          stars: repo.stargazers_count,
        });
      }
      candidates = ranked
        .sort((a, b) => b.stars - a.stars)
        .slice(0, config.candidatesPerTopic)
        .map(({ topic, repository, path }) => ({ topic, repository, path, ref: undefined }));
    } else if (!configured.length) {
      const search = z
        .object({ items: z.array(repoSchema) })
        .parse(
          await request(
            `/search/repositories?q=${encodeURIComponent(`${topicQueries[topic]} archived:false fork:false`)}&sort=stars&per_page=20`,
          ),
        );
      candidates = search.items
        .filter(
          (repo) =>
            !repo.private && repo.license && config.allowedLicenses.includes(repo.license.spdx_id),
        )
        .slice(0, config.candidatesPerTopic)
        .map((repo) => ({ topic, repository: repo.full_name, path: '', ref: undefined }));
    }
    const sources: EvolutionSource[] = [];
    for (const candidate of candidates.slice(0, config.candidatesPerTopic)) {
      signal.throwIfAborted();
      const repo = repoSchema.parse(await request(`/repos/${candidate.repository}`));
      if (repo.private) throw new EvolutionError('PRIVATE_SOURCE_REJECTED');
      const commit = shaSchema.parse(
        await request(`/repos/${candidate.repository}/commits/${candidate.ref ?? 'HEAD'}`),
      ).sha;
      const contentsPath = (path: string) =>
        `/repos/${repo.full_name}/contents${path ? `/${segmentPath(path)}` : ''}?ref=${commit}`;
      const decode = (value: unknown) => {
        const blob = blobSchema.parse(value);
        const text = Buffer.from(blob.content, 'base64').toString('utf8');
        if (blob.size > config.maxSourceBytes || Buffer.byteLength(text) > config.maxSourceBytes)
          throw new EvolutionError('SOURCE_TOO_LARGE');
        return text;
      };
      let entries: z.infer<typeof entrySchema>[] = [];
      let selected: z.infer<typeof entrySchema> | undefined;
      if (candidate.path) {
        if (candidate.path.startsWith('/') || candidate.path.split('/').includes('..'))
          throw new EvolutionError('INVALID_SOURCE_PATH');
        selected = { path: candidate.path, sha: '', type: 'blob' };
        // Listing only the known file's ancestor directories avoids downloading an
        // entire monorepo tree. An incomplete license listing is not accepted.
        const ancestors = candidate.path.split('/').slice(0, -1);
        for (let count = ancestors.length; count >= 0; count--) {
          const listing = z
            .array(entrySchema)
            .max(999)
            .parse(await request(contentsPath(ancestors.slice(0, count).join('/'))));
          entries.push(
            ...listing.map((entry) => ({
              ...entry,
              type: entry.type === 'file' ? 'blob' : entry.type,
            })),
          );
        }
      } else {
        const listing = treeSchema.parse(
          await request(`/repos/${candidate.repository}/git/trees/${commit}?recursive=1`),
        );
        if (listing.truncated) throw new EvolutionError('SOURCE_TREE_TOO_LARGE');
        entries = listing.tree.filter((item) => item.type === 'blob');
        const skills = entries.filter((item) => /(^|\/)SKILL\.md$/i.test(item.path));
        selected =
          skills.find((item) => topicHints[topic].test(item.path)) ??
          (skills.length === 1 ? skills[0] : undefined);
      }
      if (!selected) {
        sources.push({
          topic,
          repository: repo.full_name,
          commit,
          path: '',
          url: `https://github.com/${repo.full_name}/tree/${commit}`,
          license: repo.license?.spdx_id ?? 'UNKNOWN',
          content: '',
          files: {},
          digest: commit,
          discoveredAt: new Date().toISOString(),
          kind: 'plugin',
          compatible: false,
        });
        continue;
      }
      const read = async (path: string, sha?: string) =>
        decode(
          await request(
            candidate.path ? contentsPath(path) : `/repos/${repo.full_name}/git/blobs/${sha}`,
          ),
        );
      const content = await read(selected.path, selected.sha);
      const front = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      let metadata: z.infer<typeof frontmatterSchema> | undefined;
      try {
        metadata = front ? frontmatterSchema.parse(load(front[1], { json: true })) : undefined;
      } catch {
        /* Invalid metadata cannot become an active skill. */
      }
      const parent = selected.path.includes('/')
        ? selected.path.slice(0, selected.path.lastIndexOf('/') + 1)
        : '';
      const files: Record<string, string> = {};
      let bytes = Buffer.byteLength(content);
      const needsCode =
        /\b[\w./-]+\.(?:py|sh|js|ts|mjs|cjs)\b|\b(?:npm install|pip install|npx |bash |python3? )/i.test(
          content,
        );
      let compatible =
        !!metadata &&
        /(^|\/)SKILL\.md$/i.test(selected.path) &&
        !needsCode &&
        !metadata?.['allowed-tools'];
      const links = [
        ...new Set(
          [...content.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].map(
            (match) => match[1].split('#')[0],
          ),
        ),
      ];
      for (const link of compatible ? links.slice(0, config.maxReferenceFiles) : []) {
        if (link.startsWith('/') || link.split('/').includes('..') || !/\.md$/i.test(link)) {
          compatible = false;
          continue;
        }
        const entry = entries.find((item) => item.path === `${parent}${link}`);
        if (!candidate.path && !entry) {
          compatible = false;
          continue;
        }
        const text = await read(`${parent}${link}`, entry?.sha);
        bytes += Buffer.byteLength(text);
        if (bytes > config.maxSourceBytes) throw new EvolutionError('SOURCE_TOO_LARGE');
        files[link] = text;
      }
      if (
        links.length > config.maxReferenceFiles ||
        /\b[\w./-]+\.(?:py|sh|js|ts|mjs|cjs)\b|\b(?:npm install|pip install|npx |bash |python3? )/i.test(
          content,
        )
      )
        compatible = false;
      if (metadata?.['allowed-tools'] && String(metadata['allowed-tools']).trim())
        compatible = false;
      let license = repo.license?.spdx_id ?? 'UNKNOWN';
      const ancestors = selected.path.split('/').slice(0, -1);
      for (let count = ancestors.length; count > 0; count--) {
        const dir = `${ancestors.slice(0, count).join('/')}/`;
        const local = entries.find(
          (entry) =>
            entry.path.startsWith(dir) &&
            /^(LICENSE|COPYING)(\.[\w-]+)?$/i.test(entry.path.slice(dir.length)),
        );
        if (!local) continue;
        const text = await read(local.path, local.sha);
        license = 'UNKNOWN';
        if (/Permission is hereby granted, free of charge/i.test(text)) license = 'MIT';
        else if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) license = 'Apache-2.0';
        break;
      }
      if (
        metadata?.license &&
        config.allowedLicenses.includes(metadata.license) &&
        metadata.license !== license
      )
        license = 'UNKNOWN';
      else if (metadata?.license && !config.allowedLicenses.includes(metadata.license)) {
        const referenced = metadata.license.match(/(?:LICENSE|COPYING)(?:\.[\w-]+)?/i)?.[0];
        if (
          !referenced ||
          !entries.some(
            (entry) => entry.path === `${parent}${referenced}` || entry.path === referenced,
          )
        )
          license = 'UNKNOWN';
      }
      const digest = createHash('sha256')
        .update(JSON.stringify({ content, files, license }))
        .digest('hex');
      sources.push({
        topic,
        repository: repo.full_name,
        commit,
        path: selected.path,
        url: `https://github.com/${repo.full_name}/blob/${commit}/${segmentPath(selected.path)}`,
        license,
        content,
        files,
        digest,
        discoveredAt: new Date().toISOString(),
        kind: 'skill',
        compatible,
      });
    }
    if (!configured.length && config.pluginsPerTopic > 0) {
      const result = z
        .object({ items: z.array(repoSchema) })
        .parse(
          await request(
            `/search/repositories?q=${encodeURIComponent(`${pluginQueries[topic]} archived:false fork:false is:public`)}&sort=stars&per_page=10`,
          ),
        );
      const plugins = result.items
        .filter(
          (repo) =>
            !repo.private &&
            repo.license &&
            config.allowedLicenses.includes(repo.license.spdx_id) &&
            !sources.some((source) => source.repository === repo.full_name),
        )
        .slice(0, config.pluginsPerTopic);
      for (const repo of plugins) {
        const commit = shaSchema.parse(await request(`/repos/${repo.full_name}/commits/HEAD`)).sha;
        sources.push({
          topic,
          repository: repo.full_name,
          commit,
          path: '',
          url: `https://github.com/${repo.full_name}/tree/${commit}`,
          license: repo.license?.spdx_id ?? 'UNKNOWN',
          content: '',
          files: {},
          digest: commit,
          discoveredAt: new Date().toISOString(),
          kind: 'plugin',
          compatible: false,
        });
      }
    }
    return sources;
  };
}
