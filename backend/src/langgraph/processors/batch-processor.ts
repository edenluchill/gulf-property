/**
 * Batch Processor Module
 * 
 * Handles batch processing of chunks with:
 * - Parallel processing within batches
 * - Rate limiting between batches
 * - Progress tracking and updates
 * - Data aggregation during processing
 * 
 * NEW: Integrated with smart image assignment system
 * - PageRegistry for incremental updates
 * - Real-time image assignment
 * - Multi-PDF support
 */

import type { PdfChunk } from '../../utils/pdf/chunker';
import { progressEmitter } from '../../services/progress-emitter';
import { processSingleChunk } from './chunk-processor';
import { 
  mergeChunkData, 
  type AggregatedBuildingData 
} from './data-aggregator';
import { type ChunkAnalysisResult } from './result-recorder';
import { PageRegistry } from '../core/page-registry';
import { AssignmentResult } from '../types/assignment-result';
import { generateProjectDescription, type ProjectSummary } from '../agents/project-description-generator.agent';

export interface BatchProcessingConfig {
  chunks: Array<PdfChunk & { sourceFile: string; pdfHash: string }>;
  outputDir: string;
  jobId: string;
  batchSize?: number;
  batchDelay?: number; // ms
}

export interface BatchProcessingResult {
  aggregatedData: AggregatedBuildingData;
  allErrors: string[];
  allWarnings: string[];
  chunkAnalyses: ChunkAnalysisResult[];  // Detailed chunk analysis results
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
    batchDelay = 1000,
  } = config;

  const totalChunks = chunks.length;
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const chunkAnalyses: ChunkAnalysisResult[] = [];

  // ============ 智能分配系统初始化 ============
  console.log('\n🎯 Smart Image Assignment System\n');
  
  // 1. 重置Registry
  PageRegistry.reset();
  
  // 2. 设置实时更新回调（传递aggregatedData引用）
  PageRegistry.setUpdateCallback((assignmentResult: AssignmentResult) => {
    // 每次重新计算后，发送SSE更新给前端
    // 合并workflow数据（实时）
    emitSmartAssignmentUpdate(jobId, assignmentResult, aggregatedData, chunks.length);
  });

  // Split chunks into batches
  const batches: typeof chunks[] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  console.log(`\n🚀 Processing in ${batches.length} parallel batches (${batchSize} chunks per batch)\n`);
  console.log(`⏱️  Rate limit protection: ${batchDelay / 1000}s delay between batches\n`);

  // Process each batch
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    console.log(`\n=== BATCH ${batchIdx + 1}/${batches.length} - Processing ${batch.length} chunks in PARALLEL ===\n`);

    // Process all chunks in this batch CONCURRENTLY
    const batchPromises = batch.map(async (chunk, batchLocalIdx) => {
      const globalIdx = batchIdx * batchSize + batchLocalIdx;

      console.log(`   📄 Processing chunk ${globalIdx + 1}/${totalChunks}...`);

      try {
        // Process single chunk with smart assignment
        const result = await processSingleChunk({
          chunk,
          chunkIndex: globalIdx,
          totalChunks,
          outputDir,
          jobId,
        });

        console.log(`   ✅ Chunk ${globalIdx + 1} processed successfully`);
        
        return result;
      } catch (chunkError) {
        console.error(`   ❌ Chunk ${globalIdx + 1} failed:`, chunkError);
        // Return error result instead of throwing
        return {
          success: false,
          errors: [String(chunkError)],
          warnings: [],
          data: null,
          pageMetadataList: [],
        };
      }
    });

    // Wait for all chunks in this batch to complete
    let batchResults;
    try {
      batchResults = await Promise.all(batchPromises);
    } catch (batchError) {
      console.error(`❌ Batch ${batchIdx + 1} failed:`, batchError);
      throw new Error(`Batch processing failed at batch ${batchIdx + 1}: ${batchError}`);
    }

    // Process results
    for (const result of batchResults) {
      try {
        // ============ 1. 智能图片分配 ============
        // 插入PageMetadata到Registry（触发图片分配）
        if (result.success && result.pageMetadataList) {
          await PageRegistry.insertPages(result.pageMetadataList);
        }
        
        // ============ 2. 原有数据聚合 ============
        // 保留单元详细信息（bedrooms, bathrooms, area, price等）
        if (result.success && result.data) {
          mergeChunkData(aggregatedData, result.data);
        }
        
        // 收集错误
        if (result.errors && result.errors.length > 0) {
          allErrors.push(...result.errors);
        }
        if (result.warnings && result.warnings.length > 0) {
          allWarnings.push(...result.warnings);
        }
      } catch (resultError) {
        console.error(`❌ Error processing result:`, resultError);
        allErrors.push(`Result processing error: ${resultError}`);
      }
    }

    console.log(`\n✅ Batch ${batchIdx + 1} complete!\n`);

    // Delay between batches to respect rate limits
    if (batchIdx < batches.length - 1) {
      console.log(`\n⏸️  Waiting ${batchDelay / 1000}s before next batch (rate limit protection)...`);
      await new Promise(resolve => setTimeout(resolve, batchDelay));
    }
  }

  // ============ 获取最终结果 ============
  console.log('\n📊 All chunks processed. Aggregating project-level data...\n');
  
  // ⭐ 汇总项目数据（使用AI智能去重amenities）
  try {
    await PageRegistry.aggregateProjectData();
  } catch (aggregateError) {
    console.error(`❌ Error aggregating project data:`, aggregateError);
    allErrors.push(`Project data aggregation error: ${aggregateError}`);
  }
  
  console.log('\n📊 Getting final assignment result...\n');
  
  let finalAssignmentResult;
  let finalAggregatedData;
  
  try {
    finalAssignmentResult = await PageRegistry.getFinalResult();
    console.log(`   Units found: ${finalAssignmentResult.units.length}`);
    console.log(`   Total pages processed: ${finalAssignmentResult.totalPages}`);
    
    // 转换为aggregatedData格式（向后兼容）
    finalAggregatedData = convertAssignmentToAggregatedData(finalAssignmentResult, aggregatedData);
    
    // ============ ⭐ 总是生成智能项目描述 ============
    // 即使PDF有描述，也重新生成：AI生成的更简洁、专业、统一
    console.log('\n✨ Generating intelligent project description...');
    
    const originalDescription = finalAggregatedData.description;
    if (originalDescription) {
      console.log(`   📄 Original PDF description: ${originalDescription.length} chars (will be replaced)`);
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
      // 如果生成失败且没有原始描述，不影响主流程
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
  };
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
  originalData: AggregatedBuildingData
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
    const matchedUnit = originalData.units.find(u => {
      const uName = (u.typeName || u.name || '').toLowerCase().trim();
      const smartName = smartUnit.unitTypeName.toLowerCase().trim();
      return uName === smartName || uName.includes(smartName) || smartName.includes(uName);
    });
    
    if (matchedUnit) {
      console.log(`   ✓ Matched "${smartUnit.unitTypeName}" with workflow data`);
      
      // 合并：智能分配的图片 + workflow的详细信息
      return {
        ...matchedUnit,  // ← 保留所有原有信息（bedrooms, area, price等）
        id: smartUnit.unitTypeName,
        name: smartUnit.unitTypeName,
        typeName: smartUnit.unitTypeName,
        // ⭐ 使用智能分配的图片
        floorPlanImage: smartUnit.floorPlanImages[0]?.imagePath || matchedUnit.floorPlanImage,
        floorPlanImages: smartUnit.floorPlanImages.map(img => img.imagePath),
        renderingImages: smartUnit.renderingImages.map(img => img.imagePath),
        interiorImages: smartUnit.interiorImages.map(img => img.imagePath),
        balconyImages: smartUnit.balconyImages?.map(img => img.imagePath) || [],
      };
    } else {
      console.warn(`   ⚠️  No workflow data for "${smartUnit.unitTypeName}", using AI specs only`);
      
      // 无匹配，从PageMetadata提取（可能不完整）
      const anchorPages = PageRegistry.getAnchorPages().filter(
        p => p.unitInfo?.unitTypeName === smartUnit.unitTypeName
      );
      const firstAnchor = anchorPages[0];
      const specs = firstAnchor?.unitInfo?.specs;
      
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
        price: specs?.price,
        pricePerSqft: specs?.pricePerSqft,  // ⭐ 单价
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
  totalChunks: number
): void {
  // 计算进度
  const progress = 10 + (assignmentResult.totalPages / (totalChunks * 5)) * 75;

  // ⭐ 合并workflow数据（实时）
  const mergedData = convertAssignmentToAggregatedData(assignmentResult, aggregatedData);

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
