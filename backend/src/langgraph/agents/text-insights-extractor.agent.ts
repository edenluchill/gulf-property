/**
 * Text-Insights Extractor
 *
 * One cheap flash call over the WHOLE PDF text layer to recover
 * project-level facts that per-page vision extraction reliably misses:
 * completion/handover dates, the real developer name, dated payment
 * milestones, service charge, unit inventory & parking ratios,
 * landmark distances, amenity names.
 *
 * Everything returned here is text-evidenced by construction, so it is
 * preferred over vision output when the two disagree (anti-hallucination).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseJsonResponse } from '../utils/json-parser';
import { withRetry } from '../utils/ai-retry';
import { appearsInText } from '../utils/text-layer';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface TextInsights {
  developer?: string;
  launchDate?: string;
  completionDate?: string;
  handoverDate?: string;
  serviceCharge?: number;          // AED per sqft per year
  paymentPlan?: {
    name?: string;
    milestones: Array<{ milestone: string; percentage: number; date?: string }>;
  };
  landmarks?: Array<{ name: string; distanceKm: number }>;
  unitInventory?: Array<{
    typeName?: string;
    category?: string;             // "1BR", "2BR", "Penthouse"...
    quantity?: number;
    avgTotalArea?: number;         // sqft
    parkingSpaces?: number;        // per unit
  }>;
  amenities?: string[];
}

const MAX_TEXT_CHARS = 80_000;
const AI_TIMEOUT = 45_000;

export async function extractTextInsights(fullText: string): Promise<TextInsights | null> {
  if (!fullText || fullText.trim().length < 200) {
    console.log('   📜 [TEXT-INSIGHTS] Text layer too sparse, skipping text pass');
    return null;
  }

  const text = fullText.length > MAX_TEXT_CHARS
    ? fullText.slice(0, MAX_TEXT_CHARS) + '\n…(truncated)'
    : fullText;

  const prompt = `你是迪拜房地产楼书数据提取专家。下面是从楼书 PDF 文本层提取的全部文字（按页标注）。
只提取文本中明确写出的信息——**禁止推断或编造**。找不到的字段直接省略。

提取目标：
1. developer: 开发商名称。找 "BY XXX"、"XXX DEVELOPERS"、"A development by XXX" 等明确署名。注意区分开发商和项目名。
2. launchDate / completionDate / handoverDate: 日期。找 "COMPLETION"、"HANDOVER"、"POSSESSION"、"DELIVERY" 附近的日期（如 "APRIL 2030"、"Q4 2027"、"June 2029"）。保留原文格式。
3. serviceCharge: 服务费（AED/sqft/年），纯数字。
4. paymentPlan: 付款计划。每期 milestone 名称（如 "Down Payment"、"1st Instalment"、"On Handover"）、百分比（数字）、日期（如有，原文格式）。
5. landmarks: 地标距离表（如 "BURJ KHALIFA 19 km"）。distanceKm 为数字。
6. unitInventory: 户型库存表。每行：typeName（如有）、category（规范成 "Studio"/"1BR"/"2BR"/"2BR + Maid"/"3BR"/"4BR"/"Penthouse"/"Duplex" 等）、quantity（数量）、avgTotalArea（平均总面积 sqft，文本若是 sqm 乘以 10.764 转换）、parkingSpaces（车位配比，如 "1 per unit"→1，"2 per unit"→2）。
7. amenities: 配套设施名称列表（如 "Infinity Pool"、"Padel Tennis Court"），去重，最多 30 个。

返回 JSON（只含找到的字段）：
{"developer":"...","completionDate":"...","handoverDate":"...","launchDate":"...","serviceCharge":15,"paymentPlan":{"name":"...","milestones":[{"milestone":"Down Payment","percentage":20,"date":"On Booking"}]},"landmarks":[{"name":"Burj Khalifa","distanceKm":19}],"unitInventory":[{"category":"1BR","quantity":108,"avgTotalArea":790,"parkingSpaces":1}],"amenities":["..."]}

只返回 JSON。

===== PDF 文本层 =====
${text}`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const parsed = await withRetry<any>(
      async () => {
        const result = await Promise.race([
          model.generateContent(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT}ms`)), AI_TIMEOUT)
          ),
        ]);
        const response = await result.response;
        return parseJsonResponse(response.text());
      },
      { label: 'text-insights', attempts: 2 }
    );

    const insights: TextInsights = {
      developer: typeof parsed.developer === 'string' ? parsed.developer.trim() : undefined,
      launchDate: parsed.launchDate || undefined,
      completionDate: parsed.completionDate || undefined,
      handoverDate: parsed.handoverDate || undefined,
      serviceCharge: typeof parsed.serviceCharge === 'number' ? parsed.serviceCharge : undefined,
      paymentPlan: parsed.paymentPlan?.milestones?.length > 0 ? parsed.paymentPlan : undefined,
      landmarks: Array.isArray(parsed.landmarks)
        ? parsed.landmarks.filter((l: any) => l?.name && typeof l.distanceKm === 'number').slice(0, 20)
        : undefined,
      unitInventory: Array.isArray(parsed.unitInventory)
        ? parsed.unitInventory.filter((u: any) => u?.category || u?.typeName)
        : undefined,
      amenities: Array.isArray(parsed.amenities)
        ? parsed.amenities.filter((a: any) => typeof a === 'string' && a.length > 1).slice(0, 30)
        : undefined,
    };

    const found = Object.entries(insights)
      .filter(([, v]) => v !== undefined && (!Array.isArray(v) || v.length > 0))
      .map(([k]) => k);
    console.log(`   📜 [TEXT-INSIGHTS] Extracted from text layer: ${found.join(', ') || '(nothing)'}`);

    return insights;
  } catch (error) {
    console.warn(`   ⚠️  [TEXT-INSIGHTS] Failed: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Merge text-layer insights into the vision-extracted building data.
 * Text wins where it has evidence; vision fills the rest.
 * Mutates `data` in place; appends human-readable notes to `warnings`.
 */
export function applyTextInsights(
  data: any,
  insights: TextInsights | null,
  fullText: string,
  warnings: string[]
): void {
  if (!insights) return;

  // ---- Developer: anti-hallucination guard ----
  if (insights.developer) {
    const visionDev = data.developer || '';
    const visionVerified = visionDev && appearsInText(fullText, visionDev);
    if (!visionDev) {
      data.developer = insights.developer;
      console.log(`   📜 [TEXT-INSIGHTS] Developer filled from text: "${insights.developer}"`);
    } else if (!visionVerified) {
      warnings.push(`开发商已修正: 视觉提取的 "${visionDev}" 在 PDF 文字中找不到依据,采用文本层的 "${insights.developer}"`);
      console.log(`   📜 [TEXT-INSIGHTS] Developer corrected: "${visionDev}" (unverified) → "${insights.developer}"`);
      data.developer = insights.developer;
    }
  }

  // ---- Dates: fill blanks (text has the real ones far more often) ----
  for (const field of ['launchDate', 'completionDate', 'handoverDate'] as const) {
    if (!data[field] && insights[field]) {
      data[field] = insights[field];
      console.log(`   📜 [TEXT-INSIGHTS] ${field} filled from text: ${insights[field]}`);
    }
  }

  // ---- Service charge / landmarks: new fields, text is the only source ----
  if (insights.serviceCharge != null) data.serviceCharge = insights.serviceCharge;
  if (insights.landmarks?.length) data.landmarks = insights.landmarks;

  // ---- Payment plan: prefer the dated text version ----
  const visionMilestones = data.paymentPlans?.[0]?.milestones || [];
  const visionHasDates = visionMilestones.some((m: any) => m?.date);
  if (insights.paymentPlan?.milestones?.length &&
      (visionMilestones.length === 0 || !visionHasDates)) {
    data.paymentPlans = [{
      name: insights.paymentPlan.name || 'Payment Plan',
      milestones: insights.paymentPlan.milestones,
      source: 'text-layer',
    }];
    console.log(`   📜 [TEXT-INSIGHTS] Payment plan from text: ${insights.paymentPlan.milestones.length} dated milestones`);
  }

  // ---- Inventory: fill unitCount / parkingSpaces on matching units ----
  if (insights.unitInventory?.length && Array.isArray(data.units)) {
    const normCat = (s?: string) => (s || '').toUpperCase().replace(/[\s.+-]+/g, '');
    for (const inv of insights.unitInventory) {
      const matches = data.units.filter((u: any) => {
        if (inv.typeName && (u.typeName || u.name) &&
            (u.typeName || u.name).toUpperCase().trim() === inv.typeName.toUpperCase().trim()) {
          return true;
        }
        return inv.category && normCat(u.category) === normCat(inv.category);
      });
      for (const u of matches) {
        if (inv.quantity && !(u.unitCount > 1)) u.unitCount = Math.round(inv.quantity / matches.length) || inv.quantity;
        if (inv.parkingSpaces != null && u.parkingSpaces == null) u.parkingSpaces = inv.parkingSpaces;
      }
    }
    const withParking = data.units.filter((u: any) => u.parkingSpaces != null).length;
    console.log(`   📜 [TEXT-INSIGHTS] Inventory applied: ${withParking}/${data.units.length} units have parking info`);
  }

  // ---- Amenities: union (text catches names on photo pages vision skips) ----
  if (insights.amenities?.length) {
    const existing = new Set((data.amenities || []).map((a: string) => a.toUpperCase().trim()));
    const added = insights.amenities.filter(a => !existing.has(a.toUpperCase().trim()));
    if (added.length > 0) {
      data.amenities = [...(data.amenities || []), ...added];
      console.log(`   📜 [TEXT-INSIGHTS] Added ${added.length} amenities from text layer`);
    }
  }
}
