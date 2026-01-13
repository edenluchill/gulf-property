/**
 * Parallel Processing State Annotation
 * 
 * Uses custom reducers to safely merge concurrent updates
 * Avoids race conditions when multiple agents update same state
 */

import { Annotation } from '@langchain/langgraph';

/**
 * Safe Array Reducer - Handles concurrent appends
 */
function safeArrayReducer<T>(current: T[] | undefined, update: T[]): T[] {
  return [...(current || []), ...update];
}

/**
 * Safe Object Merge Reducer - Handles concurrent updates
 */
function safeObjectMerge(current: any, update: any): any {
  if (!current) return update;
  if (!update) return current;
  
  // Prefer non-empty values
  const merged = { ...current };
  
  Object.entries(update).forEach(([key, value]) => {
    if (value != null && value !== '' && value !== 0) {
      merged[key] = value;
    }
  });
  
  return merged;
}

/**
 * Parallel Processing State
 * 
 * Thread-safe state management for concurrent chunk processing
 */
export const ParallelStateAnnotation = Annotation.Root({
  // Input
  pdfPath: Annotation<string>,
  chunks: Annotation<any[]>,
  
  // Basic building data - use safe merge
  buildingBasicInfo: Annotation<{
    name?: string;
    developer?: string;
    address?: string;
    area?: string;
    completionDate?: string;
    launchDate?: string;
    description?: string;
  }>({
    reducer: safeObjectMerge,
    default: () => ({}),
  }),
  
  // Units - append all, dedupe later
  rawUnits: Annotation<any[]>({
    reducer: safeArrayReducer,
    default: () => [],
  }),
  
  // Payment plans - append all
  rawPaymentPlans: Annotation<any[]>({
    reducer: safeArrayReducer,
    default: () => [],
  }),
  
  // Amenities - append all
  rawAmenities: Annotation<string[]>({
    reducer: safeArrayReducer,
    default: () => [],
  }),
  
  // Processing metadata
  chunksProcessed: Annotation<number>({
    reducer: (current, update) => (current || 0) + update,
    default: () => 0,
  }),
  
  errors: Annotation<string[]>({
    reducer: safeArrayReducer,
    default: () => [],
  }),
  
  warnings: Annotation<string[]>({
    reducer: safeArrayReducer,
    default: () => [],
  }),
});

export type ParallelState = typeof ParallelStateAnnotation.State;
