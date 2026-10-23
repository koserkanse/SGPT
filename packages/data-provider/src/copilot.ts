import { z } from 'zod';
import { evolutionConfigSchema } from './evolution';

export const copilotConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    allowedUserIds: z.array(z.string().min(1)).default([]),
    model: z.string().min(1).default('openai/gpt-4.1-mini'),
    /** Trusted deployment URL for an OpenAI-compatible server; supports env references. */
    baseUrl: z.string().min(1).max(2048).optional(),
    apiKey: z.string().optional(),
    apiKeyPreview: z.string().optional(),
    maxSteps: z.number().int().min(1).max(20).default(1),
    maxOutputTokens: z.number().int().min(128).max(32768).optional(),
    generativeUI: z.boolean().default(true),
    requestsPerMinute: z.number().int().min(1).max(300).default(20),
    timeoutMs: z.number().int().min(1000).max(300000).default(120000),
    maxThreads: z.number().int().min(1).max(10000).default(100),
    maxRunsPerThread: z.number().int().min(1).max(100).default(20),
    maxHistoryBytes: z.number().int().min(1000000).max(1000000000).default(20000000),
    evolution: evolutionConfigSchema.optional(),
    openDots: z
      .object({
        url: z.string().url(),
        ownerUserId: z.string().min(1),
        token: z.string().min(1),
        tokenPreview: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type CopilotConfig = z.infer<typeof copilotConfigSchema>;
export type CopilotStatus = {
  enabled: boolean;
  ready: boolean;
  generativeUI: boolean;
  openDots: boolean;
  evolution?: boolean;
  threadPrefix: string;
};
export type DotWorkspace = {
  spaces: { id: string; name: string; description: string }[];
  dots: { id: string; name: string; instructions: string; spaceId: string }[];
  conversations: { id: string; dotId: string; title: string }[];
  setup: { missing: string[] };
};
export type DotConversation = DotWorkspace['conversations'][number];

export type DotDraft = { title: string; content: string; spaceId: string };
export type DotReview = {
  id?: string;
  pageId?: string;
  spaceId: string;
  deleted?: boolean;
  reviewDraft: DotDraft | null;
};
export type DotApproval = {
  id: string;
  connection: string;
  title: string;
  description: string;
  arguments: Record<string, unknown>;
  expiresAt: number;
};
export type DotActionResult = { isError: boolean; text: string };
export type DotActionReceipt = {
  approvalId: string | null;
  status: 'running' | 'done';
  result: DotActionResult | null;
};
