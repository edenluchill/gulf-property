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
  getDeduplicatedUnits,
  type AggregatedBuildingData 
} from './data-aggregator';
import { extractPageAnalysis, type ChunkAnalysisResult } from './result-recorder';
import { updateBuildingDataWithImageUrls } from '../utils/image-url-helper';
import { PageRegistry } from '../core/page-registry';
import { AssignmentResult } from '../types/assignment-result';

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
  console.log('\n📊 All chunks processed. Getting final assignment result...\n');
  
  let finalAssignmentResult;
  let finalAggregatedData;
  
  try {
    finalAssignmentResult = await PageRegistry.getFinalResult();
    console.log(`   Units found: ${finalAssignmentResult.units.length}`);
    console.log(`   Total pages processed: ${finalAssignmentResult.totalPages}`);
    
    // 转换为aggregatedData格式（向后兼容）
    finalAggregatedData = convertAssignmentToAggregatedData(finalAssignmentResult, aggregatedData);
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
      
      return {
        id: smartUnit.unitTypeName,
        name: smartUnit.unitTypeName,
        typeName: smartUnit.unitTypeName,
        category: firstAnchor?.unitInfo?.unitCategory || '',
        tower: firstAnchor?.unitInfo?.tower,
        bedrooms: specs?.bedrooms || 0,
        bathrooms: specs?.bathrooms || 0,
        area: specs?.area || 0,
        suiteArea: specs?.suiteArea,        // ⭐ 室内面积
        balconyArea: specs?.balconyArea,    // ⭐ 阳台面积
        price: specs?.price,
        pricePerSqft: specs?.pricePerSqft,  // ⭐ 单价
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
  
  // 返回完整数据
  return {
    ...originalData,
    ...mergedBasicInfo,  // ⭐ 项目基本信息
    units: mergedUnits,
    paymentPlans: finalPaymentPlans,
    towerInfos: assignmentResult.towerInfos || [],  // ⭐ Tower信息
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
    message: `✓ 已处理 ${assignmentResult.totalPages} 页，找到 ${assignmentResult.anchorPagesFound} 个户型`,
    progress,
    data: {
      buildingData: mergedData,  // ⭐ 发送合并后的完整数据
    },
    timestamp: Date.now(),
  });
}

/**
 * 转换AssignmentResult为前端格式
 */
function convertAssignmentToLegacyFormat(result: AssignmentResult, jobId: string): any {
  return {
    units: result.units.map(unit => ({
      id: unit.unitTypeName,
      name: unit.unitTypeName,
      typeName: unit.unitTypeName,
      floorPlanImage: unit.floorPlanImages[0]?.imagePath,
      floorPlanImages: unit.floorPlanImages.map(img => img.imagePath),
      renderingImages: unit.renderingImages.map(img => img.imagePath),
      interiorImages: unit.interiorImages.map(img => img.imagePath),
      // TODO: 从现有workflow提取其他字段（area, bedrooms等）
    })),
    images: {
      projectImages: [
        ...result.projectImages.coverImages.map(img => img.imagePath),
        ...result.projectImages.renderingImages.map(img => img.imagePath),
        ...result.projectImages.aerialImages.map(img => img.imagePath),
      ],
      floorPlanImages: result.units.flatMap(u => u.floorPlanImages.map(img => img.imagePath)),
    },
  };
}

