/**
 * Submit readiness check — single source of truth shared by the analysis
 * report (result-recorder) and the API result (buildingData.submitReadiness),
 * mirroring the filter rules in POST /api/residential-projects/submit
 * (units with area<=0 are dropped there).
 */

export interface UnitReadiness {
  name: string;
  category?: string;
  blockers: string[];   // would be FILTERED at submission
  warnings: string[];   // submittable but incomplete
}

export interface SubmitReadiness {
  submittable: boolean;
  missingProjectFields: string[];
  unitsCount: number;
  blockedUnits: UnitReadiness[];
  warningUnits: UnitReadiness[];
  message?: string;     // actionable guidance when not submittable
  /**
   * 有价格的户型数。**0 = 整个项目一个价格都没有** —— 这不是"某个户型不完整",
   * 是一个项目级的洞,要单独喊出来(见 priceWarning)。
   */
  unitsWithPrice: number;
  /**
   * 🔴 「一个价格都没有」的专门提醒。
   *
   * 2026-07-13 质量遥测挖出来的真问题:19 个 job 抽出 12/13/31/47 个户型,
   * **价格 0 个**。而客户在 Luna 对话里问「What's the starting price for?」,
   * **问了两遍**(她答不上来)。
   *
   * 追到源 PDF(永久归档)实测确认:**不是抽取器的 bug** —— 迪拜楼书本来就不印价格
   * (Binghatti Wraith 的 44 页 brochure + 户型图,一个价格都没有;payment plan
   * 也只有分期比例,没有绝对价格)。价格是**单独一张 price list**,经纪按需给。
   *
   * 所以修法不是改抽取器,是**在这里告诉经纪:客户会问价格,你得补传价格表**。
   * 之前「缺少价格」只是每个户型下面一个小 warning,31 个户型全缺时,
   * 经纪根本意识不到这是个项目级的洞。
   */
  priceWarning?: string;
}

export function computeSubmitReadiness(data: any): SubmitReadiness {
  // area is intentionally NOT required — it's a manually-curated map layer;
  // coordinates outside every polygon legitimately leave it empty
  const missingProjectFields = (['name', 'developer', 'address'] as const)
    .filter(f => !data?.[f]);

  const units: any[] = data?.units || [];
  const blockedUnits: UnitReadiness[] = [];
  const warningUnits: UnitReadiness[] = [];

  for (const u of units) {
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!(u.area > 0)) blockers.push('缺少面积(area)');
    if (u.bedrooms == null) blockers.push('缺少卧室数(bedrooms)');
    if (!(u.bathrooms > 0)) warnings.push('缺少卫生间数');
    if (!u.price) warnings.push('缺少价格');
    if (!u.floorPlanImage && (!u.floorPlanImages || u.floorPlanImages.length === 0)) {
      warnings.push('没有户型图');
    }
    const entry: UnitReadiness = {
      name: u.typeName || u.name || 'Unknown',
      category: u.category,
      blockers,
      warnings,
    };
    if (blockers.length > 0) blockedUnits.push(entry);
    else if (warnings.length > 0) warningUnits.push(entry);
  }

  const submittable = missingProjectFields.length === 0
    && units.length > 0
    && blockedUnits.length === 0;

  let message: string | undefined;
  if (units.length === 0) {
    message = '没有提取到任何户型。这本资料可能是纯营销画册(只有效果图,没有平面图/价格页)。'
      + '请补充包含户型平面图或价格表的文件(如 fact sheet、户型手册)一起上传处理。';
  } else if (blockedUnits.length > 0) {
    message = `${blockedUnits.length} 个户型信息不完整,提交时会被过滤。请在下方补全面积/卧室数后再提交。`;
  } else if (missingProjectFields.length > 0) {
    message = `项目缺少必填字段: ${missingProjectFields.join(', ')}。请补全后提交。`;
  }

  // 🔴 一个价格都没有 —— 项目级的洞,单独喊(不是 31 个小 warning)
  const unitsWithPrice = units.filter((u) => Number(u?.price) > 0).length;
  let priceWarning: string | undefined;
  if (units.length > 0 && unitsWithPrice === 0) {
    priceWarning =
      `这 ${units.length} 个户型**一个价格都没有** —— 这份楼书里本来就不印价格(迪拜楼书的常态,` +
      `价格通常是单独一张 price list)。\n` +
      `⚠️ 客户一定会问价格。没有价格,Luna 答不上来、报价单也生成不了。\n` +
      `👉 请把**价格表 / payment plan(带金额的那种)**也一起传上来,重新处理即可。`;
  } else if (units.length > 0 && unitsWithPrice < units.length / 2) {
    priceWarning =
      `只有 ${unitsWithPrice}/${units.length} 个户型有价格。缺价格的户型,客户问起来会答不上来 —— ` +
      `建议补传完整的价格表。`;
  }

  return {
    submittable, missingProjectFields, unitsCount: units.length,
    blockedUnits, warningUnits, message,
    unitsWithPrice, priceWarning,
  };
}
