/**
 * Dubai Pulse Transport Data Downloader
 *
 * Automatically downloads and processes KML data from Dubai Pulse
 * Run with: npx ts-node scripts/download-dubai-transport.ts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data', 'dubai-pulse');

// Dubai Pulse dataset URLs - these need to be updated periodically
// Format: https://www.dubaipulse.gov.ae/data/{service}/{dataset}
const DATASETS = [
  {
    name: 'Metro Stations',
    slug: 'rta_metro_stations_gis-open',
    service: 'rta-location',
    type: 'stations'
  },
  {
    name: 'Metro Lines',
    slug: 'rta_metro_lines_gis-open',
    service: 'rta-location',
    type: 'lines'
  },
  {
    name: 'Tram Stations',
    slug: 'rta_tram_stations_gis-open',
    service: 'rta-location',
    type: 'stations'
  },
  {
    name: 'Tram Lines',
    slug: 'rta_tram_lines_gis-open',
    service: 'rta-location',
    type: 'lines'
  },
  {
    name: 'Bus Routes',
    slug: 'rta_bus_routes_gis-open',
    service: 'rta-location',
    type: 'routes'
  },
  {
    name: 'Bus Stops',
    slug: 'rta_bus_stops_gis-open',
    service: 'rta-location',
    type: 'stops'
  },
  {
    name: 'Bicycle Tracks',
    slug: 'rta_bicycle_tracks-open',
    service: 'rta-location',
    type: 'tracks'
  },
  {
    name: 'Marine Stations',
    slug: 'rta_marine_stations_gis-open',
    service: 'rta-location',
    type: 'stations'
  },
  {
    name: 'Rail Tracks',
    slug: 'rta_rail_tracks-open',
    service: 'rta-rail',
    type: 'tracks'
  },
  {
    name: 'Rail Platforms',
    slug: 'rta_rail_platforms-open',
    service: 'rta-rail',
    type: 'platforms'
  }
];

/**
 * Get the latest KML file for a dataset from the data directory
 */
function getLatestKmlFile(pattern: string): string | null {
  if (!existsSync(DATA_DIR)) return null;

  const files = readdirSync(DATA_DIR)
    .filter(f => f.toLowerCase().includes(pattern.toLowerCase()) && f.endsWith('.kml'))
    .sort((a, b) => {
      const statA = statSync(join(DATA_DIR, a));
      const statB = statSync(join(DATA_DIR, b));
      return statB.mtime.getTime() - statA.mtime.getTime();
    });

  return files[0] || null;
}

/**
 * List available KML files
 */
function listAvailableFiles(): void {
  console.log('\n📂 Available KML files in', DATA_DIR, ':\n');

  if (!existsSync(DATA_DIR)) {
    console.log('  (directory does not exist)');
    return;
  }

  const files = readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.kml'))
    .map(f => {
      const stat = statSync(join(DATA_DIR, f));
      const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
      return { name: f, size: sizeMB, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length === 0) {
    console.log('  (no KML files found)');
    return;
  }

  files.forEach(f => {
    console.log(`  📄 ${f.name} (${f.size} MB)`);
  });
}

/**
 * Print download instructions
 */
function printDownloadInstructions(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    DUBAI PULSE TRANSPORT DATA DOWNLOADER                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

📥 MANUAL DOWNLOAD INSTRUCTIONS:

Dubai Pulse requires manual download due to authentication. Please visit:

`);

  DATASETS.forEach((ds, i) => {
    const url = `https://www.dubaipulse.gov.ae/data/${ds.service}/${ds.slug}`;
    console.log(`  ${i + 1}. ${ds.name}`);
    console.log(`     ${url}`);
    console.log('');
  });

  console.log(`
📁 Save all downloaded KML files to:
   ${DATA_DIR}

🔄 After downloading, run this script again to process the files.

══════════════════════════════════════════════════════════════════════════════
`);
}

/**
 * Try to download using curl (may fail due to auth)
 */
async function tryDownload(url: string, filename: string): Promise<boolean> {
  const outputPath = join(DATA_DIR, filename);

  try {
    console.log(`  Attempting to download ${filename}...`);
    execSync(`curl -sL -o "${outputPath}" "${url}"`, { timeout: 60000 });

    // Check if file was downloaded successfully
    if (existsSync(outputPath)) {
      const stat = statSync(outputPath);
      if (stat.size > 1000) { // More than 1KB
        console.log(`  ✅ Downloaded ${filename} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log('\n🚇 Dubai Transport Data Manager\n');

  // List current files
  listAvailableFiles();

  // Print download instructions
  printDownloadInstructions();

  // Show what data we have
  console.log('\n📊 Data Status:\n');

  const patterns = [
    { name: 'Rail Tracks', pattern: 'rail_tracks' },
    { name: 'Metro Stations', pattern: 'metro_stations' },
    { name: 'Metro Lines', pattern: 'metro_lines' },
    { name: 'Tram Stations', pattern: 'tram_stations' },
    { name: 'Tram Lines', pattern: 'tram_lines' },
    { name: 'Bus Routes', pattern: 'bus_routes' },
    { name: 'Bus Stops', pattern: 'bus_stops' },
    { name: 'Bicycle Tracks', pattern: 'bicycle' },
    { name: 'Marine Stations', pattern: 'marine' },
  ];

  patterns.forEach(p => {
    const file = getLatestKmlFile(p.pattern);
    if (file) {
      console.log(`  ✅ ${p.name}: ${file}`);
    } else {
      console.log(`  ❌ ${p.name}: not found`);
    }
  });

  console.log('\n');
}

main().catch(console.error);
