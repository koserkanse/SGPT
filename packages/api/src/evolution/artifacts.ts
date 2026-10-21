import { z } from 'zod';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import type { EvolutionConfig, EvolutionArtifact, EvolutionCheck } from 'librechat-data-provider';
import { EvolutionError } from './http';

const exec = promisify(execFile);
export function presentationBounds(html: string): { inBounds: boolean; noOverlap: boolean } {
  const pages = [...html.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
  let inBounds = pages.length > 0;
  let noOverlap = pages.length > 0;
  for (const page of pages) {
    const boxes = (tag: string) =>
      [
        ...page[3].matchAll(
          new RegExp(
            `<${tag} xMin="([\\d.-]+)" yMin="([\\d.-]+)" xMax="([\\d.-]+)" yMax="([\\d.-]+)">`,
            'g',
          ),
        ),
      ].map((match) => match.slice(1, 5).map(Number));
    const words = boxes('word');
    inBounds &&=
      words.length > 0 &&
      words.every(
        ([x1, y1, x2, y2]) => x1 >= 0 && y1 >= 0 && x2 <= Number(page[1]) && y2 <= Number(page[2]),
      );
    const blocks = boxes('block');
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i],
          b = blocks[j];
        if (
          Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 &&
          Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1
        )
          noOverlap = false;
      }
  }
  return { inBounds, noOverlap };
}
export const deckSchema = z
  .object({
    title: z.string().min(1).max(100),
    slides: z
      .array(
        z
          .object({
            title: z.string().min(1).max(80),
            bullets: z.array(z.string().min(1).max(180)).min(1).max(5),
            source: z.string().min(1).max(150),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
const formulaSchema = z.object({ formula: z.string().min(1).max(200) }).strict();
export const workbookSchema = z
  .object({
    sheet: z.string().regex(/^[A-Za-z][\w -]{0,29}$/),
    currency: z.string().max(10),
    period: z.string().max(30),
    source: z.string().max(150),
    cells: z
      .array(
        z
          .object({
            ref: z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,2}$/),
            value: z.union([z.number().finite(), z.string().max(250), formulaSchema]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type Deck = z.infer<typeof deckSchema>;
export type FinancialWorkbook = z.infer<typeof workbookSchema>;
const artifact = (name: string, mime: string, data: Buffer): EvolutionArtifact => ({
  id: randomUUID(),
  name,
  mime,
  data: data.toString('base64'),
  createdAt: new Date().toISOString(),
});

/** Arithmetic-only formula evaluation: no code, external functions or external references. */
export function calculateWorkbook(input: FinancialWorkbook): Record<string, number | string> {
  const raw = new Map(input.cells.map((cell) => [cell.ref, cell.value]));
  if (raw.size !== input.cells.length) throw new EvolutionError('DUPLICATE_CELL');
  const values: Record<string, number | string> = {};
  const visiting = new Set<string>();
  const cell = (ref: string): number | string => {
    if (ref in values) return values[ref];
    if (visiting.has(ref)) throw new EvolutionError('CYCLIC_FORMULA');
    const value = raw.get(ref);
    if (value === undefined) throw new EvolutionError('MISSING_CELL');
    if (typeof value !== 'object') return (values[ref] = value);
    visiting.add(ref);
    let expression = value.formula.replace(/^=/, '').replace(/\s/g, '');
    if (expression.length > 200 || /[^A-Z0-9.+*/()-]/.test(expression))
      throw new EvolutionError('UNSAFE_FORMULA');
    if (/[A-Z]/.test(expression.replace(/[A-Z]{1,2}[1-9]\d{0,2}/g, '')))
      throw new EvolutionError('UNSAFE_FORMULA');
    expression = expression.replace(/[A-Z]{1,2}[1-9]\d{0,2}/g, (reference) => {
      const result = cell(reference);
      if (typeof result !== 'number') throw new EvolutionError('NON_NUMERIC_REFERENCE');
      return `(${result})`;
    });
    if (/[A-Z]/.test(expression)) throw new EvolutionError('UNSAFE_FORMULA');
    const tokens = expression.match(/\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
    if (tokens.join('') !== expression) throw new EvolutionError('INVALID_FORMULA');
    let cursor = 0;
    const atom = (): number => {
      const token = tokens[cursor++];
      if (token === '-') return -atom();
      if (token === '+') return atom();
      if (token === '(') {
        const n = sum();
        if (tokens[cursor++] !== ')') throw new EvolutionError('INVALID_FORMULA');
        return n;
      }
      if (!token || !/^\d/.test(token)) throw new EvolutionError('INVALID_FORMULA');
      return Number(token);
    };
    const product = (): number => {
      let n = atom();
      while (tokens[cursor] === '*' || tokens[cursor] === '/') {
        const op = tokens[cursor++];
        const rhs = atom();
        n = op === '*' ? n * rhs : n / rhs;
      }
      return n;
    };
    const sum = (): number => {
      let n = product();
      while (tokens[cursor] === '+' || tokens[cursor] === '-') {
        const op = tokens[cursor++];
        const rhs = product();
        n = op === '+' ? n + rhs : n - rhs;
      }
      return n;
    };
    const result = sum();
    if (cursor !== tokens.length || !Number.isFinite(result))
      throw new EvolutionError('INVALID_FORMULA');
    visiting.delete(ref);
    return (values[ref] = result);
  };
  for (const ref of raw.keys()) cell(ref);
  return values;
}

async function render(
  config: EvolutionConfig,
  dir: string,
  input: string,
  format: string,
  signal: AbortSignal,
): Promise<string> {
  if (!config.libreOfficePath) throw new EvolutionError('RENDERER_REQUIRED');
  const out = join(dir, 'rendered');
  await mkdir(out, { recursive: true });
  // Headless conversion can preserve XLSX caches. Force recomputation
  // in this disposable profile, without changing the owner's desktop settings.
  const profile = join(dir, 'profile', 'user');
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, 'registrymodifications.xcu'),
    '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>',
  );
  try {
    await exec(
      config.libreOfficePath,
      [
        `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
        '--headless',
        '--convert-to',
        format,
        '--outdir',
        out,
        input,
      ],
      { signal, timeout: config.requestTimeoutMs, maxBuffer: 20000 },
    );
  } catch {
    signal.throwIfAborted();
    throw new EvolutionError('RENDER_FAILED');
  }
  return out;
}

export async function presentationEvidence(
  value: unknown,
  config: EvolutionConfig,
  signal: AbortSignal,
): Promise<{ artifacts: EvolutionArtifact[]; checks: EvolutionCheck[] }> {
  const deck = deckSchema.parse(value);
  const dir = await mkdtemp(join(tmpdir(), 'sgpt-slides-'));
  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = deck.title;
    pptx.author = 'SGPT';
    for (const item of deck.slides) {
      const slide = pptx.addSlide();
      slide.addText(item.title, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.8,
        fontSize: 30,
        fontFace: 'Arial',
        bold: true,
        margin: 0,
      });
      item.bullets.forEach((text, index) =>
        slide.addText(text, {
          x: 0.7,
          y: 1.6 + index * 0.85,
          w: 11.9,
          h: 0.75,
          fontSize: 20,
          fontFace: 'Arial',
          margin: 0,
          breakLine: false,
        }),
      );
      slide.addText(item.source, {
        x: 0.7,
        y: 6.8,
        w: 11.9,
        h: 0.3,
        fontSize: 10,
        fontFace: 'Arial',
        margin: 0,
      });
    }
    const output = await pptx.write({ outputType: 'nodebuffer' });
    if (!(output instanceof Uint8Array)) throw new EvolutionError('INVALID_ARTIFACT');
    const data = Buffer.from(output);
    const archive = await JSZip.loadAsync(data);
    const editable =
      (await archive.file('ppt/slides/slide1.xml')?.async('string'))?.includes('<a:t>') ?? false;
    const path = join(dir, 'presentation.pptx');
    await writeFile(path, data);
    const out = await render(config, dir, path, 'pdf', signal);
    const pdf = await readFile(join(out, 'presentation.pdf'));
    if (!config.pdfTextPath) throw new EvolutionError('PDF_TOOLS_REQUIRED');
    try {
      await exec(
        config.pdfTextPath,
        ['-layout', join(out, 'presentation.pdf'), join(out, 'text.txt')],
        { signal, timeout: config.requestTimeoutMs, maxBuffer: 20000 },
      );
    } catch {
      signal.throwIfAborted();
      throw new EvolutionError('RENDER_FAILED');
    }
    const rawText = await readFile(join(out, 'text.txt'), 'utf8');
    try {
      await exec(
        config.pdfTextPath,
        ['-bbox-layout', join(out, 'presentation.pdf'), join(out, 'bounds.html')],
        { signal, timeout: config.requestTimeoutMs, maxBuffer: 20000 },
      );
    } catch {
      signal.throwIfAborted();
      throw new EvolutionError('RENDER_FAILED');
    }
    const bounds = presentationBounds(await readFile(join(out, 'bounds.html'), 'utf8'));
    const text = rawText.normalize('NFKC').replace(/\s+/g, ' ');
    const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ');
    const checks = [
      { id: 'editable_pptx', passed: editable },
      { id: 'pdf_export', passed: pdf.subarray(0, 5).toString() === '%PDF-' },
      { id: 'rendered_text_bounds', passed: bounds.inBounds },
      { id: 'rendered_block_overlap', passed: bounds.noOverlap },
      {
        id: 'rendered_text_preserved',
        passed: deck.slides.every((slide) =>
          [slide.title, ...slide.bullets, slide.source].every((part) =>
            text.includes(normalize(part)),
          ),
        ),
      },
      {
        id: 'slide_count',
        passed: rawText.split('\f').filter((part) => part.trim()).length === deck.slides.length,
      },
    ];
    const artifacts = [
      artifact(
        'presentation.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        data,
      ),
      artifact('presentation.pdf', 'application/pdf', pdf),
    ];
    if (config.pdfImagePath) {
      try {
        await exec(
          config.pdfImagePath,
          [
            '-png',
            '-singlefile',
            '-f',
            '1',
            '-scale-to',
            '1200',
            join(out, 'presentation.pdf'),
            join(out, 'preview'),
          ],
          { signal, timeout: config.requestTimeoutMs, maxBuffer: 20000 },
        );
      } catch {
        signal.throwIfAborted();
        throw new EvolutionError('RENDER_FAILED');
      }
      artifacts.push(
        artifact('presentation.png', 'image/png', await readFile(join(out, 'preview.png'))),
      );
    }
    return { artifacts, checks };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function financialEvidence(
  value: unknown,
  config: EvolutionConfig,
  signal: AbortSignal,
): Promise<{
  artifacts: EvolutionArtifact[];
  checks: EvolutionCheck[];
  values: Record<string, number | string>;
}> {
  const model = workbookSchema.parse(value);
  const values = calculateWorkbook(model);
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet(model.sheet);
  sheet.getCell('D1').value = model.currency;
  sheet.getCell('D2').value = model.period;
  sheet.getCell('D3').value = model.source;
  for (const cell of model.cells) {
    if (/^D[123]$/.test(cell.ref)) throw new EvolutionError('RESERVED_CELL');
    const value = cell.value;
    sheet.getCell(cell.ref).value =
      typeof value === 'object'
        ? // Force the independent renderer to recompute instead of trusting our cached answer.
          { formula: value.formula.replace(/^=/, ''), result: 0 }
        : value;
  }
  sheet.columns.forEach((col) => {
    col.width = 24;
  });
  const dir = await mkdtemp(join(tmpdir(), 'sgpt-finance-'));
  try {
    const input = join(dir, 'finance.xlsx');
    await workbook.xlsx.writeFile(input);
    const out = await render(config, dir, input, 'xlsx', signal);
    const data = await readFile(join(out, 'finance.xlsx'));
    const recalculated = new ExcelJS.Workbook();
    await recalculated.xlsx.load(new Uint8Array(data).buffer);
    const restored = recalculated.getWorksheet(model.sheet);
    const formulaCells = model.cells.filter((cell) => typeof cell.value === 'object');
    const checks = [
      { id: 'editable_xlsx', passed: !!restored },
      {
        id: 'formulas_retained',
        passed:
          formulaCells.length > 0 &&
          formulaCells.every((cell) => !!restored?.getCell(cell.ref).formula),
      },
      {
        id: 'independent_recalculation',
        passed: formulaCells.every(
          (cell) =>
            typeof restored?.getCell(cell.ref).result === 'number' &&
            Math.abs(Number(restored.getCell(cell.ref).result) - Number(values[cell.ref])) <
              0.00001,
        ),
      },
    ];
    return {
      artifacts: [
        artifact(
          'finance.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data,
        ),
      ],
      checks,
      values,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
