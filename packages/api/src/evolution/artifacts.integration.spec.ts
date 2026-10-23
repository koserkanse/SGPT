import mongoose from 'mongoose';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createEvolutionStore } from '@librechat/data-schemas';
import { evolutionConfigSchema, copilotConfigSchema } from 'librechat-data-provider';
import type { EvolutionSource, EvolutionTopic } from 'librechat-data-provider';
import { financialEvidence, presentationEvidence } from './artifacts';
import { createEvolutionService } from './service';
import { createEvaluator } from './evaluate';

const office = process.env.SGPT_TEST_OFFICE_PATH;
const text = process.env.SGPT_TEST_PDF_TEXT_PATH;
const image = process.env.SGPT_TEST_PDF_IMAGE_PATH;
const artifactSuite = office && text ? describe : describe.skip;
artifactSuite('real editable artifact verification', () => {
  const config = evolutionConfigSchema.parse({
    ownerUserId: 'fixture',
    libreOfficePath: office,
    pdfTextPath: text,
    pdfImagePath: image,
  });
  const save = async (artifacts: { name: string; data: string }[]) => {
    if (!process.env.SGPT_TEST_EVIDENCE_DIR) return;
    await mkdir(process.env.SGPT_TEST_EVIDENCE_DIR, { recursive: true });
    for (const artifact of artifacts)
      await writeFile(
        join(process.env.SGPT_TEST_EVIDENCE_DIR, artifact.name),
        Buffer.from(artifact.data, 'base64'),
      );
  };
  test('PPTX remains editable and its exported PDF preserves all Turkish text and slide count', async () => {
    const output = await presentationEvidence(
      {
        title: 'SGPT synthetic evaluation',
        slides: [
          {
            title: 'Gelir ve büyüme',
            bullets: ['2025 geliri 100, 2026 geliri 120.', 'Büyüme %20.'],
            source: 'fixture://sales-2026',
          },
          {
            title: 'Maliyet ve kâr',
            bullets: ['2026 maliyeti 72.', 'Faaliyet kârı 48.'],
            source: 'fixture://sales-2026',
          },
          {
            title: 'Sonraki adım',
            bullets: ['Genişlemeden önce varsayımları gözden geçirin.'],
            source: 'fixture://sales-2026',
          },
        ],
      },
      config,
      AbortSignal.timeout(90000),
    );
    await save(output.artifacts);
    expect(output.checks.filter((check) => !check.passed)).toEqual([]);
    expect(output.artifacts.map((artifact) => artifact.name)).toContain('presentation.pdf');
  }, 100000);
  test('XLSX formulas survive independent LibreOffice recalculation', async () => {
    const cells = [
      { ref: 'A2', value: 'Gelir' },
      { ref: 'B2', value: 1200 },
      { ref: 'B3', value: 720 },
      { ref: 'B4', value: { formula: 'B2-B3' } },
      { ref: 'B5', value: 0.25 },
      { ref: 'B6', value: { formula: 'B4*(1-B5)' } },
      { ref: 'B7', value: 100 },
      { ref: 'B8', value: 80 },
      { ref: 'B9', value: { formula: 'B7+B6-B8' } },
      { ref: 'B10', value: 1440 },
      { ref: 'B11', value: { formula: '(B10-B3)*(1-B5)' } },
      { ref: 'B12', value: { formula: 'B7+B11-B8' } },
    ];
    const output = await financialEvidence(
      { sheet: 'Model', currency: 'TRY', period: '2026', source: 'fixture://finance-2026', cells },
      config,
      AbortSignal.timeout(90000),
    );
    expect(output.checks.every((check) => check.passed)).toBe(true);
    expect(output.values.B9).toBe(380);
    expect(output.values.B12).toBe(560);
    await save(output.artifacts);
  }, 100000);
  test('priority upgrades produce real evidence, activate automatically and retain learning', async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    const user = { id: '111111111111111111111111', role: 'ADMIN' };
    mongoose.model(
      'User',
      new mongoose.Schema({ _id: mongoose.Schema.Types.ObjectId, role: String, tenantId: String }),
    );
    await mongoose.models.User.create({ _id: user.id, role: user.role });
    const store = createEvolutionStore(mongoose);
    const source = (topic: EvolutionTopic): EvolutionSource => ({
      topic,
      repository: 'fixture/priority-skills',
      commit: 'a'.repeat(40),
      path: `${topic}/SKILL.md`,
      url: 'https://github.com/fixture/priority-skills',
      license: 'MIT',
      content: 'candidate fixture instructions',
      files: {},
      digest: topic,
      discoveredAt: new Date().toISOString(),
      kind: 'skill',
      compatible: true,
    });
    const configuration = copilotConfigSchema.parse({
      enabled: true,
      evolution: {
        ...config,
        enabled: true,
        ownerUserId: user.id,
        topics: ['presentations', 'finance'],
        apiKey: 'fixture-key',
      },
    });
    const evaluate = createEvaluator(async (_config, task, instructions) => {
      const candidate = instructions.includes('candidate fixture');
      if (task.includes('financial workbook'))
        return {
          sheet: 'Model',
          currency: 'TRY',
          period: '2026',
          source: 'fixture://finance-2026',
          cells: [
            ...['A2', 'A3', 'A4', 'A6', 'A9'].map((ref) => ({ ref, value: 'Fixture label' })),
            { ref: 'B2', value: 1200 },
            { ref: 'B3', value: 720 },
            { ref: 'B4', value: { formula: 'B2-B3' } },
            { ref: 'B5', value: 0.25 },
            { ref: 'B6', value: { formula: 'B4*(1-B5)' } },
            { ref: 'B7', value: 100 },
            { ref: 'B8', value: 80 },
            { ref: 'B9', value: { formula: candidate ? 'B7+B6-B8' : 'B7+B6+B8' } },
            { ref: 'B10', value: 1440 },
            { ref: 'B11', value: { formula: '(B10-B3)*(1-B5)' } },
            { ref: 'B12', value: { formula: 'B7+B11-B8' } },
          ],
        };
      return {
        title: 'Fixture sales review',
        slides: [
          {
            title: 'Gelir',
            bullets: [`2025: 100, 2026: ${candidate ? 120 : 119}, büyüme %20.`],
            source: 'fixture://sales-2026',
          },
          {
            title: 'Kâr',
            bullets: ['Maliyet 72, faaliyet kârı 48.'],
            source: 'fixture://sales-2026',
          },
          {
            title: 'Sonraki adım',
            bullets: ['Genişlemeden önce varsayımları gözden geçirin.'],
            source: 'fixture://sales-2026',
          },
        ],
      };
    });
    const service = createEvolutionService({
      store,
      getConfig: async () => configuration,
      research: async (topic) => [source(topic)],
      evaluate,
    });
    try {
      await service.start('manual', user);
      await service.drain();
      const status = await service.status(user);
      expect(status.state.active.presentations?.evaluation.passed).toBe(true);
      expect(status.state.active.finance?.evaluation.passed).toBe(true);
      expect(status.state.lessons.filter((lesson) => lesson.validated)).toHaveLength(2);
      const id = status.state.active.finance!.evaluation.artifactIds[0];
      const evidence = await store.getArtifact({ ownerUserId: user.id, tenantId: '' }, id);
      expect(evidence?.name).toBe('finance.xlsx');
      expect(await store.getArtifact({ ownerUserId: user.id, tenantId: 'other' }, id)).toBeNull();
    } finally {
      await service.stop();
      await mongoose.disconnect();
      await mongo.stop();
    }
  }, 100000);
});
