/**
 * Dubai Transport Routes
 *
 * API endpoints for Dubai transport data from Dubai Pulse
 * Supports: Metro, Tram, Bus, Bicycle tracks
 */

import { Router, Request, Response } from 'express';
import {
  parseCategory,
  parseAllTransportData,
  getCombinedGeoJSON,
  groupByLine,
  TransportCategory,
  TransportGeoJSON
} from '../utils/kml-parser';
import { join } from 'path';

const router = Router();
const DATA_DIR = join(process.cwd(), 'data', 'dubai-pulse');

// ============================================================================
// Cache - optimized for fast responses
// ============================================================================

import { readFileSync, existsSync } from 'fs';

interface TransportCache {
  data: Record<TransportCategory, TransportGeoJSON | null>;
  timestamp: number;
}

// In-memory cache for the combined GeoJSON (loaded once, stays in memory)
let osmGeoJSONCache: any = null;

function loadOsmGeoJSON(): any {
  if (osmGeoJSONCache) return osmGeoJSONCache;

  const osmPath = join(DATA_DIR, 'Dubai_Transport_OSM.geojson');
  if (existsSync(osmPath)) {
    console.log('[Transport API] Loading OSM GeoJSON...');
    const content = readFileSync(osmPath, 'utf-8');
    osmGeoJSONCache = JSON.parse(content);
    console.log(`[Transport API] Loaded ${osmGeoJSONCache.features?.length || 0} features`);
  }
  return osmGeoJSONCache;
}

let cache: TransportCache | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function loadAllData(): Record<TransportCategory, TransportGeoJSON | null> {
  const now = Date.now();

  if (cache && (now - cache.timestamp) < CACHE_TTL) {
    return cache.data;
  }

  console.log('[Transport API] Loading all transport data...');
  const data = parseAllTransportData(DATA_DIR);

  cache = { data, timestamp: now };

  // Log summary
  const summary = Object.entries(data)
    .filter(([_, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v!.features.length}`)
    .join(', ');
  console.log(`[Transport API] Loaded: ${summary}`);

  return data;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/transport/categories
 * List all available transport categories
 */
router.get('/categories', (_req: Request, res: Response) => {
  const data = loadAllData();

  const categories = Object.entries(data)
    .map(([category, geojson]) => ({
      id: category,
      name: formatCategoryName(category),
      available: geojson !== null,
      featureCount: geojson?.features.length || 0,
      type: getCategoryType(category as TransportCategory),
    }))
    .filter(c => c.available);

  res.json({
    success: true,
    data: categories
  });
});

/**
 * GET /api/transport/geojson
 * Get transport data as GeoJSON (fast - uses in-memory cache)
 * Query params:
 *   - categories: comma-separated list (e.g., "metro_lines,metro_stations")
 */
router.get('/geojson', (req: Request, res: Response) => {
  const categoriesParam = req.query.categories as string | undefined;

  // Use cached OSM data directly (fast)
  const osmData = loadOsmGeoJSON();
  if (!osmData) {
    return res.status(500).json({ error: 'Transport data not available' });
  }

  // If no category filter, return all data
  if (!categoriesParam) {
    return res.json(osmData);
  }

  // Filter by categories
  const categories = categoriesParam.split(',');
  const filteredFeatures = osmData.features.filter((f: any) =>
    categories.includes(f.properties?.category)
  );

  res.json({
    type: 'FeatureCollection',
    features: filteredFeatures,
    metadata: {
      ...osmData.metadata,
      filteredCategories: categories,
      totalFeatures: filteredFeatures.length,
    }
  });
});

/**
 * GET /api/transport/geojson/:category
 * Get GeoJSON for a specific category
 */
router.get('/geojson/:category', (req: Request, res: Response) => {
  const category = req.params.category as TransportCategory;
  const grouped = req.query.grouped === 'true';

  const data = loadAllData();
  let geojson = data[category];

  if (!geojson) {
    return res.status(404).json({
      success: false,
      error: `Category '${category}' not found or has no data`
    });
  }

  // Group metro/rail lines if requested
  if (grouped && (category === 'metro_lines' || category === 'rail_tracks')) {
    geojson = groupByLine(geojson);
  }

  res.json(geojson);
});

/**
 * GET /api/transport/stats
 * Get transport network statistics
 */
router.get('/stats', (_req: Request, res: Response) => {
  const data = loadAllData();

  const stats = {
    categories: Object.entries(data)
      .filter(([_, v]) => v !== null)
      .map(([category, geojson]) => ({
        id: category,
        name: formatCategoryName(category),
        featureCount: geojson!.features.length,
        type: getCategoryType(category as TransportCategory),
      })),
    totalFeatures: Object.values(data)
      .filter(v => v !== null)
      .reduce((sum, v) => sum + v!.features.length, 0),
    source: 'Dubai Pulse (dubaipulse.gov.ae)',
    lastUpdated: new Date().toISOString(),
  };

  res.json({
    success: true,
    data: stats
  });
});

/**
 * GET /api/transport/lines
 * Get metro lines metadata (legacy endpoint)
 */
router.get('/lines', (_req: Request, res: Response) => {
  const railData = parseCategory(DATA_DIR, 'rail_tracks');

  if (!railData) {
    return res.status(500).json({
      success: false,
      error: 'Failed to load rail data'
    });
  }

  const grouped = groupByLine(railData);
  const lines = grouped.features.map(f => ({
    code: f.properties.code,
    name: f.properties.name,
    color: f.properties.color,
    segmentCount: f.properties.segmentCount,
  }));

  res.json({
    success: true,
    data: lines
  });
});

// ============================================================================
// Helpers
// ============================================================================

function formatCategoryName(category: string): string {
  const names: Record<string, string> = {
    metro_lines: 'Metro Lines',
    metro_stations: 'Metro Stations',
    tram_lines: 'Tram Lines',
    tram_stations: 'Tram Stations',
    bus_routes: 'Bus Routes',
    bus_stops: 'Bus Stops',
    bicycle_tracks: 'Bicycle Tracks',
    rail_tracks: 'Rail Tracks',
  };
  return names[category] || category;
}

function getCategoryType(category: TransportCategory): 'line' | 'point' {
  const pointCategories = ['metro_stations', 'tram_stations', 'bus_stops'];
  return pointCategories.includes(category) ? 'point' : 'line';
}

// Preload data at startup
loadOsmGeoJSON();

export default router;
