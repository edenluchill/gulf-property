/**
 * Parallel Chunk Processing Executor
 * 
 * Processes multiple chunks concurrently (up to 10 at a time)
 * Uses LangGraph's reducer mechanism to avoid race conditions
 * 
 * Perfect for large PDFs!
 */

import { StateGraph, Send } from '@langchain/langgraph';
import { ParallelStateAnnotation, type ParallelState } from './state-parallel';
import { splitPdfIntoChunks, type PdfChunk } from '../utils/pdf/chunker';
import { deduplicateUnits, deduplicateAmenities, deduplicatePaymentPlans } from '../utils/deduplication';
import { progressEmitter } from '../services/progress-emitter';
import { buildEnhancedWorkflow } from './graph-enhanced';

export interface ParallelConfig {
  pdfBuffers: Buffer[];
  pdfNames?: string[];
  jobId: string;
  pagesPerChunk?: number;
  maxConcurrent?: number; // Max chunks to process concurrently
}

/**
 * Process a single chunk
 */
async function processChunkNode(
  _state: ParallelState,
  config: { chunkIndex: number; chunk: PdfChunk; sourceFile: string }
): Promise<Partial<ParallelState>> {
  const { chunkIndex, chunk, sourceFile } = config;
  
  console.log(`   🔍 Processing chunk ${chunkIndex + 1}: ${sourceFile} 页 ${chunk.pageRange.start}-${chunk.pageRange.end}`);

  try {
    // Build a mini workflow for this chunk
    const app = buildEnhancedWorkflow();
    
    const chunkState: any = {
      pdfPath: `${sourceFile}_chunk${chunkIndex}`,
      pdfBuffer: chunk.buffer,
      buildingData: {},
      totalPages: 0,
      pageImages: [],
      pageResults: [],
      categorizedImages: {
        cover: [],
        renderings: [],
        floorPlans: [],
        amenities: [],
        maps: [],
      },
      retryCount: 0,
      errors: [],
      warnings: [],
      startTime: Date.now(),
      processingStage: 'ingestion',
    };

    const result = await app.invoke(chunkState);

    // Return updates for parallel state (reducers will merge safely)
    return {
      buildingBasicInfo: {
        name: result.buildingData?.name,
        developer: result.buildingData?.developer,
        address: result.buildingData?.address,
        area: result.buildingData?.area,
        completionDate: result.buildingData?.completionDate,
        launchDate: result.buildingData?.launchDate,
        description: result.buildingData?.description,
      },
      rawUnits: result.buildingData?.units || [],
      rawPaymentPlans: result.buildingData?.paymentPlans || [],
      rawAmenities: result.buildingData?.amenities || [],
      chunksProcessed: 1,
      errors: result.errors || [],
      warnings: result.warnings || [],
    };

  } catch (error) {
    console.error(`   ✗ Chunk ${chunkIndex + 1} failed:`, error);
    return {
      chunksProcessed: 1,
      errors: [`Chunk ${chunkIndex + 1} failed: ${error}`],
    };
  }
}

/**
 * Create parallel processing map
 */
function createChunkProcessingMap(state: ParallelState): Send[] {
  const sends: Send[] = [];
  const chunks = state.chunks || [];

  // Create Send for each chunk (will be processed in parallel by LangGraph)
  for (let i = 0; i < chunks.length; i++) {
    sends.push(
      new Send('processChunk', {
        chunkIndex: i,
        chunk: chunks[i].chunk,
        sourceFile: chunks[i].sourceFile,
      })
    );
  }

  console.log(`\n📤 Dispatching ${sends.length} chunks for parallel processing...`);
  return sends;
}

/**
 * Aggregation node - deduplicate and finalize
 */
async function aggregateResultsNode(state: ParallelState): Promise<Partial<ParallelState>> {
  console.log('\n📊 Aggregating results from all chunks...');

  // Deduplicate units
  const uniqueUnits = deduplicateUnits(state.rawUnits || []);
  console.log(`   Units: ${state.rawUnits?.length || 0} → ${uniqueUnits.length} (after dedup)`);

  // Deduplicate amenities
  const uniqueAmenities = deduplicateAmenities(state.rawAmenities || []);
  console.log(`   Amenities: ${state.rawAmenities?.length || 0} → ${uniqueAmenities.length} (after dedup)`);

  // Select best payment plan
  const bestPaymentPlans = deduplicatePaymentPlans(state.rawPaymentPlans || []);
  console.log(`   Payment plans: ${state.rawPaymentPlans?.length || 0} → ${bestPaymentPlans.length} (best selected)`);

  return {
    buildingBasicInfo: {
      ...state.buildingBasicInfo,
      units: uniqueUnits,
      paymentPlans: bestPaymentPlans,
      amenities: uniqueAmenities,
    },
  };
}

/**
 * Build parallel processing graph
 */
function buildParallelGraph() {
  const workflow = new StateGraph(ParallelStateAnnotation);

  // Add chunk processor node
  (workflow as any).addNode('processChunk', processChunkNode);
  
  // Add aggregation node
  workflow.addNode('aggregate', aggregateResultsNode);

  // Start → fan out to parallel chunk processing
  (workflow as any).addConditionalEdges(
    '__start__',
    createChunkProcessingMap,
    ['processChunk']
  );

  // All chunks → aggregate
  (workflow as any).addEdge('processChunk', 'aggregate');
  
  // Aggregate → end
  (workflow as any).addEdge('aggregate', '__end__');

  return workflow.compile();
}

/**
 * Execute with parallel chunk processing
 * 
 * Processes up to `maxConcurrent` chunks at the same time
 */
export async function executeParallelWorkflow(config: ParallelConfig) {
  const startTime = Date.now();
  const { jobId, pdfBuffers, pdfNames, pagesPerChunk = 5 } = config;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`PARALLEL CHUNK WORKFLOW - Job ID: ${jobId}`);
  console.log(`Files: ${pdfBuffers.length} | Pages per chunk: ${pagesPerChunk}`);
  console.log(`Max concurrent: ${config.maxConcurrent || 10}`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    // Step 1: Split all PDFs into chunks
    progressEmitter.emit(jobId, {
      stage: 'ingestion',
      message: '📦 正在切分文档...',
      progress: 5,
      timestamp: Date.now(),
    });

    const allChunks: Array<{ chunk: PdfChunk; sourceFile: string }> = [];

    for (let i = 0; i < pdfBuffers.length; i++) {
      const fileName = pdfNames?.[i] || `Document ${i + 1}`;
      const chunks = await splitPdfIntoChunks(pdfBuffers[i], pagesPerChunk);
      
      chunks.forEach(chunk => {
        allChunks.push({ chunk, sourceFile: fileName });
      });
      
      console.log(`✓ ${fileName}: ${chunks.length} chunks`);
    }

    console.log(`\n📦 Total chunks: ${allChunks.length}`);

    progressEmitter.emit(jobId, {
      stage: 'mapping',
      message: `🚀 开始并行处理 ${allChunks.length} 个小块...`,
      progress: 10,
      timestamp: Date.now(),
    });

    // Step 2: Process chunks in batches (to limit concurrency)
    const maxConcurrent = config.maxConcurrent || 10;
    const batches = [];
    
    for (let i = 0; i < allChunks.length; i += maxConcurrent) {
      batches.push(allChunks.slice(i, i + maxConcurrent));
    }

    console.log(`📊 Processing in ${batches.length} batches (${maxConcurrent} chunks per batch)\n`);

    // Initial state
    const initialState: Partial<ParallelState> = {
      pdfPath: pdfNames?.[0] || 'combined',
      chunks: allChunks,
      buildingBasicInfo: {},
      rawUnits: [],
      rawPaymentPlans: [],
      rawAmenities: [],
      chunksProcessed: 0,
      errors: [],
      warnings: [],
    };

    // Build parallel graph
    const app = buildParallelGraph();

    // Process in batches to limit concurrency
    let processedChunks = 0;
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchProgress = 10 + ((batchIdx + 1) / batches.length) * 70;

      console.log(`--- Batch ${batchIdx + 1}/${batches.length} (${batch.length} chunks in parallel) ---`);

      // Update state for this batch
      const batchState = {
        ...initialState,
        chunks: batch,
      };

      // Execute parallel processing for this batch
      const batchResult = await app.invoke(batchState);

      // Accumulate results
      initialState.rawUnits!.push(...(batchResult.rawUnits || []));
      initialState.rawPaymentPlans!.push(...(batchResult.rawPaymentPlans || []));
      initialState.rawAmenities!.push(...(batchResult.rawAmenities || []));
      initialState.buildingBasicInfo = {
        ...initialState.buildingBasicInfo,
        ...batchResult.buildingBasicInfo,
      };

      processedChunks += batch.length;

      // Send progress with partial data
      progressEmitter.emit(jobId, {
        stage: 'mapping',
        message: `✓ 已处理 ${processedChunks}/${allChunks.length} 块`,
        progress: batchProgress,
        data: {
          buildingData: {
            ...initialState.buildingBasicInfo,
            units: deduplicateUnits(initialState.rawUnits!),
            amenities: deduplicateAmenities(initialState.rawAmenities!),
          },
        },
        timestamp: Date.now(),
      });

      console.log(`✓ Batch ${batchIdx + 1} complete (${processedChunks}/${allChunks.length} total)`);
    }

    // Step 3: Final deduplication
    console.log('\n📊 Final deduplication...');

    progressEmitter.emit(jobId, {
      stage: 'reducing',
      message: '📊 正在去重和整理数据...',
      progress: 85,
      timestamp: Date.now(),
    });

    const finalUnits = deduplicateUnits(initialState.rawUnits!);
    const finalAmenities = deduplicateAmenities(initialState.rawAmenities!);
    const finalPaymentPlans = deduplicatePaymentPlans(initialState.rawPaymentPlans!);

    console.log(`   ✓ Units: ${initialState.rawUnits!.length} → ${finalUnits.length}`);
    console.log(`   ✓ Amenities: ${initialState.rawAmenities!.length} → ${finalAmenities.length}`);

    const finalData = {
      ...initialState.buildingBasicInfo,
      units: finalUnits,
      paymentPlans: finalPaymentPlans,
      amenities: finalAmenities,
    };

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ PARALLEL WORKFLOW COMPLETED');
    console.log(`Time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`Chunks: ${allChunks.length} | Batches: ${batches.length}`);
    console.log(`${'='.repeat(70)}\n`);

    return {
      success: true,
      buildingData: finalData,
      processingTime,
      totalChunks: allChunks.length,
      batchesProcessed: batches.length,
      jobId,
    };

  } catch (error) {
    console.error('❌ PARALLEL WORKFLOW FAILED:', error);
    progressEmitter.error(jobId, String(error));

    return {
      success: false,
      buildingData: {},
      processingTime: Date.now() - startTime,
      errors: [String(error)],
      jobId,
    };
  }
}
