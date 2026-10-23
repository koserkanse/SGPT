// The pinned CopilotKit serializer requires the root Zod 3 entry point.
import { z } from 'zod';

export const tableSchema = z.object({
  title: z.string().max(160),
  columns: z.array(z.string().max(80)).min(1).max(12),
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(100),
});
export const choiceSchema = z.object({
  title: z.string().max(160),
  options: z.array(z.string().max(200)).min(2).max(8),
});
export const reviewSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(20000),
  spaceId: z.string().min(1),
});
export const actionSchema = z.object({
  approvalId: z.string().min(1).max(64),
  summary: z.string().trim().min(1).max(500),
});
