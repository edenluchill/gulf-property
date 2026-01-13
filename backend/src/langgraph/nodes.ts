/**
 * LangGraph Node Functions
 * 
 * Individual processing nodes in the workflow
 */

import type { State } from './state';
import { pdfToImages } from '../utils/pdf/converter';
import { classifyPage } from '../agents/visual-classifier.agent';
import { extractFloorPlanDetails } from '../agents/floor-plan-auditor.agent';
import { extractPaymentPlan } from '../agents/financial-structurer.agent';
import { researchMarketContext, generateInvestmentAnalysis } from '../agents/market-intelligence.agent';
import { generateMarketingContent } from '../agents/copywriter.agent';
import {
  validateBuildingData,
  shouldRetry,
  aggregateBuildingData,
} from '../agents/manager.agent';
import type { PageResult } from './state';

/**
 * INGESTION NODE
 * Convert PDF to page images
 */
export async function ingestionNode(state: State): Promise<Partial<State>> {
  console.log('=== INGESTION PHASE ===');
  console.log(`Processing PDF: ${state.pdfPath}`);

  try {
    // Convert PDF to images
    const pageImages = await pdfToImages(
      state.pdfBuffer!,
      state.outputDir
    );

    console.log(`✓ Converted ${pageImages.length} pages to images`);

    return {
      pageImages,
      totalPages: pageImages.length,
      processingStage: 'mapping',
    };
  } catch (error) {
    console.error('Error in ingestion:', error);
    return {
      errors: [`Ingestion failed: ${error}`],
      processingStage: 'error',
    };
  }
}

/**
 * PAGE PROCESSOR NODE (runs in parallel for each page)
 * Classify and extract data from a single page
 */
export async function pageProcessorNode(
  state: State,
  config: { pageIndex: number }
): Promise<Partial<State>> {
  const { pageIndex } = config;
  const imagePath = state.pageImages[pageIndex];
  const pageNumber = pageIndex + 1;

  console.log(`Processing page ${pageNumber}...`);

  try {
    // 1. Classify the page
    const classification = await classifyPage(imagePath, pageNumber);

    const result: PageResult = {
      pageNumber,
      imagePath,
      category: classification.category,
      confidence: classification.confidence,
      extractedData: null,
    };

    // 2. Extract data based on category
    if (classification.category === 'FloorPlan' && classification.confidence > 0.6) {
      console.log(`  → Extracting floor plan details from page ${pageNumber}`);
      const units = await extractFloorPlanDetails(imagePath, pageNumber);
      result.extractedData = { units };
      
      // Categorize image
      return {
        pageResults: [result],
        categorizedImages: {
          cover: [],
          renderings: [],
          floorPlans: [imagePath],
          amenities: [],
          maps: [],
        },
      };
    } 
    else if (classification.category === 'PaymentPlan' && classification.confidence > 0.6) {
      console.log(`  → Extracting payment plan from page ${pageNumber}`);
      const paymentPlan = await extractPaymentPlan(imagePath, pageNumber);
      result.extractedData = { paymentPlan };
      
      return {
        pageResults: [result],
      };
    }
    else if (classification.category === 'Rendering') {
      return {
        pageResults: [result],
        categorizedImages: {
          cover: [],
          renderings: [imagePath],
          floorPlans: [],
          amenities: [],
          maps: [],
        },
      };
    }
    else if (classification.category === 'Cover') {
      return {
        pageResults: [result],
        categorizedImages: {
          cover: [imagePath],
          renderings: [],
          floorPlans: [],
          amenities: [],
          maps: [],
        },
      };
    }
    else if (classification.category === 'Amenities') {
      return {
        pageResults: [result],
        categorizedImages: {
          cover: [],
          renderings: [],
          floorPlans: [],
          amenities: [imagePath],
          maps: [],
        },
      };
    }
    else if (classification.category === 'LocationMap') {
      return {
        pageResults: [result],
        categorizedImages: {
          cover: [],
          renderings: [],
          floorPlans: [],
          amenities: [],
          maps: [imagePath],
        },
      };
    }

    // Default: just add the result
    return {
      pageResults: [result],
    };
  } catch (error) {
    console.error(`Error processing page ${pageNumber}:`, error);
    return {
      pageResults: [{
        pageNumber,
        imagePath,
        category: 'Unknown',
        confidence: 0,
        extractedData: null,
        error: String(error),
      }],
      warnings: [`Page ${pageNumber} processing failed: ${error}`],
    };
  }
}

/**
 * AGGREGATION NODE (Reduce phase)
 * Merge all page results into complete building data
 */
export async function aggregationNode(state: State): Promise<Partial<State>> {
  console.log('=== REDUCE PHASE: AGGREGATION ===');
  console.log(`Aggregating ${state.pageResults.length} page results`);

  try {
    // Collect all units from floor plan pages
    const allUnits = state.pageResults
      .filter(page => page.category === 'FloorPlan')
      .flatMap(page => page.extractedData?.units || []);

    console.log(`Found ${allUnits.length} unit types across all pages`);

    // Collect all payment plans
    const allPaymentPlans = state.pageResults
      .filter(page => page.category === 'PaymentPlan')
      .map(page => page.extractedData?.paymentPlan)
      .filter(plan => plan !== null && plan !== undefined);

    console.log(`Found ${allPaymentPlans.length} payment plans`);

    // Aggregate building data
    const buildingData = aggregateBuildingData(
      [state.buildingData],
      allUnits,
      allPaymentPlans
    );

    // Quality check
    const issues = validateBuildingData(buildingData);
    
    if (issues.length > 0) {
      console.log('⚠ Data quality issues found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('✓ Data quality check passed');
    }

    return {
      buildingData,
      warnings: issues,
      processingStage: 'reducing',
    };
  } catch (error) {
    console.error('Error in aggregation:', error);
    return {
      errors: [`Aggregation failed: ${error}`],
      processingStage: 'error',
    };
  }
}

/**
 * MARKET RESEARCH NODE (Insight phase)
 * Gather external market intelligence
 */
export async function marketResearchNode(state: State): Promise<Partial<State>> {
  console.log('=== INSIGHT PHASE: MARKET RESEARCH ===');

  try {
    const { buildingData } = state;

    if (!buildingData.name || !buildingData.address) {
      console.log('⚠ Skipping market research - insufficient building info');
      return {
        warnings: ['Market research skipped - missing building name or address'],
      };
    }

    // Research market context
    const marketContext = await researchMarketContext(
      buildingData.name,
      buildingData.address,
      buildingData.area || 'Dubai'
    );

    console.log('✓ Market research completed');

    return {
      marketContext,
      processingStage: 'insight',
    };
  } catch (error) {
    console.error('Error in market research:', error);
    return {
      warnings: [`Market research failed: ${error}`],
    };
  }
}

/**
 * ANALYSIS NODE
 * Generate investment analysis report
 */
export async function analysisNode(state: State): Promise<Partial<State>> {
  console.log('=== INSIGHT PHASE: ANALYSIS ===');

  try {
    const { buildingData, marketContext } = state;

    if (!marketContext) {
      console.log('⚠ Skipping analysis - no market context available');
      return {};
    }

    // Calculate average price per sqft
    const avgPriceSqft = buildingData.units && buildingData.units.length > 0
      ? buildingData.units
          .filter(u => u.price && u.area)
          .map(u => u.price! / u.area)
          .reduce((sum, val) => sum + val, 0) / buildingData.units.length
      : undefined;

    // Generate analysis
    const analysisText = await generateInvestmentAnalysis(
      buildingData.name || 'Development',
      marketContext,
      buildingData.units?.length || 0,
      avgPriceSqft
    );

    const analysisReport = {
      summary: analysisText,
      strengths: [
        ...(marketContext.nearbyMetroStations.length > 0 ? ['Excellent connectivity with nearby metro'] : []),
        ...(marketContext.areaInsights?.demandLevel === 'High' ? ['High demand area'] : []),
        ...(buildingData.amenities && buildingData.amenities.length > 5 ? ['Comprehensive amenities'] : []),
      ],
      considerations: [
        ...(marketContext.competitorProjects.length > 3 ? ['High competition in the area'] : []),
      ],
      recommendedFor: ['First-time buyers', 'Investors', 'Families'],
      appreciationPotential: marketContext.areaInsights?.demandLevel === 'High' ? 'High' as const : 'Medium' as const,
    };

    console.log('✓ Investment analysis completed');

    return {
      analysisReport,
    };
  } catch (error) {
    console.error('Error in analysis:', error);
    return {
      warnings: [`Analysis failed: ${error}`],
    };
  }
}

/**
 * COPYWRITING NODE
 * Generate marketing content
 */
export async function copywritingNode(state: State): Promise<Partial<State>> {
  console.log('=== INSIGHT PHASE: COPYWRITING ===');

  try {
    const { buildingData, analysisReport } = state;

    // Generate marketing content
    const marketingContent = await generateMarketingContent(
      buildingData,
      analysisReport?.summary
    );

    console.log('✓ Marketing content generated');

    return {
      marketingContent,
      processingStage: 'complete',
    };
  } catch (error) {
    console.error('Error in copywriting:', error);
    return {
      warnings: [`Copywriting failed: ${error}`],
      processingStage: 'complete', // Still mark as complete
    };
  }
}

/**
 * QUALITY CHECK NODE
 * Validate final output and decide if retry is needed
 */
export async function qualityCheckNode(state: State): Promise<Partial<State>> {
  console.log('=== QUALITY CHECK ===');

  const issues = validateBuildingData(state.buildingData);

  if (shouldRetry(state.buildingData, state.retryCount, 2)) {
    console.log('⚠ Quality check failed - retry needed');
    return {
      retryCount: state.retryCount + 1,
      warnings: ['Retrying due to incomplete data', ...issues],
      processingStage: 'mapping', // Go back to mapping phase
    };
  }

  console.log('✓ Quality check passed (or max retries reached)');
  
  return {
    warnings: issues,
  };
}
