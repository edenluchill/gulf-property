/**
 * KML Parser Utility
 * Parses Dubai Pulse Transport KML files to GeoJSON
 * Uses @tmcw/togeojson - the standard library for KML conversion
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DOMParser } from '@xmldom/xmldom';
import * as toGeoJSON from '@tmcw/togeojson';

// ============================================================================
// Types
// ============================================================================

export interface TransportFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: {
    type: 'Point' | 'LineString' | 'MultiLineString' | 'Polygon';
    coordinates: any;
  };
}

export interface TransportGeoJSON {
  type: 'FeatureCollection';
  features: TransportFeature[];
  metadata?: {
    source: string;
    category: string;
    generatedAt: string;
    totalFeatures: number;
  };
}

export type TransportCategory =
  | 'metro_lines'
  | 'metro_stations'
  | 'tram_lines'
  | 'tram_stations'
  | 'bus_routes'
  | 'bus_stops'
  | 'bicycle_tracks'
  | 'rail_tracks'
  | 'monorail'
  | 'monorail_stations';

// ============================================================================
// Color Configuration
// ============================================================================

const LINE_COLORS: Record<string, string> = {
  // Metro
  RED: '#E31837',
  GREEN: '#00A651',
  BLUE: '#0066B3',
  PURPLE: '#6B3FA0',
  // Tram
  TRAM: '#FF6600',
  // Bus
  BUS: '#1E90FF',
  // Bicycle
  BICYCLE: '#32CD32',
};

// Bus route color palette - 20 distinct colors for visual differentiation
const BUS_ROUTE_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // emerald
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#F97316', // orange
  '#6366F1', // indigo
  '#14B8A6', // teal
  '#A855F7', // purple
  '#22C55E', // green
  '#E11D48', // rose
  '#0EA5E9', // sky
  '#FBBF24', // yellow
  '#7C3AED', // violet-darker
  '#2DD4BF', // teal-light
  '#FB7185', // pink-light
  '#4ADE80', // green-light
];

/**
 * Generate a consistent color for a bus route number
 */
function getBusRouteColor(routeNo: string | number): string {
  if (!routeNo) return '#1E90FF'; // default blue
  const hash = String(routeNo).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return BUS_ROUTE_COLORS[hash % BUS_ROUTE_COLORS.length];
}

const CATEGORY_COLORS: Record<TransportCategory, string> = {
  metro_lines: '#E31837',
  metro_stations: '#E31837',
  tram_lines: '#FF6600',
  tram_stations: '#FF6600',
  bus_routes: '#1E90FF',
  bus_stops: '#1E90FF',
  bicycle_tracks: '#32CD32',
  rail_tracks: '#E31837',
  monorail: '#9333EA',
  monorail_stations: '#9333EA',
};

// ============================================================================
// File Mapping
// ============================================================================

// Legacy KML files (Dubai Pulse) - kept for reference but not used
const KML_FILES: Record<TransportCategory, string[]> = {
  metro_lines: [],
  metro_stations: [],
  tram_lines: [],
  tram_stations: [],
  bus_routes: ['Bus_Routes_GIS.kml'],
  bus_stops: ['Bus_Stops_GIS.kml'],
  bicycle_tracks: ['Bicycle_Tracks.kml'],
  rail_tracks: [],
  monorail: [],
  monorail_stations: [],
};

// Use OSM GeoJSON as primary data source
const OSM_TRANSPORT_FILE = 'Dubai_Transport_OSM.geojson';

// Category mapping from OSM data
const OSM_CATEGORY_MAP: Record<TransportCategory, string[]> = {
  metro_lines: ['metro_lines'],
  metro_stations: ['metro_stations'],
  tram_lines: ['tram_lines'],
  tram_stations: ['tram_stations'],
  bus_routes: [],
  bus_stops: [],
  bicycle_tracks: [],
  rail_tracks: ['metro_lines'], // rail_tracks maps to metro_lines for backward compatibility
  monorail: ['monorail'],
  monorail_stations: ['monorail_stations'],
};

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse a single KML file to GeoJSON
 */
export function parseKmlFile(filePath: string, category: TransportCategory): TransportGeoJSON | null {
  if (!existsSync(filePath)) {
    console.log(`[KML Parser] File not found: ${filePath}`);
    return null;
  }

  try {
    const kmlContent = readFileSync(filePath, 'utf-8');
    const dom = new DOMParser().parseFromString(kmlContent, 'text/xml');
    const rawGeoJSON = toGeoJSON.kml(dom);

    const defaultColor = CATEGORY_COLORS[category];

    const features: TransportFeature[] = rawGeoJSON.features.map((feature: any, index: number) => {
      const props = feature.properties || {};

      // Determine color based on category and properties
      let color = defaultColor;
      let name = props.name || props.Name || `${category}-${index}`;

      if (category === 'rail_tracks' || category === 'metro_lines') {
        // Metro: color by track name (RED/GREEN)
        if (props.TRACK_NAME && LINE_COLORS[props.TRACK_NAME]) {
          color = LINE_COLORS[props.TRACK_NAME];
        }
        name = props.TRACK_NAME ? `Dubai Metro ${props.TRACK_NAME} Line` : name;
      } else if (category === 'bus_routes') {
        // Bus: color by route number
        const routeNo = props.BUS_ROUTE_NO;
        if (routeNo) {
          color = getBusRouteColor(routeNo);
          name = `Bus ${routeNo}`;
        }
      } else if (category === 'tram_lines') {
        name = props.name || 'Dubai Tram';
      } else if (props.STATION_NAME) {
        name = props.STATION_NAME;
      }

      return {
        type: 'Feature' as const,
        properties: {
          id: `${category}-${index}`,
          category,
          color,
          name,
          routeNo: props.BUS_ROUTE_NO || null,
          ...props,
        },
        geometry: feature.geometry,
      };
    });

    console.log(`[KML Parser] Parsed ${features.length} features from ${filePath}`);

    return {
      type: 'FeatureCollection',
      features,
      metadata: {
        source: filePath,
        category,
        generatedAt: new Date().toISOString(),
        totalFeatures: features.length,
      },
    };
  } catch (error) {
    console.error(`[KML Parser] Error parsing ${filePath}:`, error);
    return null;
  }
}

// Cache for OSM transport data
let osmTransportCache: { data: any; timestamp: number } | null = null;
const OSM_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Load OSM transport GeoJSON file
 */
function loadOsmTransportData(dataDir: string): any | null {
  const now = Date.now();
  if (osmTransportCache && (now - osmTransportCache.timestamp) < OSM_CACHE_TTL) {
    return osmTransportCache.data;
  }

  const filePath = join(dataDir, OSM_TRANSPORT_FILE);
  if (!existsSync(filePath)) {
    console.log(`[OSM Transport] File not found: ${filePath}`);
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    osmTransportCache = { data, timestamp: now };
    console.log(`[OSM Transport] Loaded ${data.features?.length || 0} features from OSM`);
    return data;
  } catch (error) {
    console.error(`[OSM Transport] Error loading:`, error);
    return null;
  }
}

/**
 * Parse a GeoJSON file (e.g., from OSM)
 */
export function parseGeoJsonFile(filePath: string, category: TransportCategory): TransportGeoJSON | null {
  if (!existsSync(filePath)) {
    console.log(`[GeoJSON Parser] File not found: ${filePath}`);
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const geojson = JSON.parse(content);

    const features: TransportFeature[] = geojson.features.map((feature: any, index: number) => {
      const props = feature.properties || {};
      return {
        type: 'Feature' as const,
        properties: {
          id: props.id || `${category}-${index}`,
          category,
          color: props.color || CATEGORY_COLORS[category],
          name: props.name || `${category}-${index}`,
          ...props,
        },
        geometry: feature.geometry,
      };
    });

    console.log(`[GeoJSON Parser] Parsed ${features.length} features from ${filePath}`);

    return {
      type: 'FeatureCollection',
      features,
      metadata: {
        source: filePath,
        category,
        generatedAt: new Date().toISOString(),
        totalFeatures: features.length,
      },
    };
  } catch (error) {
    console.error(`[GeoJSON Parser] Error parsing ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse transport data for a category (OSM preferred, KML fallback)
 */
export function parseCategory(dataDir: string, category: TransportCategory): TransportGeoJSON | null {
  // Check if this category should use OSM data
  const osmCategories = OSM_CATEGORY_MAP[category];
  if (osmCategories && osmCategories.length > 0) {
    const osmData = loadOsmTransportData(dataDir);
    if (osmData && osmData.features) {
      // Filter features by OSM category
      const features = osmData.features
        .filter((f: any) => osmCategories.includes(f.properties?.category))
        .map((f: any, index: number) => ({
          type: 'Feature' as const,
          properties: {
            ...f.properties,
            id: f.properties?.id || `${category}-${index}`,
            category, // Use the requested category
          },
          geometry: f.geometry,
        }));

      if (features.length > 0) {
        console.log(`[Transport] ${category}: ${features.length} features from OSM`);
        return {
          type: 'FeatureCollection',
          features,
          metadata: {
            source: 'OpenStreetMap',
            category,
            generatedAt: new Date().toISOString(),
            totalFeatures: features.length,
          },
        };
      }
    }
  }

  // Fallback to KML files
  const files = KML_FILES[category];
  if (!files || files.length === 0) return null;

  const allFeatures: TransportFeature[] = [];

  for (const file of files) {
    const filePath = join(dataDir, file);
    const result = parseKmlFile(filePath, category);
    if (result) {
      allFeatures.push(...result.features);
    }
  }

  if (allFeatures.length === 0) return null;

  return {
    type: 'FeatureCollection',
    features: allFeatures,
    metadata: {
      source: `Dubai Pulse - ${category}`,
      category,
      generatedAt: new Date().toISOString(),
      totalFeatures: allFeatures.length,
    },
  };
}

/**
 * Parse all available transport data
 */
export function parseAllTransportData(dataDir: string): Record<TransportCategory, TransportGeoJSON | null> {
  const categories = Object.keys(KML_FILES) as TransportCategory[];
  const result: Record<TransportCategory, TransportGeoJSON | null> = {} as any;

  for (const category of categories) {
    result[category] = parseCategory(dataDir, category);
  }

  return result;
}

/**
 * Get combined GeoJSON for map display
 * Optionally filter by categories
 */
export function getCombinedGeoJSON(
  dataDir: string,
  categories?: TransportCategory[]
): TransportGeoJSON {
  const allData = parseAllTransportData(dataDir);
  const selectedCategories = categories || (Object.keys(KML_FILES) as TransportCategory[]);

  const allFeatures: TransportFeature[] = [];

  for (const category of selectedCategories) {
    const data = allData[category];
    if (data) {
      allFeatures.push(...data.features);
    }
  }

  return {
    type: 'FeatureCollection',
    features: allFeatures,
    metadata: {
      source: 'Dubai Pulse Combined',
      category: 'all',
      generatedAt: new Date().toISOString(),
      totalFeatures: allFeatures.length,
    },
  };
}

/**
 * Group metro/rail features by line (RED, GREEN)
 */
export function groupByLine(geojson: TransportGeoJSON): TransportGeoJSON {
  const lineMap = new Map<string, {
    coordinates: number[][][];
    properties: Record<string, any>;
  }>();

  for (const feature of geojson.features) {
    const trackName = feature.properties.TRACK_NAME || 'UNKNOWN';
    if (trackName === 'UNKNOWN' || trackName === '1') continue;

    if (feature.geometry.type !== 'LineString') continue;

    if (!lineMap.has(trackName)) {
      lineMap.set(trackName, {
        coordinates: [],
        properties: {
          id: `${trackName.toLowerCase()}-line`,
          category: 'metro_lines',
          code: trackName,
          name: `Dubai Metro ${trackName} Line`,
          color: LINE_COLORS[trackName] || '#888888',
        },
      });
    }

    const line = lineMap.get(trackName)!;
    line.coordinates.push(feature.geometry.coordinates as number[][]);
  }

  const groupedFeatures: TransportFeature[] = Array.from(lineMap.entries()).map(([_code, data]) => ({
    type: 'Feature' as const,
    properties: {
      ...data.properties,
      segmentCount: data.coordinates.length,
    },
    geometry: {
      type: 'MultiLineString' as const,
      coordinates: data.coordinates,
    },
  }));

  return {
    type: 'FeatureCollection',
    features: groupedFeatures,
    metadata: {
      source: 'Dubai Pulse - Metro Lines (grouped)',
      category: 'metro_lines',
      generatedAt: new Date().toISOString(),
      totalFeatures: groupedFeatures.length,
    },
  };
}

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================

export function parseKmlToGeoJSON(filePath: string): TransportGeoJSON {
  const result = parseKmlFile(filePath, 'rail_tracks');
  return result || { type: 'FeatureCollection', features: [] };
}

export function parseRailTracksKml(filePath: string) {
  const geojson = parseKmlToGeoJSON(filePath);
  return geojson.features.map(f => ({
    trackName: f.properties.TRACK_NAME || '',
    railSystem: f.properties.RAIL_SYSTEM || '',
    status: f.properties.STATUS || '',
    direction: f.properties.DIRECTION || '',
    coordinates: f.geometry.type === 'LineString'
      ? f.geometry.coordinates as [number, number][]
      : []
  }));
}

export function linesToGeoJSON(_lines: any[]): any {
  return { type: 'FeatureCollection', features: [] };
}
