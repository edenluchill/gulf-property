/**
 * LangGraph Multi-Agent PDF Processor
 * 
 * Main exports for the LangGraph-based PDF processing system
 */

// Main executor
export { executePdfWorkflow, testWorkflow } from './executor';
export type { WorkflowConfig, WorkflowResult } from './executor';

// Direct PDF executor (NEW! No canvas needed)
export { executeDirectPdfWorkflow } from './executor-direct-pdf';
export type { DirectPdfWorkflowConfig } from './executor-direct-pdf';

// Graph builders
export { buildWorkflow, buildSimplifiedWorkflow } from './graph';
export { buildDirectPdfWorkflow } from './graph-direct-pdf';

// State types
export type { State, GlobalState, PageResult } from './state';
export { StateAnnotation } from './state';

// All agents
export { classifyPage, classifyPages } from '../agents/visual-classifier.agent';
export { extractFloorPlanDetails, extractFloorPlans } from '../agents/floor-plan-auditor.agent';
export { extractPaymentPlan, extractPaymentPlans, mergePaymentPlans } from '../agents/financial-structurer.agent';
export { researchMarketContext, generateInvestmentAnalysis } from '../agents/market-intelligence.agent';
export { generateMarketingContent } from '../agents/copywriter.agent';
export {
  validateBuildingData,
  shouldRetry,
  aggregateBuildingData,
  calculateBuildingStats,
  mergeDuplicateUnits,
} from '../agents/manager.agent';

// Utilities
export { pdfToImages, pdfPageToImage, getPdfPageCount } from '../utils/pdf/converter';
export {
  cropImage,
  resizeImage,
  organizeImages,
  imageToBase64,
  getImageDimensions,
  optimizeImage,
} from '../utils/pdf/image-processor';
export {
  createOutputStructure,
  cleanupDirectory,
  getFilesInDirectory,
  getFileSize,
  fileExists,
  generateJobId,
} from '../utils/pdf/file-manager';

// Schemas
export * from '../schemas/property.schema';
