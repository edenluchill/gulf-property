/**
 * LangGraph Workflow Definition
 * 
 * Orchestrates the Map-Reduce pipeline for PDF processing
 * with parallel page processing and sequential insight generation
 */

import { StateGraph, Send } from '@langchain/langgraph';
import { StateAnnotation, type State } from './state';
import {
  ingestionNode,
  pageProcessorNode,
  aggregationNode,
  marketResearchNode,
  analysisNode,
  copywritingNode,
  qualityCheckNode,
} from './nodes';

/**
 * Create the page processing map
 * 
 * This function is called after ingestion to fan out
 * parallel processing tasks for each page
 */
function createPageProcessingMap(state: State): Send[] {
  const sends: Send[] = [];

  // Create a Send for each page to process in parallel
  for (let i = 0; i < state.pageImages.length; i++) {
    sends.push(
      new Send('processPage', { pageIndex: i })
    );
  }

  console.log(`Creating ${sends.length} parallel page processing tasks`);
  return sends;
}

/**
 * Routing function after quality check
 * 
 * Decides whether to proceed or retry
 */
function routeAfterQualityCheck(state: State): string {
  // If retry is needed and we haven't exceeded max retries
  if (state.processingStage === 'mapping' && state.retryCount < 2) {
    return 'mapPages'; // Go back to map phase
  }
  
  // Otherwise proceed to market research
  return 'marketResearch';
}

/**
 * Build the LangGraph workflow
 */
export function buildWorkflow() {
  // Create the graph with state annotation
  const workflow = new StateGraph(StateAnnotation);

  // ===== PHASE 1: INGESTION =====
  workflow.addNode('ingestion', ingestionNode);

  // ===== PHASE 2: MAP (Parallel Processing) =====
  // Add a conditional edge that fans out to multiple parallel tasks
  (workflow as any).addNode('processPage', pageProcessorNode);

  // ===== PHASE 3: REDUCE (Aggregation) =====
  workflow.addNode('aggregation', aggregationNode);
  workflow.addNode('qualityCheck', qualityCheckNode);

  // ===== PHASE 4: INSIGHT (Sequential) =====
  workflow.addNode('marketResearch', marketResearchNode);
  workflow.addNode('analysis', analysisNode);
  workflow.addNode('copywriting', copywritingNode);

  // ===== EDGES =====
  
  // Start with ingestion
  (workflow as any).setEntryPoint('ingestion');

  // After ingestion, fan out to parallel page processing
  (workflow as any).addConditionalEdges(
    'ingestion',
    createPageProcessingMap,
    ['processPage']
  );

  // All page processors converge to aggregation
  (workflow as any).addEdge('processPage', 'aggregation');

  // After aggregation, do quality check
  (workflow as any).addEdge('aggregation', 'qualityCheck');

  // Conditional routing after quality check
  (workflow as any).addConditionalEdges(
    'qualityCheck',
    routeAfterQualityCheck,
    {
      mapPages: 'ingestion', // Retry from ingestion (though ideally we'd skip conversion)
      marketResearch: 'marketResearch',
    }
  );

  // Linear flow through insight phase
  (workflow as any).addEdge('marketResearch', 'analysis');
  (workflow as any).addEdge('analysis', 'copywriting');

  // End after copywriting
  (workflow as any).setFinishPoint('copywriting');

  return workflow.compile();
}

/**
 * Alternative: Build a simplified workflow (without retries)
 * 
 * Use this for faster processing when data quality is less critical
 */
export function buildSimplifiedWorkflow() {
  const workflow = new StateGraph(StateAnnotation);

  // Nodes
  workflow.addNode('ingestion', ingestionNode);
  (workflow as any).addNode('processPage', pageProcessorNode);
  workflow.addNode('aggregation', aggregationNode);
  workflow.addNode('marketResearch', marketResearchNode);
  workflow.addNode('copywriting', copywritingNode);

  // Edges
  (workflow as any).setEntryPoint('ingestion');
  
  // Fan out to parallel processing
  (workflow as any).addConditionalEdges(
    'ingestion',
    createPageProcessingMap,
    ['processPage']
  );

  (workflow as any).addEdge('processPage', 'aggregation');
  (workflow as any).addEdge('aggregation', 'marketResearch');
  (workflow as any).addEdge('marketResearch', 'copywriting');
  (workflow as any).setFinishPoint('copywriting');

  return workflow.compile();
}
