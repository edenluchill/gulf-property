/**
 * Batch Processor Module
 *
 * ⚡ OPTIMIZED: Uses p-limit concurrency pool instead of fixed batches
 * - Sliding window: as soon as one chunk completes, next one starts
 * - No more waiting for slowest chunk in batch
 * - Maintains max concurrency limit for API rate protection
 *
 * Features:
 * - Parallel processing with concurrency pool
 * - Progress tracking and updates
 * - Data aggregation during processing
 * - PageRegistry for incremental updates
 * - Real-time image assignment
 * - Multi-PDF support
 */

import pLimit from 'p-limit';
import type { PdfChunk } from '../../utils/pdf/chunker';
import { progressEmitter } from '../../services/progress-emitter';
import { processSingleChunk } from './chunk-processor';
import {
  mergeChunkData,
  type AggregatedBuildingData
} from './data-aggregator';
import { type ChunkAnalysisResult } from './result-recorder';
import { PageRegistry, PageRegistryManager } from '../core/page-registry';
import { AssignmentResult } from '../types/assignment-result';
import { generateProjectDescription, type ProjectSummary } from '../agents/project-description-generator.agent';
import { taskManager, TaskAbortedError, CheckpointData } from '../../services/task-manager';

export interface BatchProcessingConfig {
  chunks: Array<PdfChunk & { sourceFile: string; pdfHash: string }>;
  outputDir: string;
  jobId: string;
  batchSize?: number;  // Max concurrent chunks (p-limit pool size)
  abortSignal?: AbortSignal; // For pause/cancel support
  startFromChunk?: number; // For resume support
}

export interface BatchProcessingResult {
  aggregatedData: AggregatedBuildingData;
  allErrors: string[];
  allWarnings: string[];
  chunkAnalyses: ChunkAnalysisResult[];  // Detailed chunk analysis results
  aborted?: boolean; // Whether processing was aborted (paused/cancelled)
  processedChunks?: number; // Number of chunks processed before abort
}

/**
 * Process all chunks in parallel batches with rate limiting
 * 
 * 使用智能图片分配系统
 */
export async function processChunksInBatches(
  config: BatchProcessingConfig,
  aggregatedData: AggregatedBuildingData
): Promise<BatchProcessingResult> {
  const {
    chunks,
    outputDir,
    jobId,
    batchSize = 10,
    // batchDelay removed - not needed with p-limit concurrency pool
    abortSignal,
    startFromChunk = 0,
  } = config;

  const totalChunks = chunks.length;
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const chunkAnalyses: ChunkAnalysisResult[] = [];
  let processedChunkCount = startFromChunk;

  // ============ 智能分配系统初始化 ============
  console.log('\n🎯 Smart Image Assignment System\n');

  // 1. 获取per-job Registry（支持并发）
  const pageRegistry = PageRegistryManager.get(jobId);

  // 如果是新任务，重置Registry
  if (startFromChunk === 0) {
    pageRegistry.reset();
  }

  // 2. 设置实时更新回调（传递aggregatedData引用）
  pageRegistry.setUpdateCallback((assignmentResult: AssignmentResult) => {
    // 每次重新计算后，发送SSE更新给前端
    // 合并workflow数据（实时）
    emitSmartAssignmentUpdate(jobId, assignmentResult, aggregatedData, chunks.length, pageRegistry);
  });

  // ⚡ OPTIMIZED: Use p-limit concurrency pool instead of fixed batches
  // This creates a "sliding window" - as soon as one chunk completes, next one starts
  const concurrencyLimit = batchSize;  // Use batchSize as max concurrent chunks
  const limit = pLimit(concurrencyLimit);

  console.log(`\n🚀 Processing ${totalChunks} chunks with concurrency pool (max ${concurrencyLimit} parallel)\n`);
  if (startFromChunk > 0) {
    console.log(`▶️  Resuming from chunk ${startFromChunk}\n`);
  }
  console.log(`⚡ Sliding window mode: no waiting for slow chunks!\n`);

  // Get chunks to process (skip already processed ones)
  const chunksToProcess = chunks.slice(startFromChunk);

  // ⚡ Process all chunks through the concurrency pool
  const chunkPromises = chunksToProcess.map((chunk, localIdx) => {
    const globalIdx = startFromChunk + localIdx;

    // Use p-limit to control concurrency
    return limit(async () => {
      // Check for abort
      if (abortSignal?.aborted) {
        const reason = taskManager.getAbortReason(jobId);
        throw new TaskAbortedError(reason || 'cancelled');
      }

      console.log(`   📄 Processing chunk ${globalIdx + 1}/${totalChunks}...`);

      try {
        // Process single chunk
        const result = await processSingleChunk({
          chunk,
          chunkIndex: globalIdx,
          totalChunks,
          outputDir,
          jobId,
        });

        console.log(`   ✅ Chunk ${globalIdx + 1} processed successfully`);

        // ⚡ Process result immediately (not waiting for batch)
        if (result.success && result.pageMetadataList) {
          await pageRegistry.insertPages(result.pageMetadataList);
        }
        if (result.success && result.data) {
          mergeChunkData(aggregatedData, result.data);
        }
        if (result.errors?.length) {
          allErrors.push(...result.errors);
        }
        if (result.warnings?.length) {
          allWarnings.push(...result.warnings);
        }

        processedChunkCount++;

        // Update progress
        try {
          await taskManager.updateStatus(jobId, 'processing', {
            progress: Math.round((processedChunkCount / totalChunks) * 85) + 10,
            currentStage: `Processed ${processedChunkCount}/${totalChunks} chunks`,
            processedChunks: processedChunkCount,
          });
        } catch {
          // Ignore update errors
        }

        return result;
      } catch (chunkError) {
        if (chunkError instanceof TaskAbortedError) {
          throw chunkError;  // Re-throw abort errors
        }
        console.error(`   ❌ Chunk ${globalIdx + 1} failed:`, chunkError);
        processedChunkCount++;
        allErrors.push(`Chunk ${globalIdx + 1} error: ${chunkError}`);
        return {
          success: false,
          errors: [String(chunkError)],
          warnings: [],
          data: null,
          pageMetadataList: [],
        };
      }
    });
  });

  // ⚡ Use Promise.allSettled to not fail on single chunk errors
  try {
    const results = await Promise.allSettled(chunkPromises);

    // Check for abort
    const abortedResult = results.find(
      r => r.status === 'rejected' && r.reason instanceof TaskAbortedError
    );
    if (abortedResult) {
      console.log(`\n⏸️  Processing aborted`);

      // Save checkpoint for resume
      const checkpointData: CheckpointData = {
        processedChunks: processedChunkCount,
        aggregatedData,
        pageRegistryState: pageRegistry.exportState(),
        lastProcessedChunkIndex: processedChunkCount - 1,
        timestamp: Date.now(),
      };
      await taskManager.saveCheckpoint(jobId, checkpointData);

      throw (abortedResult as PromiseRejectedResult).reason;
    }

    // Log any other rejections
    const rejections = results.filter(r => r.status === 'rejected');
    if (rejections.length > 0) {
      console.warn(`   ⚠️  ${rejections.length} chunks failed but processing continues`);
    }
  } catch (error) {
    if (error instanceof TaskAbortedError) {
      throw error;
    }
    console.error(`❌ Chunk processing error:`, error);
    throw error;
  }

  console.log(`\n✅ All ${totalChunks} chunks processed!\n`);

  // ============ 获取最终结果 ============
  console.log('\n📊 All chunks processed. Aggregating project-level data...\n');

  // ⭐ 汇总项目数据（使用AI智能去重amenities）
  try {
    await pageRegistry.aggregateProjectData();
  } catch (aggregateError) {
    console.error(`❌ Error aggregating project data:`, aggregateError);
    allErrors.push(`Project data aggregation error: ${aggregateError}`);
  }

  console.log('\n📊 Getting final assignment result...\n');

  let finalAssignmentResult;
  let finalAggregatedData;

  try {
    finalAssignmentResult = await pageRegistry.getFinalResult();
    console.log(`   Units found: ${finalAssignmentResult.units.length}`);
    console.log(`   Total pages processed: ${finalAssignmentResult.totalPages}`);
    
    // 转换为aggregatedData格式（向后兼容）
    finalAggregatedData = convertAssignmentToAggregatedData(finalAssignmentResult, aggregatedData, pageRegistry);

    // ============ 🔧 Final repair pass for incomplete units ============
    // 任何 area=0 / bedrooms 缺失的户型在提交时会被过滤掉（户型丢失）。
    // 在这里做最后一次修复：复用有效anchor specs → 重新提取 → 确定性兜底。
    try {
      const repairWarnings = await repairIncompleteUnits(finalAggregatedData, pageRegistry);
      allWarnings.push(...repairWarnings);
    } catch (repairError) {
      console.error(`   ⚠️  Unit repair pass failed:`, repairError);
      allWarnings.push(`Unit repair pass failed: ${repairError}`);
    }

    // ============ ⚡ 条件生成项目描述 ============
    // 只在没有描述或描述太短时才生成，节省API调用
    const originalDescription = finalAggregatedData.description;
    const needsDescription = !originalDescription || originalDescription.length < 100;

    if (needsDescription) {
      console.log('\n✨ Generating intelligent project description...');
      if (originalDescription) {
        console.log(`   📄 Original description too short: ${originalDescription.length} chars`);
      }

      try {
        const projectSummary: ProjectSummary = {
          projectName: finalAggregatedData.name,
          developer: finalAggregatedData.developer,
          area: finalAggregatedData.area,
          address: finalAggregatedData.address,
          completionDate: finalAggregatedData.completionDate,
          handoverDate: finalAggregatedData.handoverDate,
          constructionProgress: finalAggregatedData.constructionProgress,

          // 单元统计
          totalUnits: finalAggregatedData.units.length,
          unitCategories: Array.from(new Set(
            finalAggregatedData.units
              .map((u: any) => u.category || deriveUnitCategory(u))
              .filter((c: string) => c && c !== 'Unknown')
          )),

          areaRange: calculateAreaRange(finalAggregatedData.units),
          priceRange: calculatePriceRange(finalAggregatedData.units),

          // 配套设施
          amenities: finalAggregatedData.amenities || [],

          // 付款计划
          hasPaymentPlan: (finalAggregatedData.paymentPlans?.length || 0) > 0,
          paymentPlanHighlight: extractPaymentPlanHighlight(finalAggregatedData.paymentPlans),
        };

        const generatedDescription = await generateProjectDescription(projectSummary);

        if (generatedDescription && generatedDescription.length > 50) {
          finalAggregatedData.description = generatedDescription;
          console.log(`   ✅ Generated new description: ${generatedDescription.length} chars`);
        } else if (originalDescription) {
          console.log(`   ⚠️  Generation failed, keeping original description`);
        }
      } catch (descError) {
        console.error(`   ⚠️  Failed to generate description:`, descError);
      }
    } else {
      console.log(`\n⚡ Skipping description generation - existing description is sufficient (${originalDescription.length} chars)`);
    }
    
  } catch (finalError) {
    console.error(`❌ Error getting final result:`, finalError);
    // Fallback to original aggregated data
    finalAggregatedData = aggregatedData;
    allErrors.push(`Final result error: ${finalError}`);
  }

  console.log(`\n✅ Batch processing complete!`);
  console.log(`   Total errors: ${allErrors.length}`);
  console.log(`   Total warnings: ${allWarnings.length}`);

  return {
    aggregatedData: finalAggregatedData,
    allErrors,
    allWarnings,
    chunkAnalyses,
    aborted: false,
    processedChunks: processedChunkCount,
  };
}

/**
 * 从类别名推断卧室数（"1BR" → 1, "Studio" → 0, "2BR + Maid" → 2）
 */
function bedroomsFromCategory(category?: string): number | null {
  if (!category) return null;
  const c = category.toUpperCase();
  if (c.includes('STUDIO')) return 0;
  const m = c.match(/(\d+)\s*-?\s*(BR|BED)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * 判断户型数据是否不完整（提交时会被过滤或明显错误）
 */
function unitNeedsRepair(unit: any): boolean {
  if (!(unit.area > 0)) return true;
  if (unit.bedrooms == null) return true;
  // 提取失败的典型特征：category 说有 N 卧但 bedrooms=0（如 "1BR" bed=0）
  const catBeds = bedroomsFromCategory(unit.category);
  if (catBeds != null && catBeds > 0 && unit.bedrooms === 0) return true;
  return false;
}

/**
 * 🔧 最终修复兜底：补全不完整的户型数据
 *
 * 顺序：
 * 1. 复用同名同类别 anchor 页里已成功提取的 specs（合并产生的重复户型常见）
 * 2. 重新对 anchor 页图片跑一次 AI 提取（extractUnitDetails 内部带重试）
 * 3. 确定性兜底：area ← suiteArea+balconyArea ← 价格表面积；bedrooms ← 类别推断
 *
 * 返回 warnings（修复动作 + 仍无法修复的 SUBMIT-BLOCKER）
 */
async function repairIncompleteUnits(
  data: AggregatedBuildingData,
  pageRegistry: PageRegistry
): Promise<string[]> {
  const warnings: string[] = [];
  const incomplete = (data.units || []).filter(unitNeedsRepair);

  if (incomplete.length === 0) {
    console.log(`\n✅ [REPAIR] All ${data.units?.length || 0} units have valid specs, no repair needed`);
    return warnings;
  }

  console.log(`\n🔧 [REPAIR] ${incomplete.length}/${data.units.length} units incomplete, starting repair pass...`);

  const anchorPages = pageRegistry.getAnchorPages();
  const { extractUnitDetails } = await import('../agents/unit-detail-extractor.agent');

  for (const unit of incomplete) {
    const unitName = (unit.typeName || unit.name || '').toUpperCase().trim();
    const unitCategory = (unit.category || '').toUpperCase().replace(/\s+/g, '');
    const before = `bed=${unit.bedrooms}, bath=${unit.bathrooms}, area=${unit.area}`;

    // 候选 anchor 页：名称匹配（大小写不敏感），优先类别也匹配的
    const nameMatches = anchorPages.filter(p =>
      (p.unitInfo?.unitTypeName || '').toUpperCase().trim() === unitName
    );
    const catMatches = unitCategory
      ? nameMatches.filter(p =>
          (p.unitInfo?.unitCategory || '').toUpperCase().replace(/\s+/g, '') === unitCategory
        )
      : [];
    const candidates = catMatches.length > 0 ? catMatches : nameMatches;

    // ---- Step 1: 复用已成功提取的 sibling anchor specs ----
    const validSibling = candidates.find(p => (p.unitInfo?.specs?.area || 0) > 0);
    if (validSibling) {
      const specs = validSibling.unitInfo!.specs!;
      if (!(unit.area > 0)) unit.area = specs.area;
      const siblingCatBeds = bedroomsFromCategory(unit.category);
      if (specs.bedrooms != null &&
          (unit.bedrooms == null || (unit.bedrooms === 0 && (siblingCatBeds ?? 0) > 0))) {
        unit.bedrooms = specs.bedrooms;
      }
      if (!(unit.bathrooms > 0) && specs.bathrooms) unit.bathrooms = specs.bathrooms;
      if (unit.suiteArea == null && specs.suiteArea) unit.suiteArea = specs.suiteArea;
      if (unit.balconyArea == null && specs.balconyArea) unit.balconyArea = specs.balconyArea;
      if (!unit.description && validSibling.unitInfo!.description) unit.description = validSibling.unitInfo!.description;
      if ((!unit.features || unit.features.length === 0) && validSibling.unitInfo!.features) {
        unit.features = validSibling.unitInfo!.features;
      }
      console.log(`   🔧 [REPAIR] "${unit.typeName}" filled from sibling anchor page ${validSibling.pageNumber}: ${before} → bed=${unit.bedrooms}, area=${unit.area}`);
    }

    // ---- Step 2: 重新对 anchor 页跑 AI 提取 ----
    if (unitNeedsRepair(unit) && candidates.length > 0) {
      const page = candidates[0];
      const imageUrl = page.images?.[0]?.imagePath;
      if (imageUrl) {
        console.log(`   🔧 [REPAIR] Re-extracting "${unit.typeName}" from page ${page.pageNumber}...`);
        try {
          const details = await extractUnitDetails(imageUrl, unit.typeName || unit.name, page.pageNumber);
          const specs = details.specs || {};
          if (!(unit.area > 0) && (specs.area || 0) > 0) unit.area = specs.area;
          if (specs.bedrooms != null && (unit.bedrooms == null || unit.bedrooms === 0)) unit.bedrooms = specs.bedrooms;
          if (!(unit.bathrooms > 0) && specs.bathrooms) unit.bathrooms = specs.bathrooms;
          if (unit.suiteArea == null && specs.suiteArea) unit.suiteArea = specs.suiteArea;
          if (unit.balconyArea == null && specs.balconyArea) unit.balconyArea = specs.balconyArea;
          if (!unit.price && specs.price) unit.price = specs.price;
          if (!unit.description && details.description) unit.description = details.description;
          if ((!unit.features || unit.features.length === 0) && details.features?.length) unit.features = details.features;
          // 把修复后的 specs 写回 anchor 页，后续流程（如实时更新）可见
          if (page.unitInfo) {
            page.unitInfo.specs = { ...(page.unitInfo.specs || {}), ...specs };
            page.unitInfo.hasDetailedSpecs = Object.keys(specs).length > 0;
          }
          console.log(`   🔧 [REPAIR] Re-extraction for "${unit.typeName}": ${before} → bed=${unit.bedrooms}, bath=${unit.bathrooms}, area=${unit.area}`);
        } catch (reExtractError) {
          console.warn(`   ⚠️  [REPAIR] Re-extraction failed for "${unit.typeName}": ${(reExtractError as Error).message}`);
        }
      }
    }

    // ---- Step 3: 确定性兜底 ----
    if (!(unit.area > 0) && (unit.suiteArea || 0) > 0) {
      unit.area = (unit.suiteArea || 0) + (unit.balconyArea || 0);
      console.log(`   🔧 [REPAIR] "${unit.typeName}" area fallback from suite+balcony: ${unit.area}`);
    }
    if (!(unit.area > 0) && data.extractedPricing && data.extractedPricing.length > 0) {
      const priceEntry = data.extractedPricing.find(e => {
        const eName = (e.unitTypeName || '').toUpperCase().trim();
        const eCat = (e.unitCategory || '').toUpperCase().replace(/\s+/g, '');
        return (e.area || 0) > 0 && (
          (eName && eName === unitName) ||
          (eCat && unitCategory && eCat === unitCategory)
        );
      });
      if (priceEntry) {
        unit.area = priceEntry.area;
        console.log(`   🔧 [REPAIR] "${unit.typeName}" area fallback from pricing table (page ${priceEntry.sourcePageNumber}): ${unit.area}`);
      }
    }
    const catBeds = bedroomsFromCategory(unit.category);
    if (catBeds != null && (unit.bedrooms == null || (unit.bedrooms === 0 && catBeds > 0))) {
      unit.bedrooms = catBeds;
      console.log(`   🔧 [REPAIR] "${unit.typeName}" bedrooms inferred from category "${unit.category}": ${catBeds}`);
    }
    if (!(unit.bathrooms > 0) && unit.bedrooms != null) {
      unit.bathrooms = unit.bedrooms === 0 ? 1 : Math.min(Math.max(unit.bedrooms, 1), 3);
    }

    // ---- 结果记录 ----
    if (unitNeedsRepair(unit)) {
      const msg = `SUBMIT-BLOCKER: Unit "${unit.typeName || unit.name}" (${unit.category || 'no category'}) still incomplete after repair: bed=${unit.bedrooms}, area=${unit.area} — will be filtered at submission`;
      console.warn(`   ❌ [REPAIR] ${msg}`);
      warnings.push(msg);
    } else if (before !== `bed=${unit.bedrooms}, bath=${unit.bathrooms}, area=${unit.area}`) {
      warnings.push(`Repaired unit "${unit.typeName || unit.name}" (${unit.category || ''}): ${before} → bed=${unit.bedrooms}, bath=${unit.bathrooms}, area=${unit.area}`);
    }
  }

  const stillBroken = data.units.filter(unitNeedsRepair).length;
  console.log(`\n🔧 [REPAIR] Repair pass complete: ${incomplete.length - stillBroken}/${incomplete.length} units fixed${stillBroken > 0 ? `, ${stillBroken} still incomplete` : ''}`);

  return warnings;
}

/**
 * 推导单元类别
 */
function deriveUnitCategory(unit: any): string {
  if (unit.bedrooms === 0) return 'Studio';
  if (unit.bedrooms === 1) return '1BR';
  if (unit.bedrooms === 2) return '2BR';
  if (unit.bedrooms === 3) return '3BR';
  if (unit.bedrooms === 4) return '4BR';
  if (unit.bedrooms >= 5) return '5BR+';
  if (unit.typeName?.toLowerCase().includes('penthouse')) return 'Penthouse';
  return 'Unknown';
}

/**
 * 计算面积范围
 */
function calculateAreaRange(units: any[]): { min: number; max: number } | undefined {
  const areas = units
    .map((u: any) => u.area)
    .filter((a: number) => a && a > 0);
  
  if (areas.length === 0) return undefined;
  
  return {
    min: Math.min(...areas),
    max: Math.max(...areas),
  };
}

/**
 * 计算价格范围
 */
function calculatePriceRange(units: any[]): { min: number; max: number } | undefined {
  const prices = units
    .map((u: any) => u.price)
    .filter((p: number) => p && p > 0);
  
  if (prices.length === 0) return undefined;
  
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

/**
 * 提取付款计划亮点
 */
function extractPaymentPlanHighlight(paymentPlans: any[]): string | undefined {
  if (!paymentPlans || paymentPlans.length === 0) return undefined;
  
  // 尝试提取常见的付款计划比例
  const firstPlan = paymentPlans[0];
  
  // 查找类似 "60/40" 或 "70/30" 的模式
  if (firstPlan.name) {
    const match = firstPlan.name.match(/(\d+)\/(\d+)/);
    if (match) {
      return `${match[1]}/${match[2]} payment plan`;
    }
  }
  
  // 检查milestones
  if (firstPlan.milestones && firstPlan.milestones.length > 0) {
    const duringConstruction = firstPlan.milestones
      .filter((m: any) => m.stage?.toLowerCase().includes('construction'))
      .reduce((sum: number, m: any) => sum + (m.percentage || 0), 0);
    
    const onHandover = 100 - duringConstruction;
    
    if (duringConstruction > 0 && onHandover > 0) {
      return `${duringConstruction}/${onHandover} payment plan`;
    }
  }
  
  return 'Flexible payment plan available';
}

/**
 * Derive building/tower name from unit type name
 * 
 * @param unitTypeName - Unit type name (e.g., "A-1B-A.1", "Tower-B-2BR", "Type S1")
 * @returns Building name (e.g., "Tower A", "Building B", undefined for single building)
 */
function deriveBuildingName(unitTypeName: string): string | undefined {
  if (!unitTypeName) return undefined;
  
  const name = unitTypeName.toUpperCase();
  
  // Pattern 1: "A-1B-A.1" → "Tower A"
  const prefixMatch = name.match(/^([A-Z])-/);
  if (prefixMatch) {
    return `Tower ${prefixMatch[1]}`;
  }
  
  // Pattern 2: "Tower-A-1BR" → "Tower A"
  const towerMatch = name.match(/TOWER[-\s]*([A-Z])/);
  if (towerMatch) {
    return `Tower ${towerMatch[1]}`;
  }
  
  // Pattern 3: "Building-1-2BR" → "Building 1"
  const buildingMatch = name.match(/BUILDING[-\s]*(\d+)/);
  if (buildingMatch) {
    return `Building ${buildingMatch[1]}`;
  }
  
  // Pattern 4: "B1-Studio" → "Tower B"
  const shortMatch = name.match(/^([A-Z])(\d)/);
  if (shortMatch) {
    return `Tower ${shortMatch[1]}`;
  }
  
  // No tower/building prefix found → single building project
  return undefined;
}

/**
 * 转换AssignmentResult为AggregatedBuildingData格式
 *
 * 关键：合并两个数据源
 * - PageRegistry: 图片分配（智能边界识别）
 * - aggregatedData: 单元详细信息（bedrooms, bathrooms, area, price等）
 */
function convertAssignmentToAggregatedData(
  assignmentResult: AssignmentResult,
  originalData: AggregatedBuildingData,
  pageRegistry: PageRegistry
): AggregatedBuildingData {
  console.log('\n🔄 Merging smart assignment with unit details...');
  console.log(`   Units from smart assignment: ${assignmentResult.units.length}`);
  console.log(`   Units from workflow: ${originalData.units.length}`);
  
  // ============ 合并逻辑 ============
  // 1. 以智能分配的户型为主（图片准确）
  // 2. 从originalData中查找匹配的单元详情（bedrooms, area等）
  // 3. 合并两者数据
  
  const mergedUnits = assignmentResult.units.map(smartUnit => {
    // 在originalData中查找同名单元
    // ⚠️ FIX: Must also match by category to avoid "Type A (1BR)" being matched to "Type A (4BR)"
    const matchedUnit = originalData.units.find(u => {
      const uName = (u.typeName || u.name || '').toLowerCase().trim();
      const smartName = smartUnit.unitTypeName.toLowerCase().trim();
      const nameMatches = uName === smartName || uName.includes(smartName) || smartName.includes(uName);

      // If both have category, must match category too
      // This prevents "Type A (1BR)" from matching with "Type A (2BR)" or "Type A (4BR)"
      if (smartUnit.unitCategory && u.category) {
        return nameMatches && u.category === smartUnit.unitCategory;
      }

      return nameMatches;
    });
    
    if (matchedUnit) {
      console.log(`   ✓ Matched "${smartUnit.unitTypeName}" with workflow data`);

      // 合并：智能分配的图片 + workflow的详细信息
      // ⭐ 优先使用smartUnit的价格（来自mergePricesIntoUnits）
      const finalPrice = smartUnit.price ?? matchedUnit.price;
      const finalPricePerSqft = smartUnit.pricePerSqft ?? matchedUnit.pricePerSqft;

      if (smartUnit.price) {
        console.log(`   💰 Using matched price for "${smartUnit.unitTypeName}": ${smartUnit.price} AED (${smartUnit.priceMatchType})`);
      }

      return {
        ...matchedUnit,  // ← 保留所有原有信息（bedrooms, area等）
        id: smartUnit.unitTypeName,
        name: smartUnit.unitTypeName,
        typeName: smartUnit.unitTypeName,
        // ⭐ 使用智能分配的图片
        floorPlanImage: smartUnit.floorPlanImages[0]?.imagePath || matchedUnit.floorPlanImage,
        floorPlanImages: smartUnit.floorPlanImages.map(img => img.imagePath),
        renderingImages: smartUnit.renderingImages.map(img => img.imagePath),
        interiorImages: smartUnit.interiorImages.map(img => img.imagePath),
        balconyImages: smartUnit.balconyImages?.map(img => img.imagePath) || [],
        // ⭐ 使用匹配到的价格（覆盖matchedUnit的null值）
        price: finalPrice,
        pricePerSqft: finalPricePerSqft,
      };
    } else {
      console.warn(`   ⚠️  No workflow data for "${smartUnit.unitTypeName}", using AI specs only`);

      // 无匹配，从PageMetadata提取（可能不完整）
      // ⚠️ FIX: Must also filter by category AND/OR pageRange to get correct specs
      // This prevents "Type A (1BR)" page 35 from being used for "Type A (4BR)" page 39
      // ⚠️ Name/category compares are case-insensitive ("TYPE B" vs "Type B")
      const smartName = smartUnit.unitTypeName.toUpperCase().trim();
      const smartCategory = (smartUnit.unitCategory || '').toUpperCase().replace(/\s+/g, '');
      const anchorPages = pageRegistry.getAnchorPages().filter(p => {
        // First: must match unit name
        if ((p.unitInfo?.unitTypeName || '').toUpperCase().trim() !== smartName) {
          return false;
        }

        // Strategy 1: Match by category if both are available
        if (smartCategory && p.unitInfo?.unitCategory) {
          return p.unitInfo.unitCategory.toUpperCase().replace(/\s+/g, '') === smartCategory;
        }

        // Strategy 2: Match by page range if category not available
        // smartUnit.pageRange tells us which pages this unit came from
        if (smartUnit.pageRange) {
          return p.pageNumber >= smartUnit.pageRange.start &&
                 p.pageNumber <= smartUnit.pageRange.end;
        }

        // Fallback: match by name only (may be incorrect for same-name units)
        return true;
      });

      // Prefer the anchor whose extraction actually succeeded (valid area) —
      // a merged unit can have one good anchor page and one failed one
      anchorPages.sort((a, b) =>
        ((b.unitInfo?.specs?.area || 0) > 0 ? 1 : 0) - ((a.unitInfo?.specs?.area || 0) > 0 ? 1 : 0)
      );

      const firstAnchor = anchorPages[0];
      const specs = firstAnchor?.unitInfo?.specs;

      // Debug logging for troubleshooting
      if (anchorPages.length > 1) {
        console.warn(`   ⚠️  Multiple anchors found for "${smartUnit.unitTypeName}" (category=${smartUnit.unitCategory}, pageRange=${JSON.stringify(smartUnit.pageRange)}): ${anchorPages.map(p => `page ${p.pageNumber} (${p.unitInfo?.unitCategory})`).join(', ')}`);
      }
      
      // Estimate bathrooms if missing based on bedrooms
      let bedrooms = specs?.bedrooms || 0;
      let bathrooms = specs?.bathrooms || 0;
      
      // If bathrooms is 0 or invalid, estimate based on bedrooms
      if (bathrooms <= 0) {
        if (bedrooms === 0) {
          bathrooms = 1; // Studio: typically 1 bathroom
        } else if (bedrooms === 1) {
          bathrooms = 1; // 1BR: typically 1 bathroom
        } else if (bedrooms === 2) {
          bathrooms = 2; // 2BR: typically 2 bathrooms
        } else {
          bathrooms = Math.min(bedrooms, 3); // 3+ BR: estimate, capped at 3
        }
        console.warn(`   ⚠️  Missing bathrooms for "${smartUnit.unitTypeName}", estimated ${bathrooms} based on ${bedrooms} bedrooms`);
      }
      
      let area = specs?.area || 0;
      const hasDetailedSpecs = firstAnchor?.unitInfo?.hasDetailedSpecs || false;
      
      // ⚠️ Warn if area is 0 (likely AI extraction failure or misclassification)
      // Note: We cannot do async retry here since map() is not async
      // The retry logic would need to be implemented at a higher level
      if (area === 0) {
        console.warn(`   ⚠️  [BATCH-PROCESSOR] Unit "${smartUnit.unitTypeName}" has area=0!`);
        console.warn(`   📊 [BATCH-PROCESSOR] hasDetailedSpecs: ${hasDetailedSpecs}`);
        console.warn(`   📊 [BATCH-PROCESSOR] specs:`, JSON.stringify(specs || {}));
        console.warn(`   📊 [BATCH-PROCESSOR] firstAnchor page: ${firstAnchor?.pageNumber}, unitInfo:`, firstAnchor?.unitInfo ? 'exists' : 'missing');
        console.warn(`   💡 [BATCH-PROCESSOR] This unit will be filtered out during submission.`);
      }
      
      // ⭐ 优先使用smartUnit的价格（来自mergePricesIntoUnits）
      const finalPrice = smartUnit.price ?? specs?.price;
      const finalPricePerSqft = smartUnit.pricePerSqft ?? specs?.pricePerSqft;

      if (smartUnit.price) {
        console.log(`   💰 Using matched price for "${smartUnit.unitTypeName}": ${smartUnit.price} AED (${smartUnit.priceMatchType})`);
      }

      return {
        id: smartUnit.unitTypeName,
        name: smartUnit.unitTypeName,
        typeName: smartUnit.unitTypeName,
        category: firstAnchor?.unitInfo?.unitCategory || '',
        buildingName: deriveBuildingName(smartUnit.unitTypeName),  // ⭐ 从名称推断归属
        bedrooms: bedrooms,
        bathrooms: bathrooms,
        area: area,  // May have been updated by retry logic
        suiteArea: specs?.suiteArea,        // ⭐ 室内面积
        balconyArea: specs?.balconyArea,    // ⭐ 阳台面积
        price: finalPrice,                  // ⭐ 使用匹配到的价格
        pricePerSqft: finalPricePerSqft,    // ⭐ 单价
        features: firstAnchor?.unitInfo?.features || [],  // ⭐ 户型特征列表（从平面图提取）
        description: firstAnchor?.unitInfo?.description,  // ⭐ AI生成的户型描述
        floorPlanImage: smartUnit.floorPlanImages[0]?.imagePath,
        floorPlanImages: smartUnit.floorPlanImages.map(img => img.imagePath),
        renderingImages: smartUnit.renderingImages.map(img => img.imagePath),
        interiorImages: smartUnit.interiorImages.map(img => img.imagePath),
        balconyImages: smartUnit.balconyImages?.map(img => img.imagePath) || [],
      };
    }
  });
  
  console.log(`   ✅ Merged ${mergedUnits.length} units with complete information`);
  
  // 合并payment plans
  const finalPaymentPlans = assignmentResult.paymentPlans && assignmentResult.paymentPlans.length > 0
    ? assignmentResult.paymentPlans
    : originalData.paymentPlans;
  
  console.log(`   💰 Payment plans: ${finalPaymentPlans?.length || 0}`);
  
  // ⭐ 合并项目基本信息（智能提取优先）
  const projectInfo = assignmentResult.projectInfo || {};
  const mergedBasicInfo = {
    name: projectInfo.projectName || originalData.name,
    developer: projectInfo.developer || originalData.developer,
    address: projectInfo.address || originalData.address,
    area: projectInfo.area || originalData.area,
    launchDate: projectInfo.launchDate || originalData.launchDate,
    completionDate: projectInfo.completionDate || originalData.completionDate,
    handoverDate: projectInfo.handoverDate,
    constructionProgress: projectInfo.constructionProgress,
    description: projectInfo.description || originalData.description,
  };
  
  console.log(`   🏗️  Project info merged:`, Object.keys(projectInfo).join(', '));
  
  // ⭐ 合并项目图片（智能分配 + 原始workflow）
  const smartProjectImages = [
    ...assignmentResult.projectImages.coverImages.map(img => img.imagePath),
    ...assignmentResult.projectImages.renderingImages.map(img => img.imagePath),
    ...assignmentResult.projectImages.aerialImages.map(img => img.imagePath),
    ...assignmentResult.projectImages.locationMaps.map(img => img.imagePath),
    ...assignmentResult.projectImages.masterPlanImages.map(img => img.imagePath),
    ...assignmentResult.projectImages.amenityImages.map(img => img.imagePath),
  ];
  
  // 合并原始数据中的项目图片
  const originalProjectImages = originalData.images?.projectImages || [];
  const allProjectImages = [...smartProjectImages, ...originalProjectImages];
  
  // 去重（按路径）
  const uniqueProjectImages = Array.from(new Set(allProjectImages));
  
  console.log(`   🖼️  Project images merged: ${smartProjectImages.length} (smart) + ${originalProjectImages.length} (workflow) = ${uniqueProjectImages.length} (unique)`);
  
  // 合并所有图片
  const smartAllImages = [
    ...smartProjectImages,
    ...assignmentResult.units.flatMap(u => u.allImages.map(img => img.imagePath)),
  ];
  
  const originalAllImages = originalData.images?.allImages || [];
  const mergedAllImages = [...smartAllImages, ...originalAllImages];
  const uniqueAllImages = Array.from(new Set(mergedAllImages));
  
  console.log(`   🖼️  All images merged: ${smartAllImages.length} (smart) + ${originalAllImages.length} (workflow) = ${uniqueAllImages.length} (unique)`);
  
  // ⭐ 合并配套设施（智能提取 + 原始workflow）
  const smartAmenities = assignmentResult.amenities || [];
  const originalAmenities = originalData.amenities || [];
  const mergedAmenities = [...smartAmenities, ...originalAmenities];
  const uniqueAmenities = Array.from(new Set(mergedAmenities));
  
  console.log(`   🏊 Amenities merged: ${smartAmenities.length} (smart) + ${originalAmenities.length} (workflow) = ${uniqueAmenities.length} (unique)`);

  // ⭐ 提取原始价格数据（用于前端验证）
  const extractedPricing = assignmentResult.pricing || [];
  if (extractedPricing.length > 0) {
    console.log(`   💰 Extracted pricing entries: ${extractedPricing.length}`);
  }

  // 返回完整数据
  return {
    ...originalData,
    ...mergedBasicInfo,  // ⭐ 项目基本信息
    units: mergedUnits,
    paymentPlans: finalPaymentPlans,
    amenities: uniqueAmenities,  // ⭐ 合并后的配套设施
    images: {
      projectImages: uniqueProjectImages,  // ⭐ 合并后的项目图片
      floorPlanImages: assignmentResult.units.flatMap(u =>
        u.floorPlanImages.map(img => img.imagePath)
      ),
      allImages: uniqueAllImages,  // ⭐ 合并后的所有图片
    },
    // ⭐ 原始价格数据（用于前端验证和调试）
    extractedPricing: extractedPricing.length > 0 ? extractedPricing : undefined,
  };
}

/**
 * Emit progress update for smart assignment system
 *
 * 实时更新时也合并workflow数据
 */
function emitSmartAssignmentUpdate(
  jobId: string,
  assignmentResult: AssignmentResult,
  aggregatedData: AggregatedBuildingData,
  totalChunks: number,
  pageRegistry: PageRegistry
): void {
  // 计算进度
  const progress = 10 + (assignmentResult.totalPages / (totalChunks * 5)) * 75;

  // ⭐ 合并workflow数据（实时）
  const mergedData = convertAssignmentToAggregatedData(assignmentResult, aggregatedData, pageRegistry);

  progressEmitter.emit(jobId, {
    stage: 'mapping',
    code: 'PROCESSING_PAGES',
    message: `Processed ${assignmentResult.totalPages} pages, found ${assignmentResult.anchorPagesFound} unit types`,
    progress,
    data: {
      buildingData: mergedData,  // ⭐ 发送合并后的完整数据
      totalPages: assignmentResult.totalPages,
      anchorPagesFound: assignmentResult.anchorPagesFound,
    },
    timestamp: Date.now(),
  });
}
