import type { EvolutionTopic } from 'librechat-data-provider';

export const topicQueries: Record<EvolutionTopic, string> = {
  presentations: '"SKILL.md" presentation in:readme',
  finance: '"SKILL.md" finance in:readme',
  'generative-ui': '"SKILL.md" generative-ui in:readme',
  agents: '"SKILL.md" agents in:readme',
  mcp: '"SKILL.md" mcp in:readme',
  memory: '"SKILL.md" memory in:readme',
  documents: '"SKILL.md" documents in:readme',
  'sales-crm': '"SKILL.md" crm in:readme',
};
export const topicHints: Record<EvolutionTopic, RegExp> = {
  presentations: /pptx|slides?|presentation/i,
  finance: /financ|xlsx|spreadsheet|cash.flow|accounting/i,
  'generative-ui': /generative|frontend|ag.ui|copilotkit/i,
  agents: /agent|orchestrat/i,
  mcp: /mcp|model.context/i,
  memory: /memory|retriev|knowledge/i,
  documents: /document|pdf|docx|ocr/i,
  'sales-crm': /sales|crm|lead|customer/i,
};
export const pluginQueries: Record<EvolutionTopic, string> = {
  presentations: 'pptx',
  finance: 'financial modeling',
  'generative-ui': 'generative ui',
  agents: 'agent runtime',
  mcp: 'mcp server',
  memory: 'agent memory',
  documents: 'document parser',
  'sales-crm': 'crm mcp',
};
export const retainedMethod: Record<EvolutionTopic, string> = {
  presentations:
    'Keep slide content editable, preserve supplied numbers and source labels, and check every text box against slide bounds before delivering a presentation.',
  finance:
    'Keep currency and period labels, use cell-reference formulas for derived values, reconcile statements, and recalculate before delivering a workbook.',
  'generative-ui':
    'Preserve accessible labels and render untrusted values as text; cover loading, empty and failure states.',
  agents:
    'Retry only idempotent operations; propagate cancellation and preserve owner/tenant scope across task boundaries.',
  mcp: 'Check tool schemas and scopes, distinguish disconnects from empty results, and deduplicate write retries.',
  memory:
    'Retrieve with provenance, apply the latest correction, isolate owners and tenants, and honor deletion.',
  documents:
    'Preserve Turkish characters, reading order, tables and source page references; fail explicitly on damaged input.',
  'sales-crm':
    'Deduplicate by stable identity, preserve source attribution and respect the configured authorization for writes and communications.',
};
