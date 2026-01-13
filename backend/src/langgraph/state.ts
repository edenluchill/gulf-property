/**
 * LangGraph State Definition
 * 
 * Defines the global state that flows through the agent workflow.
 * Uses Annotation for type-safe state management in LangGraph.
 */

import { Annotation } from '@langchain/langgraph';
import type {
  BuildingData,
  MarketContext,
  AnalysisReport,
  MarketingContent,
  PageCategory,
} from '../schemas/property.schema';

/**
 * Page Processing Result
 */
export interface PageResult {
  pageNumber: number;
  imagePath: string;
  category: PageCategory;
  confidence: number;
  extractedData: any; // Type depends on category
  error?: string;
}

/**
 * Global State for the PDF Processing Workflow
 * 
 * This state flows through all nodes in the LangGraph
 */
export interface GlobalState {
  // Input
  pdfPath: string;
  pdfBuffer?: Buffer;
  outputDir: string;
  
  // PDF Processing
  totalPages: number;
  pageImages: string[]; // Paths to converted page images
  
  // Map Phase: Individual page results (populated in parallel)
  pageResults: PageResult[];
  
  // Reduce Phase: Aggregated building data
  buildingData: Partial<BuildingData>;
  
  // Insight Phase: External data and analysis
  marketContext?: MarketContext;
  analysisReport?: AnalysisReport;
  marketingContent?: MarketingContent;
  
  // Organized extracted images by category
  categorizedImages: {
    cover: string[];
    renderings: string[];
    floorPlans: string[];
    amenities: string[];
    maps: string[];
  };
  
  // Quality & Error handling
  retryCount: number;
  errors: string[];
  warnings: string[];
  
  // Processing metadata
  startTime: number;
  processingStage: 'ingestion' | 'mapping' | 'reducing' | 'insight' | 'complete' | 'error';
}

/**
 * LangGraph State Annotation
 * 
 * Defines how state updates are merged during the workflow
 */
export const StateAnnotation = Annotation.Root({
  // Input
  pdfPath: Annotation<string>,
  pdfBuffer: Annotation<Buffer | undefined>,
  outputDir: Annotation<string>,
  
  // PDF Processing
  totalPages: Annotation<number>,
  pageImages: Annotation<string[]>({
    reducer: (current, update) => [...(current || []), ...update],
    default: () => [],
  }),
  
  // Map Phase results - append new results
  pageResults: Annotation<PageResult[]>({
    reducer: (current, update) => [...(current || []), ...update],
    default: () => [],
  }),
  
  // Reduce Phase - merge building data
  buildingData: Annotation<Partial<BuildingData>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  
  // Insight Phase
  marketContext: Annotation<MarketContext | undefined>,
  analysisReport: Annotation<AnalysisReport | undefined>,
  marketingContent: Annotation<MarketingContent | undefined>,
  
  // Categorized images - merge by category
  categorizedImages: Annotation<{
    cover: string[];
    renderings: string[];
    floorPlans: string[];
    amenities: string[];
    maps: string[];
  }>({
    reducer: (current, update) => ({
      cover: [...(current?.cover || []), ...(update?.cover || [])],
      renderings: [...(current?.renderings || []), ...(update?.renderings || [])],
      floorPlans: [...(current?.floorPlans || []), ...(update?.floorPlans || [])],
      amenities: [...(current?.amenities || []), ...(update?.amenities || [])],
      maps: [...(current?.maps || []), ...(update?.maps || [])],
    }),
    default: () => ({
      cover: [],
      renderings: [],
      floorPlans: [],
      amenities: [],
      maps: [],
    }),
  }),
  
  // Error handling
  retryCount: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  errors: Annotation<string[]>({
    reducer: (current, update) => [...(current || []), ...update],
    default: () => [],
  }),
  warnings: Annotation<string[]>({
    reducer: (current, update) => [...(current || []), ...update],
    default: () => [],
  }),
  
  // Processing metadata
  startTime: Annotation<number>,
  processingStage: Annotation<'ingestion' | 'mapping' | 'reducing' | 'insight' | 'complete' | 'error'>({
    reducer: (_, update) => update,
    default: () => 'ingestion' as const,
  }),
});

/**
 * Type inference from annotation
 */
export type State = typeof StateAnnotation.State;
