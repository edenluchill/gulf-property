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
}

export function computeSubmitReadiness(data: any): SubmitReadiness {
  const missingProjectFields = (['name', 'developer', 'address', 'area'] as const)
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

  return { submittable, missingProjectFields, unitsCount: units.length, blockedUnits, warningUnits, message };
}
