/**
 * Experiment: batched page classification (N images per Gemini call) vs
 * the production per-page classifier.
 *
 * Baseline = per-page classifications from a validated production run
 * (CSV "page,type" lines). Measures agreement, critical-page recall
 * (unit_anchor / pricing_table / payment_plan), latency, call count.
 *
 * Usage:
 *   cd backend && npx ts-node --transpile-only scripts/batch-classify-experiment.ts \
 *     <pdf-path> <baseline-csv> <outJson> [batchSizes=4,8,12]
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { GoogleGenerativeAI } from '@google/generative-ai';
import { pdfToImagesMupdf } from '../src/utils/pdf/converter-mupdf';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 4;
const CRITICAL = new Set(['unit_anchor', 'pricing_table', 'payment_plan']);

function batchPrompt(pageNumbers: number[]): string {
  return `你是PDF页面分类专家。你将收到 ${pageNumbers.length} 张楼书页面图片，按顺序对应页码: ${pageNumbers.join(', ')}。
对每一页独立分类。

## 页面类型
- unit_anchor ⭐最重要: 户型平面图。必须有建筑平面布局(墙壁/房间分隔) + 房间标签(Bedroom/Bathroom/Kitchen/Living/Balcony)。通常有面积标注。
- unit_rendering: 户型3D效果图(室内外渲染,无房间标签平面图)
- project_rendering: 整栋建筑/小区外观渲染、鸟瞰
- amenities_images: 泳池/健身房/大堂等公共设施照片,或 Ground Floor Plan(lobby/gym/pool标签)
- amenities_list: 配套设施文字列表
- pricing_table: 价格表(AED/Million数字列表)
- payment_plan: 付款计划(百分比+日期)
- project_cover: 封面 | project_overview: 项目介绍 | project_location_map: 区位图
- section_title / section_divider: 章节标题/分隔页
- general_text: 文字页 | back_cover: 封底 | unknown: 无法识别

## 关键区分
- unit_anchor=平面图(墙线+房间标签); unit_rendering=艺术渲染图
- 有 "Master Bedroom"/"Bathroom"/"Kitchen" 房间标签的平面图必须是 unit_anchor
- 公共区域平面图(Lobby/Gym/Pool)是 amenities_images 不是 unit_anchor

## 返回 JSON(数组长度必须等于 ${pageNumbers.length},顺序与图片一致)
{"pages":[{"pageNumber":${pageNumbers[0]},"pageType":"...","confidence":0.95,"unitTypeName":"Type A或null","unitCategory":"1BR或null"}]}
只返回JSON。`;
}

interface PageResult { pageNumber: number; pageType: string; confidence?: number; unitTypeName?: string; unitCategory?: string }

async function classifyBatch(imagePaths: string[], pageNumbers: number[]): Promise<{ results: PageResult[]; ms: number }> {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const parts: any[] = [batchPrompt(pageNumbers)];
  for (const p of imagePaths) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(p).toString('base64') } });
  }
  const t0 = Date.now();
  const result = await Promise.race([
    model.generateContent(parts),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 60s')), 60000)),
  ]);
  const text = (await result.response).text();
  const ms = Date.now() - t0;
  const parsed = JSON.parse(text);
  const arr: any[] = parsed.pages || parsed;
  return { results: arr, ms };
}

async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      out[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

async function main() {
  const [pdfPath, baselineCsv, outJson, sizesArg] = process.argv.slice(2);
  if (!pdfPath || !baselineCsv || !outJson) {
    console.error('Usage: batch-classify-experiment.ts <pdf> <baseline-csv> <outJson> [sizes]');
    process.exit(1);
  }
  const batchSizes = (sizesArg || '4,8,12').split(',').map(Number);

  // Baseline: page -> type
  const baseline = new Map<number, string>();
  for (const line of fs.readFileSync(baselineCsv, 'utf-8').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+),(\S+)$/);
    if (m) baseline.set(parseInt(m[1], 10), m[2]);
  }
  console.log(`Baseline: ${baseline.size} pages from ${path.basename(baselineCsv)}`);

  // Render pages once
  const imgDir = path.join(os.tmpdir(), `batch-exp-${path.basename(pdfPath, '.pdf').replace(/\W+/g, '-')}`);
  const listRendered = () => fs.existsSync(imgDir)
    ? fs.readdirSync(imgDir)
        .filter(f => /\.(jpe?g|png)$/i.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
        .map(f => path.join(imgDir, f))
    : [];
  let imagePaths = listRendered();
  if (imagePaths.length >= baseline.size) {
    console.log(`Reusing ${imagePaths.length} rendered pages in ${imgDir}`);
  } else {
    console.log(`Rendering pages to ${imgDir} ...`);
    imagePaths = await pdfToImagesMupdf(fs.readFileSync(pdfPath), imgDir, { dpi: 100, format: 'jpeg', quality: 70 });
  }

  const report: any = { pdf: path.basename(pdfPath), model: MODEL, pages: imagePaths.length, runs: [] };

  for (const size of batchSizes) {
    console.log(`\n${'='.repeat(60)}\n🧪 Batch size ${size}`);
    const batches: { paths: string[]; nums: number[] }[] = [];
    for (let s = 0; s < imagePaths.length; s += size) {
      const paths = imagePaths.slice(s, s + size);
      batches.push({ paths, nums: paths.map((_, j) => s + j + 1) });
    }

    const t0 = Date.now();
    const settled = await runPool(
      batches.map(b => async () => {
        try {
          return await classifyBatch(b.paths, b.nums);
        } catch (e) {
          console.warn(`   ✗ batch [${b.nums[0]}-${b.nums[b.nums.length - 1]}] failed: ${(e as Error).message}`);
          return { results: [] as PageResult[], ms: 0, failed: b.nums } as any;
        }
      }),
      CONCURRENCY
    );
    const wallMs = Date.now() - t0;

    const got = new Map<number, PageResult>();
    let failedPages = 0;
    const latencies: number[] = [];
    for (const s of settled) {
      if ((s as any).failed) { failedPages += (s as any).failed.length; continue; }
      latencies.push(s.ms);
      for (const r of s.results) got.set(Number(r.pageNumber), r);
    }

    // Compare
    let agree = 0, total = 0;
    const disagreements: any[] = [];
    const critStats: Record<string, { tp: number; fn: number; fp: number }> = {};
    for (const c of CRITICAL) critStats[c] = { tp: 0, fn: 0, fp: 0 };

    for (const [page, baseType] of baseline) {
      const r = got.get(page);
      const gotType = r?.pageType || 'MISSING';
      total++;
      if (gotType === baseType) agree++;
      else disagreements.push({ page, baseline: baseType, batch: gotType });
      for (const c of CRITICAL) {
        if (baseType === c && gotType === c) critStats[c].tp++;
        else if (baseType === c && gotType !== c) critStats[c].fn++;
        else if (baseType !== c && gotType === c) critStats[c].fp++;
      }
    }

    const run = {
      batchSize: size,
      calls: batches.length,
      wallSec: +(wallMs / 1000).toFixed(1),
      avgCallSec: latencies.length ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1) : null,
      failedPages,
      agreement: `${agree}/${total} (${(100 * agree / total).toFixed(1)}%)`,
      critical: critStats,
      disagreements,
    };
    report.runs.push(run);
    console.log(`   calls=${run.calls} wall=${run.wallSec}s avgCall=${run.avgCallSec}s agree=${run.agreement} failed=${failedPages}`);
    for (const c of CRITICAL) {
      const s = critStats[c];
      console.log(`   ${c}: tp=${s.tp} fn=${s.fn} fp=${s.fp}`);
    }
    if (disagreements.length) {
      console.log(`   disagreements: ${disagreements.map(d => `p${d.page} ${d.baseline}→${d.batch}`).join(', ')}`);
    }
  }

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 Report: ${outJson}`);
}

main().catch(err => { console.error(err); process.exit(1); });
