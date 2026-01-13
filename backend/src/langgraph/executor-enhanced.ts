/**
 * Enhanced PDF Workflow Executor
 * 
 * Supports:
 * - Multiple PDF documents
 * - Image extraction
 * - Unit categorization
 */

import { buildEnhancedWorkflow } from './graph-enhanced';
import type { State } from './state';
import { generateJobId, createOutputStructure } from '../utils/pdf/file-manager';
import { join } from 'path';

export interface EnhancedWorkflowConfig {
  pdfBuffers: Buffer[];  // Support multiple PDFs
  pdfPaths?: string[];
  outputBaseDir?: string;
}

export interface WorkflowResult {
  success: boolean;
  buildingData: any;
  marketContext?: any;
  analysisReport?: any;
  marketingContent?: any;
  processingTime: number;
  errors: string[];
  warnings: string[];
  jobId: string;
  documentsProcessed: number;
}

/**
 * Execute enhanced workflow with multiple documents
 */
export async function executeEnhancedWorkflow(
  config: EnhancedWorkflowConfig
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const jobId = generateJobId();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`ENHANCED WORKFLOW - Job ID: ${jobId}`);
  console.log(`Processing ${config.pdfBuffers.length} document(s)`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Check file sizes (Gemini has ~20MB limit per file)
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    for (let i = 0; i < config.pdfBuffers.length; i++) {
      const size = config.pdfBuffers[i].length;
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      
      if (size > MAX_FILE_SIZE) {
        console.error(`⚠️ Document ${i + 1} (${sizeMB} MB) exceeds Gemini's 20MB limit`);
        return {
          success: false,
          buildingData: {},
          processingTime: 0,
          errors: [`文档 ${i + 1} 太大 (${sizeMB} MB)。Gemini 限制单文件 20MB。请分割 PDF 或使用更小的文件。`],
          warnings: [],
          jobId,
          documentsProcessed: 0,
        };
      }
    }

    const outputBaseDir = config.outputBaseDir || join(process.cwd(), 'uploads', 'langgraph-output');
    const outputStructure = createOutputStructure(outputBaseDir, jobId);

    // Process each PDF and merge results
    const allResults: any[] = [];

    for (let i = 0; i < config.pdfBuffers.length; i++) {
      const sizeMB = (config.pdfBuffers[i].length / 1024 / 1024).toFixed(2);
      console.log(`\n--- Processing document ${i + 1}/${config.pdfBuffers.length} (${sizeMB} MB) ---`);

      const initialState: Partial<State> = {
        pdfPath: config.pdfPaths?.[i] || `document_${i + 1}.pdf`,
        pdfBuffer: config.pdfBuffers[i],
        outputDir: outputStructure.jobDir,
        totalPages: 0,
        pageImages: [],
        pageResults: [],
        buildingData: {},
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

      const app = buildEnhancedWorkflow();
      const finalState = await app.invoke(initialState);
      
      allResults.push(finalState);
      console.log(`✓ Document ${i + 1} processed`);
    }

    // Merge results from all documents
    const mergedData = mergeDocumentResults(allResults);

    const processingTime = Date.now() - startTime;

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ ALL DOCUMENTS PROCESSED');
    console.log(`Processing Time: ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`Documents: ${config.pdfBuffers.length}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log('📊 MERGED SUMMARY:');
    console.log(`  Units Extracted: ${mergedData.buildingData?.units?.length || 0}`);
    console.log(`  Payment Plans: ${mergedData.buildingData?.paymentPlans?.length || 0}`);
    console.log(`  Amenities: ${mergedData.buildingData?.amenities?.length || 0}`);

    return {
      success: true,
      buildingData: mergedData.buildingData,
      marketContext: mergedData.marketContext,
      analysisReport: mergedData.analysisReport,
      marketingContent: mergedData.marketingContent,
      processingTime,
      errors: mergedData.errors || [],
      warnings: mergedData.warnings || [],
      jobId,
      documentsProcessed: config.pdfBuffers.length,
    };

  } catch (error) {
    console.error('❌ ENHANCED WORKFLOW FAILED:', error);

    return {
      success: false,
      buildingData: {},
      processingTime: Date.now() - startTime,
      errors: [String(error)],
      warnings: [],
      jobId,
      documentsProcessed: 0,
    };
  }
}

/**
 * Merge results from multiple documents
 */
function mergeDocumentResults(results: any[]): any {
  if (results.length === 0) return {};
  if (results.length === 1) return results[0];

  // Merge strategy:
  // - Take building info from first doc (usually main brochure)
  // - Combine units from all docs
  // - Combine payment plans from all docs
  // - Merge amenities (deduplicate)

  const merged: any = {
    buildingData: {},
    errors: [],
    warnings: [],
  };

  // Take basic info from first document
  const firstDoc = results[0];
  merged.buildingData = {
    name: firstDoc.buildingData?.name || '',
    developer: firstDoc.buildingData?.developer || '',
    address: firstDoc.buildingData?.address || '',
    area: firstDoc.buildingData?.area,
    completionDate: firstDoc.buildingData?.completionDate,
    launchDate: firstDoc.buildingData?.launchDate,
    description: firstDoc.buildingData?.description || '',
    amenities: [],
    units: [],
    paymentPlans: [],
  };

  // Merge units from all documents
  const allUnits: any[] = [];
  const allPaymentPlans: any[] = [];
  const allAmenities = new Set<string>();

  for (const result of results) {
    if (result.buildingData?.units) {
      allUnits.push(...result.buildingData.units);
    }
    if (result.buildingData?.paymentPlans) {
      allPaymentPlans.push(...result.buildingData.paymentPlans);
    }
    if (result.buildingData?.amenities) {
      result.buildingData.amenities.forEach((a: string) => allAmenities.add(a));
    }
    if (result.errors) {
      merged.errors.push(...result.errors);
    }
    if (result.warnings) {
      merged.warnings.push(...result.warnings);
    }
  }

  // Deduplicate units by category + typeName
  merged.buildingData.units = deduplicateUnits(allUnits);
  merged.buildingData.paymentPlans = allPaymentPlans;
  merged.buildingData.amenities = Array.from(allAmenities);

  // Take market context and analysis from first doc
  merged.marketContext = firstDoc.marketContext;
  merged.analysisReport = firstDoc.analysisReport;
  merged.marketingContent = firstDoc.marketingContent;

  return merged;
}

/**
 * Deduplicate units
 */
function deduplicateUnits(units: any[]): any[] {
  const seen = new Map<string, any>();

  for (const unit of units) {
    const key = `${unit.category || unit.bedrooms}_${unit.typeName || 'default'}`;
    
    if (!seen.has(key)) {
      seen.set(key, unit);
    } else {
      // Merge data (prefer non-null values)
      const existing = seen.get(key);
      seen.set(key, {
        ...existing,
        ...Object.fromEntries(
          Object.entries(unit).filter(([_, v]) => v != null)
        ),
      });
    }
  }

  return Array.from(seen.values());
}
