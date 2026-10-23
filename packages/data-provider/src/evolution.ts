import { z } from 'zod';

export const evolutionTopics = [
  'presentations',
  'finance',
  'generative-ui',
  'agents',
  'mcp',
  'memory',
  'documents',
  'sales-crm',
] as const;
export const evolutionTopicSchema = z.enum(evolutionTopics);
export type EvolutionTopic = z.infer<typeof evolutionTopicSchema>;
export const evolutionConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    ownerUserId: z.string().min(1),
    tenantId: z.string().default(''),
    timezone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      })
      .default('Europe/Istanbul'),
    days: z
      .array(z.number().int().min(0).max(6))
      .length(2)
      .refine((days) => days[0] !== days[1])
      .default([1, 4]),
    hour: z.number().int().min(0).max(23).default(9),
    minute: z.number().int().min(0).max(59).default(0),
    topics: z
      .array(evolutionTopicSchema)
      .min(1)
      .refine((topics) => new Set(topics).size === topics.length)
      .default([...evolutionTopics]),
    githubToken: z.string().optional(),
    githubTokenPreview: z.string().optional(),
    githubCliPath: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    apiKeyPreview: z.string().optional(),
    baseUrl: z.string().url().default('https://api.openai.com/v1'),
    model: z.string().min(1).default('gpt-4.1-mini'),
    candidatesPerTopic: z.number().int().min(1).max(5).default(1),
    pluginsPerTopic: z.number().int().min(0).max(5).default(1),
    minimumScore: z.number().min(0).max(1).default(0.85),
    improvementMargin: z.number().min(0.01).max(1).default(0.05),
    requestTimeoutMs: z.number().int().min(1000).max(300000).default(60000),
    runTimeoutMs: z.number().int().min(60000).max(7200000).default(1800000),
    pollIntervalMs: z.number().int().min(1000).max(300000).default(60000),
    maxSourceBytes: z.number().int().min(1000).max(100000).default(30000),
    maxReferenceFiles: z.number().int().min(0).max(20).default(8),
    maxResponseBytes: z.number().int().min(100000).max(10000000).default(2000000),
    retainedRuns: z.number().int().min(5).max(100).default(30),
    retainedLessons: z.number().int().min(10).max(200).default(100),
    retainedVersions: z.number().int().min(1).max(10).default(3),
    retainedBlockedVersions: z.number().int().min(10).max(1000).default(200),
    artifactRetentionDays: z.number().int().min(1).max(365).default(30),
    maxArtifactBytes: z.number().int().min(100000).max(10000000).default(3000000),
    libreOfficePath: z.string().min(1).optional(),
    pdfTextPath: z.string().min(1).optional(),
    pdfImagePath: z.string().min(1).optional(),
    allowedLicenses: z
      .array(z.string().min(1))
      .min(1)
      .default([
        'MIT',
        'Apache-2.0',
        'BSD-2-Clause',
        'BSD-3-Clause',
        'ISC',
        'MPL-2.0',
        'GPL-3.0',
        'AGPL-3.0',
      ]),
    sources: z
      .array(
        z
          .object({
            topic: evolutionTopicSchema,
            repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
            path: z
              .string()
              .min(1)
              .refine((p) => !p.startsWith('/') && !p.split('/').includes('..')),
            ref: z
              .string()
              .regex(/^[a-f0-9]{40}$/)
              .optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();
export type EvolutionConfig = z.infer<typeof evolutionConfigSchema>;
export type EvolutionScope = { ownerUserId: string; tenantId: string };
export type EvolutionSource = {
  topic: EvolutionTopic;
  repository: string;
  commit: string;
  path: string;
  url: string;
  license: string;
  content: string;
  files: Record<string, string>;
  digest: string;
  discoveredAt: string;
  kind: 'skill' | 'plugin';
  compatible: boolean;
};
export type EvolutionCheck = { id: string; passed: boolean; required?: boolean };
export type EvolutionEvaluation = {
  suite: string;
  score: number;
  passed: boolean;
  checks: EvolutionCheck[];
  model: string;
  context: string;
  artifactIds: string[];
  evaluatedAt: string;
};
export type EvolutionVersion = {
  id: string;
  source: EvolutionSource;
  evaluation: EvolutionEvaluation;
  activatedAt: string;
};
export type EvolutionLesson = {
  id: string;
  topic: EvolutionTopic;
  text: string;
  source: string;
  createdAt: string;
  supersedes?: string;
  validated: boolean;
};
export type EvolutionFinding = {
  topic: EvolutionTopic;
  repository: string;
  commit?: string;
  url: string;
  result:
    | 'promoted'
    | 'rolled_back'
    | 'retained'
    | 'failed_tests'
    | 'setup_required'
    | 'unsupported_adapter'
    | 'source_rejected'
    | 'research_failed';
  score?: number;
  checks?: EvolutionCheck[];
  artifactIds?: string[];
};
export type EvolutionRun = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  trigger: 'manual' | 'schedule';
  findings: EvolutionFinding[];
  code?: string;
};
export type EvolutionState = {
  revision: number;
  scheduleKey: string;
  nextRunAt: string | null;
  paused: boolean;
  active: Partial<Record<EvolutionTopic, EvolutionVersion>>;
  previous: Partial<Record<EvolutionTopic, EvolutionVersion[]>>;
  blocked: string[];
  lessons: EvolutionLesson[];
  runs: EvolutionRun[];
};
export type EvolutionStatus = {
  enabled: boolean;
  ready: boolean;
  timezone: string;
  days: number[];
  hour: number;
  minute: number;
  topics: EvolutionTopic[];
  state: EvolutionState;
  running: boolean;
  setup: string[];
};
export type EvolutionArtifact = {
  id: string;
  name: string;
  mime: string;
  data: string;
  createdAt: string;
};
export const emptyEvolutionState = (): EvolutionState => ({
  revision: 0,
  scheduleKey: '',
  nextRunAt: null,
  paused: false,
  active: {},
  previous: {},
  blocked: [],
  lessons: [],
  runs: [],
});
