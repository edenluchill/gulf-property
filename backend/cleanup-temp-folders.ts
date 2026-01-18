/**
 * Cleanup Script for Temporary Folders
 * 
 * Deletes temporary image folders older than 24 hours
 * Should be run periodically (e.g., daily cron job)
 * 
 * Usage:
 *   ts-node cleanup-temp-folders.ts
 */

import { cleanupOldTempFolders } from './src/services/local-image-migration';

async function main() {
  console.log('\n🧹 Starting Temp Folders Cleanup\n');
  console.log('=' .repeat(60));
  
  console.log('🗑️  Cleaning up temporary folders older than 24 hours...\n');
  
  try {
    const deletedCount = await cleanupOldTempFolders(24); // 24 hours
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ Cleanup complete: ${deletedCount} folders deleted`);
    console.log('=' .repeat(60) + '\n');
    
    if (deletedCount === 0) {
      console.log('ℹ️  No old temporary folders found');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { main as cleanupTempFolders };
