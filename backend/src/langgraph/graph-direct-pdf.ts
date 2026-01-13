/**
 * LangGraph Workflow - Direct PDF Processing
 * 
 * Simplified workflow that processes PDF directly with Gemini
 * WITHOUT requiring pdf-img-convert or canvas
 * 
 * This is faster and works on all platforms!
 */

import { StateGraph } from '@langchain/langgraph';
import { StateAnnotation } from './state';
import {
  directPdfProcessingNode,
  marketResearchNode,
  analysisNode,
  copywritingNode,
} from './nodes-direct-pdf';

/**
 * Build simplified workflow using direct PDF processing
 * 
 * Flow: PDF → Direct Processing → Market Research → Analysis → Copywriting
 */
export function buildDirectPdfWorkflow() {
  const workflow = new StateGraph(StateAnnotation);

  // Add nodes
  workflow.addNode('directProcessing', directPdfProcessingNode);
  workflow.addNode('marketResearch', marketResearchNode);
  workflow.addNode('analysis', analysisNode);
  workflow.addNode('copywriting', copywritingNode);

  // Setup workflow
  (workflow as any).setEntryPoint('directProcessing');
  (workflow as any).addEdge('directProcessing', 'marketResearch');
  (workflow as any).addEdge('marketResearch', 'analysis');
  (workflow as any).addEdge('analysis', 'copywriting');
  (workflow as any).setFinishPoint('copywriting');

  return workflow.compile();
}
