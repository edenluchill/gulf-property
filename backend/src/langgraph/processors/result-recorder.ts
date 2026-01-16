/**
 * Result Recorder Module
 * 
 * Records detailed analysis results for debugging and verification:
 * - Page-level classification
 * - Extracted data per page
 * - Images categorization
 * - Processing metadata
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface PageAnalysisResult {
  pageNumber: number;
  chunkIndex: number;
  sourceFile: string;
  classification?: string;  // Cover, FloorPlan, Rendering, etc.
  hasFloorPlan: boolean;
  hasBuilding: boolean;
  hasProjectImages: boolean;
  hasFloorPlanImages: boolean;
  extractedUnits: number;
  extractedPaymentPlans: number;
  extractedData?: any;  // Raw data from this page
  processingTime?: number;
  errors?: string[];
  
  // New: Image information
  hasImages?: boolean;
  images?: Array<{
    imagePath: string;
    category: string;
    linkedUnitType?: string;
    description?: string;
  }>;
}

export interface ChunkAnalysisResult {
  chunkIndex: number;
  sourceFile: string;
  pageRange: { start: number; end: number };
  totalUnits: number;
  totalPaymentPlans: number;
  pages: PageAnalysisResult[];
  images: {
    projectImages: string[];
    floorPlanImages: string[];
    allImages?: string[];  // All extracted images
    byCategory?: Record<string, string[]>;  // Images grouped by category
  };
  processingTime: number;
  errors: string[];
}

export interface FullAnalysisResult {
  jobId: string;
  timestamp: string;
  inputFiles: string[];
  totalChunks: number;
  totalPages: number;
  processingTime: number;
  
  // Aggregated summary
  summary: {
    totalUnits: number;
    totalPaymentPlans: number;
    totalAmenities: number;
    totalProjectImages: number;
    totalFloorPlanImages: number;
    pagesWithFloorPlans: number;
    pagesWithBuildingImages: number;
  };
  
  // Detailed chunk-by-chunk results
  chunks: ChunkAnalysisResult[];
  
  // Final merged data
  finalData: any;
  
  // Processing metadata
  metadata: {
    pagesPerChunk: number;
    batchSize: number;
    batchDelay: number;
    errors: string[];
    warnings: string[];
  };
}

/**
 * Result recorder to track analysis progress
 */
export class ResultRecorder {
  private jobId: string;
  private outputDir: string;
  private inputFiles: string[];
  private startTime: number;
  private chunks: ChunkAnalysisResult[] = [];
  private metadata: any = {};
  
  constructor(jobId: string, outputDir: string, inputFiles: string[]) {
    this.jobId = jobId;
    this.outputDir = outputDir;
    this.inputFiles = inputFiles;
    this.startTime = Date.now();
  }
  
  /**
   * Record a chunk's analysis result
   */
  recordChunk(chunkResult: ChunkAnalysisResult): void {
    this.chunks.push(chunkResult);
  }
  
  /**
   * Set processing metadata
   */
  setMetadata(metadata: any): void {
    this.metadata = metadata;
  }
  
  /**
   * Generate and save full analysis report
   */
  saveFullReport(finalData: any, errors: string[], warnings: string[]): string {
    const processingTime = Date.now() - this.startTime;
    
    // Calculate summary statistics
    const summary = {
      totalUnits: finalData.units?.length || 0,
      totalPaymentPlans: finalData.paymentPlans?.length || 0,
      totalAmenities: finalData.amenities?.length || 0,
      totalProjectImages: finalData.images?.projectImages?.length || 0,
      totalFloorPlanImages: finalData.images?.floorPlanImages?.length || 0,
      pagesWithFloorPlans: 0,
      pagesWithBuildingImages: 0,
    };
    
    // Count pages by type
    this.chunks.forEach(chunk => {
      chunk.pages?.forEach(page => {
        if (page.hasFloorPlan) summary.pagesWithFloorPlans++;
        if (page.hasProjectImages) summary.pagesWithBuildingImages++;
      });
    });
    
    const fullResult: FullAnalysisResult = {
      jobId: this.jobId,
      timestamp: new Date().toISOString(),
      inputFiles: this.inputFiles,
      totalChunks: this.chunks.length,
      totalPages: this.chunks.reduce((sum, c) => sum + (c.pageRange.end - c.pageRange.start + 1), 0),
      processingTime,
      summary,
      chunks: this.chunks,
      finalData,
      metadata: {
        ...this.metadata,
        errors,
        warnings,
      },
    };
    
    // Ensure output directory exists
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Save full report
    const reportPath = join(this.outputDir, `analysis-report-${this.jobId}.json`);
    writeFileSync(reportPath, JSON.stringify(fullResult, null, 2), 'utf-8');
    
    console.log(`\n📊 Analysis report saved: ${reportPath}`);
    
    // Also save a human-readable summary
    this.saveHumanReadableSummary(fullResult);
    
    return reportPath;
  }
  
  /**
   * Save human-readable summary (easier to read than JSON)
   */
  private saveHumanReadableSummary(result: FullAnalysisResult): void {
    const lines: string[] = [];
    
    lines.push('='.repeat(80));
    lines.push(`PDF ANALYSIS REPORT - Job ${result.jobId}`);
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Timestamp: ${result.timestamp}`);
    lines.push(`Processing Time: ${(result.processingTime / 1000).toFixed(2)}s`);
    lines.push('');
    
    lines.push('📄 INPUT FILES:');
    result.inputFiles.forEach((file, i) => {
      lines.push(`  ${i + 1}. ${file}`);
    });
    lines.push('');
    
    lines.push('📊 SUMMARY:');
    lines.push(`  Total Chunks: ${result.totalChunks}`);
    lines.push(`  Total Pages: ${result.totalPages}`);
    lines.push(`  Units Found: ${result.summary.totalUnits}`);
    lines.push(`  Payment Plans: ${result.summary.totalPaymentPlans}`);
    lines.push(`  Amenities: ${result.summary.totalAmenities}`);
    lines.push(`  Project Images: ${result.summary.totalProjectImages}`);
    lines.push(`  Floor Plan Images: ${result.summary.totalFloorPlanImages}`);
    lines.push(`  Pages with Floor Plans: ${result.summary.pagesWithFloorPlans}`);
    lines.push(`  Pages with Building Images: ${result.summary.pagesWithBuildingImages}`);
    lines.push('');
    
    lines.push('📦 CHUNK-BY-CHUNK ANALYSIS:');
    lines.push('');
    
    result.chunks.forEach((chunk, idx) => {
      lines.push(`Chunk ${idx + 1}: ${chunk.sourceFile}`);
      lines.push(`  Page Range: ${chunk.pageRange.start}-${chunk.pageRange.end}`);
      lines.push(`  Units Found: ${chunk.totalUnits}`);
      lines.push(`  Payment Plans: ${chunk.totalPaymentPlans}`);
      lines.push(`  Processing Time: ${(chunk.processingTime / 1000).toFixed(2)}s`);
      
      if (chunk.pages && chunk.pages.length > 0) {
        lines.push(`  Pages:`);
        chunk.pages.forEach(page => {
          const features: string[] = [];
          if (page.hasFloorPlan) features.push('Floor Plan');
          if (page.hasBuilding) features.push('Building');
          if (page.hasProjectImages) features.push('Project Images');
          if (page.hasFloorPlanImages) features.push('Floor Plan Images');
          if (page.extractedUnits > 0) features.push(`${page.extractedUnits} units`);
          
          const classification = page.classification ? `[${page.classification}]` : '';
          const featureStr = features.length > 0 ? features.join(', ') : 'No special content';
          
          lines.push(`    Page ${page.pageNumber} ${classification}: ${featureStr}`);
        });
      }
      
      if (chunk.errors.length > 0) {
        lines.push(`  ⚠️ Errors: ${chunk.errors.join(', ')}`);
      }
      
      lines.push('');
    });
    
    if (result.metadata.errors.length > 0) {
      lines.push('❌ ERRORS:');
      result.metadata.errors.forEach(err => lines.push(`  - ${err}`));
      lines.push('');
    }
    
    if (result.metadata.warnings.length > 0) {
      lines.push('⚠️ WARNINGS:');
      result.metadata.warnings.forEach(warn => lines.push(`  - ${warn}`));
      lines.push('');
    }
    
    lines.push('='.repeat(80));
    
    const summaryPath = join(this.outputDir, `analysis-summary-${result.jobId}.txt`);
    writeFileSync(summaryPath, lines.join('\n'), 'utf-8');
    
    console.log(`📄 Human-readable summary saved: ${summaryPath}`);
  }
}

/**
 * Extract page-level analysis from chunk result
 */
export function extractPageAnalysis(
  chunkIndex: number,
  sourceFile: string,
  pageRange: { start: number; end: number },
  chunkData: any
): PageAnalysisResult[] {
  const pages: PageAnalysisResult[] = [];
  
  // If we have page-level results, use them
  if (chunkData.pageResults && Array.isArray(chunkData.pageResults)) {
    chunkData.pageResults.forEach((pageResult: any, idx: number) => {
      const pageNumber = pageRange.start + idx;
      
      pages.push({
        pageNumber,
        chunkIndex,
        sourceFile,
        classification: pageResult.classification,
        hasFloorPlan: pageResult.classification === 'FloorPlan' || 
                       (pageResult.extractedData?.units && pageResult.extractedData.units.length > 0),
        hasBuilding: pageResult.classification === 'Rendering' || pageResult.classification === 'Cover',
        hasProjectImages: pageResult.images?.projectImages?.length > 0,
        hasFloorPlanImages: pageResult.images?.floorPlanImages?.length > 0,
        extractedUnits: pageResult.extractedData?.units?.length || 0,
        extractedPaymentPlans: pageResult.extractedData?.paymentPlans?.length || 0,
        extractedData: pageResult.extractedData,
        processingTime: pageResult.processingTime,
        errors: pageResult.errors || [],
      });
    });
  } else {
    // Fallback: estimate from chunk-level data
    const numPages = pageRange.end - pageRange.start + 1;
    const unitsPerPage = chunkData.units ? Math.ceil(chunkData.units.length / numPages) : 0;
    
    for (let i = 0; i < numPages; i++) {
      const pageNumber = pageRange.start + i;
      
      pages.push({
        pageNumber,
        chunkIndex,
        sourceFile,
        hasFloorPlan: chunkData.units && chunkData.units.length > 0,
        hasBuilding: chunkData.images?.projectImages?.length > 0,
        hasProjectImages: chunkData.images?.projectImages?.length > 0,
        hasFloorPlanImages: chunkData.images?.floorPlanImages?.length > 0,
        extractedUnits: i === 0 ? (chunkData.units?.length || 0) : 0,  // All units on first page
        extractedPaymentPlans: i === 0 ? (chunkData.paymentPlans?.length || 0) : 0,
      });
    }
  }
  
  return pages;
}
