/**
 * 户型名称匹配器
 *
 * 处理户型名称的各种变体，实现智能匹配
 *
 * 变体示例：
 * - "B-1B-B.2" vs "B1B-B2" vs "B1BB2"
 * - "Type A" vs "TYPE-A" vs "TypeA"
 * - "1 Bedroom" vs "1BR" vs "1-Bed"
 */

import { PricingEntry } from '../agents/pricing-extractor.agent';

/**
 * 价格查找结果
 */
export interface PriceLookupResult {
  price: number;
  pricePerSqft?: number;
  matchType: 'exact' | 'normalized' | 'building_category' | 'category_only';
  matchedEntry: PricingEntry;
  confidence: number;
}

/**
 * 从价格条目中查找匹配的价格
 *
 * 优先级：
 * 1. 精确户型名 + Building 匹配
 * 2. 精确户型名匹配 (任意building)
 * 3. 规范化户型名匹配
 * 4. Building + 分类匹配
 * 5. 仅分类匹配
 */
export function findPriceForUnit(
  unitTypeName: string,
  unitCategory: string | undefined,
  building: string | undefined,
  pricingEntries: PricingEntry[]
): PriceLookupResult | null {
  if (pricingEntries.length === 0) return null;

  // 1. 精确户型名 + Building 匹配
  if (building) {
    const exactWithBuilding = pricingEntries.find(e =>
      e.unitTypeName &&
      e.building &&
      normalizeUnitName(e.unitTypeName) === normalizeUnitName(unitTypeName) &&
      normalizeBuilding(e.building) === normalizeBuilding(building)
    );
    if (exactWithBuilding) {
      return {
        price: exactWithBuilding.price,
        pricePerSqft: exactWithBuilding.pricePerSqft,
        matchType: 'exact',
        matchedEntry: exactWithBuilding,
        confidence: 1.0,
      };
    }
  }

  // 2. 精确户型名匹配 (任意building)
  const exactMatch = pricingEntries.find(e =>
    e.unitTypeName &&
    normalizeUnitName(e.unitTypeName) === normalizeUnitName(unitTypeName)
  );
  if (exactMatch) {
    return {
      price: exactMatch.price,
      pricePerSqft: exactMatch.pricePerSqft,
      matchType: 'exact',
      matchedEntry: exactMatch,
      confidence: 0.95,
    };
  }

  // 2.5 归一化包含匹配：全局重建会给户型加系列前缀
  // （"BLUE HORIZON BEACH VILLA A" 应匹配价格表里的 "Beach Villa A"）
  const unitNorm = normalizeUnitName(unitTypeName);
  const containMatch = pricingEntries.find(e => {
    if (!e.unitTypeName) return false;
    const entryNorm = normalizeUnitName(e.unitTypeName);
    return entryNorm.length >= 6 && unitNorm.length >= 6 &&
      (unitNorm.includes(entryNorm) || entryNorm.includes(unitNorm));
  });
  if (containMatch) {
    return {
      price: containMatch.price,
      pricePerSqft: containMatch.pricePerSqft,
      matchType: 'normalized',
      matchedEntry: containMatch,
      confidence: 0.85,
    };
  }

  // 3. 模糊户型名匹配
  const fuzzyMatch = findFuzzyMatch(unitTypeName, pricingEntries);
  if (fuzzyMatch) {
    return {
      price: fuzzyMatch.entry.price,
      pricePerSqft: fuzzyMatch.entry.pricePerSqft,
      matchType: 'normalized',
      matchedEntry: fuzzyMatch.entry,
      confidence: fuzzyMatch.similarity * 0.9,
    };
  }

  // 4. Building + 分类匹配
  if (building && unitCategory) {
    const buildingCategoryMatch = pricingEntries.find(e =>
      e.unitCategory &&
      e.building &&
      normalizeCategory(e.unitCategory) === normalizeCategory(unitCategory) &&
      normalizeBuilding(e.building) === normalizeBuilding(building)
    );
    if (buildingCategoryMatch) {
      return {
        price: buildingCategoryMatch.price,
        pricePerSqft: buildingCategoryMatch.pricePerSqft,
        matchType: 'building_category',
        matchedEntry: buildingCategoryMatch,
        confidence: 0.8,
      };
    }
  }

  // 5. 仅分类匹配 (最后的fallback)
  if (unitCategory) {
    const normalizedTargetCategory = normalizeCategory(unitCategory);

    // First try explicit unitCategory field
    const categoryMatch = pricingEntries.find(e =>
      e.unitCategory &&
      normalizeCategory(e.unitCategory) === normalizedTargetCategory
    );
    if (categoryMatch) {
      return {
        price: categoryMatch.price,
        pricePerSqft: categoryMatch.pricePerSqft,
        matchType: 'category_only',
        matchedEntry: categoryMatch,
        confidence: 0.6,
      };
    }

    // Also try matching unitTypeName as category (AI sometimes puts category there)
    // e.g., unitTypeName: "1BR" or "1 Bedroom"
    const nameAsCategoryMatch = pricingEntries.find(e => {
      if (!e.unitTypeName) return false;
      const inferredCategory = inferCategoryFromUnitName(e.unitTypeName);
      return inferredCategory && normalizeCategory(inferredCategory) === normalizedTargetCategory;
    });
    if (nameAsCategoryMatch) {
      return {
        price: nameAsCategoryMatch.price,
        pricePerSqft: nameAsCategoryMatch.pricePerSqft,
        matchType: 'category_only',
        matchedEntry: nameAsCategoryMatch,
        confidence: 0.55,  // Slightly lower confidence
      };
    }

    // ⭐ 基底类别兜底：户型是 "2BR+Maid" 但价格表只有 "2-Bedroom" 档（或反之）
    // → 按去掉修饰词的基底匹配，置信度更低
    const targetBase = baseCategory(normalizedTargetCategory);
    const baseMatch = pricingEntries.find(e =>
      e.unitCategory && baseCategory(normalizeCategory(e.unitCategory)) === targetBase
    );
    if (baseMatch) {
      return {
        price: baseMatch.price,
        pricePerSqft: baseMatch.pricePerSqft,
        matchType: 'category_only',
        matchedEntry: baseMatch,
        confidence: 0.5,
      };
    }
  }

  return null;
}

/**
 * 规范化户型名称
 * "B-1B-B.2" → "b1bb2"
 * "Type A-1" → "typea1"
 */
export function normalizeUnitName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')  // 只保留字母数字
    .trim();
}

/**
 * 规范化 Building 名称
 * "Crestlane 4" → "crestlane4"
 * "Tower A" → "towera"
 */
export function normalizeBuilding(building: string): string {
  if (!building) return '';
  return building
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * 规范化分类名称
 * "1 Bedroom" → "1br"
 * "Two Bed" → "2br"
 */
export function normalizeCategory(category: string): string {
  if (!category) return '';

  const lower = category.toLowerCase().trim();

  // 数字映射
  const wordToNum: Record<string, string> = {
    'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
    'studio': 'studio', 'penthouse': 'penthouse', 'duplex': 'duplex',
  };

  let normalized = lower;

  // 替换英文数字
  for (const [word, num] of Object.entries(wordToNum)) {
    normalized = normalized.replace(new RegExp(word, 'g'), num);
  }

  // 提取卧室数
  const bedroomMatch = normalized.match(/(\d+)\s*(?:bed|br|bedroom)/);
  if (bedroomMatch) {
    // ⭐ 保留修饰词，避免 "2-Bedroom"(4.26M) 和 "2-Bedroom With Maid"(5.22M) 折叠成同一档
    let suffix = '';
    if (/maid/.test(normalized)) suffix += '+maid';
    if (/large/.test(normalized)) suffix += '+large';
    if (/study/.test(normalized)) suffix += '+study';
    if (/duplex/.test(normalized)) suffix += '+duplex';
    return `${bedroomMatch[1]}br${suffix}`;
  }

  // 特殊类型
  if (normalized.includes('studio')) return 'studio';
  if (normalized.includes('penthouse') || normalized.includes('ph')) return 'penthouse';
  if (normalized.includes('duplex')) return 'duplex';
  if (normalized.includes('townhouse')) return 'townhouse';

  return normalized.replace(/[^a-z0-9]/g, '');
}

/**
 * 类别基底（去掉修饰词）："2br+maid" → "2br"
 */
export function baseCategory(normalizedCategory: string): string {
  return normalizedCategory.split('+')[0];
}

/**
 * 模糊匹配户型名称
 * 使用 Levenshtein 距离
 */
function findFuzzyMatch(
  targetName: string,
  entries: PricingEntry[]
): { entry: PricingEntry; similarity: number } | null {
  const normalizedTarget = normalizeUnitName(targetName);
  if (!normalizedTarget) return null;

  let bestMatch: { entry: PricingEntry; similarity: number } | null = null;

  for (const entry of entries) {
    if (!entry.unitTypeName) continue;

    const normalizedEntry = normalizeUnitName(entry.unitTypeName);
    const similarity = calculateSimilarity(normalizedTarget, normalizedEntry);

    // 要求至少 70% 相似度
    if (similarity >= 0.7) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { entry, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * 计算两个字符串的相似度 (0-1)
 * 使用 Levenshtein 距离
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);

  return 1 - distance / maxLen;
}

/**
 * Levenshtein 距离算法
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // 创建距离矩阵
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // 初始化
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // 删除
          dp[i][j - 1],     // 插入
          dp[i - 1][j - 1]  // 替换
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * 从户型名称推断分类
 * "B-1B-B.2" → "1BR"
 * "C-3BM-A.1" → "3BR"
 * "1-BEDROOM TYPE A" → "1BR"
 * "2-BEDROOM + MAID TYPE A" → "2BR"
 */
export function inferCategoryFromUnitName(unitTypeName: string): string | undefined {
  if (!unitTypeName) return undefined;

  const name = unitTypeName.toUpperCase();

  // 模式: "1-BEDROOM", "2-BEDROOM", "3-BEDROOM" (常见格式)
  const bedroomWordMatch = name.match(/(\d+)[-\s]?BEDROOM/);
  if (bedroomWordMatch) {
    // ⭐ 保留 Maid 修饰（"2-BEDROOM + MAID" 是独立价格档）
    if (name.includes('MAID')) {
      return `${bedroomWordMatch[1]}BR+Maid`;
    }
    return `${bedroomWordMatch[1]}BR`;
  }

  // 模式: X-1B-X, X-2B-X, X-3BM-X (编码格式)
  const bedroomCodeMatch = name.match(/(\d+)B[A-Z]?[M]?[-\.]/);
  if (bedroomCodeMatch) {
    return `${bedroomCodeMatch[1]}BR`;
  }

  // 模式: "1BR", "2BR", "3BR" (直接分类)
  const brMatch = name.match(/(\d+)\s*BR/);
  if (brMatch) {
    return `${brMatch[1]}BR`;
  }

  // 模式: Studio, ST
  if (name.includes('STUDIO') || (name.includes('ST') && !name.includes('TYPE'))) {
    return 'Studio';
  }

  // 模式: PH, Penthouse
  if (name.includes('PH') || name.includes('PENTHOUSE')) {
    return 'Penthouse';
  }

  // 模式: Duplex
  if (name.includes('DUPLEX')) {
    return 'Duplex';
  }

  return undefined;
}

/**
 * 提取 Building 信息从户型名称
 * 有些户型名包含 building 信息
 * "Tower-A-1BR" → "Tower A"
 */
export function inferBuildingFromUnitName(unitTypeName: string): string | undefined {
  if (!unitTypeName) return undefined;

  // 模式: Tower-X, Tower X
  const towerMatch = unitTypeName.match(/tower[- ]?([a-z0-9]+)/i);
  if (towerMatch) {
    return `Tower ${towerMatch[1].toUpperCase()}`;
  }

  // 模式: Building-X
  const buildingMatch = unitTypeName.match(/building[- ]?([a-z0-9]+)/i);
  if (buildingMatch) {
    return `Building ${buildingMatch[1].toUpperCase()}`;
  }

  return undefined;
}
