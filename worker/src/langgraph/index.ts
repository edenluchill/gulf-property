/**
 * LangGraph Multi-Agent PDF Processor
 * 
 * Main exports for the LangGraph-based PDF processing system
 */

// Main workflow executor
export { executePdfWorkflow } from './workflow-executor';
export type { WorkflowConfig, WorkflowResult } from './workflow-executor';

// State types
export type { State, GlobalState, PageResult } from './state';
export { StateAnnotation } from './state';

// Active agents (used in PDF upload workflow)
export { classifyPage } from './agents/page-classifier.agent';
export { extractUnitDetails } from './agents/unit-detail-extractor.agent';
export { extractAmenities } from './agents/amenity-extractor.agent';
export { extractProjectInfo } from './agents/project-info-extractor.agent';
export { extractPaymentPlan } from './agents/payment-plan-extractor.agent';
export { extractPricing } from './agents/pricing-extractor.agent';
export { generateProjectDescription } from './agents/project-description-generator.agent';

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
