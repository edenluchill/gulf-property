/**
 * Test Script for LangGraph PDF Processor
 * 
 * Usage:
 *   ts-node test-langgraph.ts <path-to-pdf>
 * 
 * Example:
 *   ts-node test-langgraph.ts ./sample-brochure.pdf
 */

import { testWorkflow } from './src/langgraph/executor';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Please provide a PDF file path');
    console.log('\nUsage:');
    console.log('  ts-node test-langgraph.ts <path-to-pdf>');
    console.log('\nExample:');
    console.log('  ts-node test-langgraph.ts ./sample-brochure.pdf');
    process.exit(1);
  }

  const pdfPath = args[0];

  // Check if file exists
  if (!existsSync(pdfPath)) {
    console.error(`❌ Error: File not found: ${pdfPath}`);
    process.exit(1);
  }

  // Check if Gemini API key is configured
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ Error: GEMINI_API_KEY not found in environment');
    console.log('\nPlease add your Gemini API key to .env:');
    console.log('  GEMINI_API_KEY=your_api_key_here');
    console.log('\nGet your API key from: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }

  console.log('✅ Environment check passed\n');

  try {
    // Run the workflow
    const result = await testWorkflow(pdfPath);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 EXTRACTION SUMMARY');
    console.log('='.repeat(60));
    
    if (result.buildingData?.name) {
      console.log(`\n🏢 Project: ${result.buildingData.name}`);
      console.log(`🏗️  Developer: ${result.buildingData.developer || 'N/A'}`);
      console.log(`📍 Location: ${result.buildingData.address || 'N/A'}`);
      
      if (result.buildingData.units && result.buildingData.units.length > 0) {
        console.log(`\n🏠 Unit Types: ${result.buildingData.units.length}`);
        result.buildingData.units.forEach((unit: any) => {
          console.log(`  • ${unit.name}: ${unit.area} sqft, ${unit.bedrooms}BR, ${unit.bathrooms}BA`);
        });
      }
      
      if (result.buildingData.paymentPlans && result.buildingData.paymentPlans.length > 0) {
        console.log(`\n💰 Payment Plan: ${result.buildingData.paymentPlans[0].milestones.length} milestones`);
      }
      
      if (result.buildingData.amenities && result.buildingData.amenities.length > 0) {
        console.log(`\n✨ Amenities: ${result.buildingData.amenities.length}`);
        console.log(`  ${result.buildingData.amenities.slice(0, 5).join(', ')}...`);
      }
    }
    
    if (result.marketingContent) {
      console.log(`\n📝 Marketing Content Generated:`);
      console.log(`  • Headline: ${result.marketingContent.headline}`);
      console.log(`  • Highlights: ${result.marketingContent.highlights.length}`);
      if (result.marketingContent.xiaohongshu) {
        console.log(`  • Xiaohongshu: ✓`);
      }
      if (result.marketingContent.twitter) {
        console.log(`  • Twitter: ✓`);
      }
      if (result.marketingContent.investorEmail) {
        console.log(`  • Investor Email: ✓`);
      }
    }
    
    console.log(`\n⏱️  Processing Time: ${result.processingTimeSeconds}s`);
    console.log(`📂 Output Directory: ${result.outputDir}`);
    
    if (result.warnings.length > 0) {
      console.log(`\n⚠️  Warnings: ${result.warnings.length}`);
      result.warnings.forEach((w: string) => console.log(`  - ${w}`));
    }
    
    if (result.errors.length > 0) {
      console.log(`\n❌ Errors: ${result.errors.length}`);
      result.errors.forEach((e: string) => console.log(`  - ${e}`));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(result.success ? '✅ SUCCESS' : '⚠️  COMPLETED WITH ISSUES');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    process.exit(1);
  }
}

// Run
main().catch(console.error);
