/**
 * Cleanup Script for R2 Temporary Files
 * 
 * Deletes temporary images older than 24 hours from Cloudflare R2
 * Should be run periodically (e.g., daily cron job)
 * 
 * Usage:
 *   ts-node cleanup-r2-temp-files.ts
 */

import dotenv from 'dotenv';
import { cleanupOldR2TempFiles, testR2Connection } from './src/services/r2-storage';

dotenv.config();

async function main() {
  console.log('\n🧹 Starting R2 Temp Files Cleanup\n');
  console.log('=' .repeat(60));
  
  // Test R2 connection first
  console.log('\n📡 Testing R2 connection...');
  const connected = await testR2Connection();
  
  if (!connected) {
    console.error('\n❌ Failed to connect to R2. Check your credentials in .env');
    console.error('Required environment variables:');
    console.error('  - R2_ENDPOINT');
    console.error('  - R2_ACCESS_KEY_ID');
    console.error('  - R2_SECRET_ACCESS_KEY');
    console.error('  - R2_BUCKET_NAME');
    process.exit(1);
  }
  
  console.log('✅ R2 connection successful\n');
  
  // Run cleanup
  console.log('🗑️  Cleaning up temporary files older than 24 hours...\n');
  
  try {
    const deletedCount = await cleanupOldR2TempFiles();
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ Cleanup complete: ${deletedCount} files deleted`);
    console.log('=' .repeat(60) + '\n');
    
    if (deletedCount === 0) {
      console.log('ℹ️  No old temporary files found');
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

export { main as cleanupR2TempFiles };
