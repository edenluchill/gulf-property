/**
 * Enhanced LangGraph Workflow
 * 
 * Supports:
 * - Image extraction from PDF
 * - Unit grouping by category
 * - Multiple document processing
 */

import { StateGraph } from '@langchain/langgraph';
import { StateAnnotation } from './state';
import {
  enhancedDirectPdfProcessingNode,
  marketResearchNode,
  analysisNode,
  copywritingNode,
} from './nodes-direct-pdf-enhanced';

/**
 * Build enhanced workflow with image extraction
 */
export function buildEnhancedWorkflow() {
  const workflow = new StateGraph(StateAnnotation);

  // Add nodes
  workflow.addNode('enhancedProcessing', enhancedDirectPdfProcessingNode);
  workflow.addNode('marketResearch', marketResearchNode);
  workflow.addNode('analysis', analysisNode);
  workflow.addNode('copywriting', copywritingNode);

  // Setup workflow
  (workflow as any).setEntryPoint('enhancedProcessing');
  (workflow as any).addEdge('enhancedProcessing', 'marketResearch');
  (workflow as any).addEdge('marketResearch', 'analysis');
  (workflow as any).addEdge('analysis', 'copywriting');
  (workflow as any).setFinishPoint('copywriting');

  return workflow.compile();
}
