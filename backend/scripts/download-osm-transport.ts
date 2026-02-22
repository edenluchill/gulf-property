/**
 * Download Dubai Transport Data from OpenStreetMap
 *
 * Uses Overpass API to fetch:
 * - Metro lines and stations (Red Line, Green Line)
 * - Tram lines and stations (Dubai Tram)
 * - Monorail lines and stations (Palm Jumeirah Monorail)
 *
 * Key approach: Use route relations to properly map stations to their lines
 *
 * Run with: npx ts-node scripts/download-osm-transport.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data', 'dubai-pulse');
// Multiple Overpass API endpoints for failover
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
let currentEndpointIndex = 0;

function getOverpassUrl(): string {
  return OVERPASS_ENDPOINTS[currentEndpointIndex];
}

function rotateEndpoint(): void {
  currentEndpointIndex = (currentEndpointIndex + 1) % OVERPASS_ENDPOINTS.length;
  console.log(`   🔄 Switching to endpoint: ${OVERPASS_ENDPOINTS[currentEndpointIndex]}`);
}

// Dubai bounding box (expanded slightly for complete coverage)
const BBOX = '24.7,54.8,25.5,55.7';

// Line identifiers (no colors - frontend handles styling)
const LINES = {
  RED: 'red',
  GREEN: 'green',
  BLUE: 'blue',
  TRAM: 'tram',
  MONORAIL: 'palm_monorail',
};

// Arabic to English station name translations (official Dubai RTA names)
const STATION_TRANSLATIONS: Record<string, string> = {
  // Red Line
  'سنتربوينت': 'Centrepoint',
  'طيران الإمارات': 'Emirates',
  'المطار - مبنى رقم 3': 'Airport Terminal 3',
  'المطار - مبنى رقم 1': 'Airport Terminal 1',
  'المطار- مبنى رقم 3': 'Airport Terminal 3',
  'القرهود': 'Al Garhoud',
  'ديرة سيتي سنتر': 'Deira City Centre',
  'الرقة': 'Al Rigga',
  'الاتحاد': 'Union',
  'برجمان': 'BurJuman',
  'بنك أبو ظبي التجاري': 'ADCB',
  'ماكس': 'Max',
  'المركز التجاري العالمي': 'World Trade Centre',
  'أبراج الإمارات': 'Emirates Towers',
  'المركز المالي': 'Financial Centre',
  'دبي مول / برج خليفة': 'Burj Khalifa/Dubai Mall',
  'الخليج التجاري': 'Business Bay',
  'أون باسيف': 'Onpassive',
  'إكويتي': 'Equiti',
  'مول الإمارات': 'Mall of the Emirates',
  'سوق التأمين': 'Al Safa',
  'مدينة دبي للإنترنت': 'Dubai Internet City',
  'الفردان للصرافة': 'Al Fardan Exchange',
  'شوبا العقارية': 'Sobha Realty',
  'مركز دبي للسلع المتعددة': 'DMCC',
  'دهانات ناشونال': 'National Paints',
  'الحدائق': 'Gardens',
  'ديسكفدي جاردنز': 'Discovery Gardens',
  'الفرجان': 'Al Furjan',
  'مجمع دبي للاستثمار': 'Dubai Investment Park',
  'مدينة اكسبو دبي': 'Expo City Dubai',
  'صيدلية لايف': 'Life Pharmacy',
  'دانوب': 'Danube',
  'الطاقة': 'Energy',
  'ابن بطوطة': 'Ibn Battuta',
  // Green Line
  'اي اند': 'Etisalat',
  'القصيص': 'Al Qusais',
  'المنطقة الحرة بمطار دبي': 'Dubai Airport Free Zone',
  'النهدة': 'Al Nahda',
  'الاستاد': 'Stadium',
  'القيادة': 'Al Qiyadah',
  'أبو هيل': 'Abu Hail',
  'أبوبكر الصديق': 'Abu Baker Al Siddique',
  'صلاح الدين': 'Salah Al Din',
  'بني ياس': 'Baniyas Square',
  'سوق الذهب': 'Gold Souq',
  'الرأس': 'Al Ras',
  'الغبيبة': 'Al Ghubaiba',
  'شرف دي جي': 'Sharaf DG',
  'عود ميثاء': 'Oud Metha',
  'مدينة دبي الطبية': 'Dubai Healthcare City',
  'الجداف': 'Al Jadaf',
  'الخور': 'Creek',
  // Tram
  'الميناء السياحي': 'Marina Promenade',
  'مدينة دبي للإعلام': 'Dubai Media City',
  'أبراج بحيرات جميرا': 'Jumeirah Lakes Towers',
  'دبي مارينا مول': 'Dubai Marina Mall',
  'دبي مارينا': 'Dubai Marina',
  'أبراج المارينا': 'Marina Towers',
  'نخلة جميرا': 'Palm Jumeirah',
  'قرية المعرفة': 'Knowledge Village',
  'الصفوح': 'Al Sufouh',
  // Monorail
  'حديقة الاتحاد': 'Al Ittihad Park',
  'نخيل مول': 'Nakheel Mall',
};

function translateStationName(arabicName: string): string {
  return STATION_TRANSLATIONS[arabicName] || arabicName;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    lat?: number;
    lon?: number;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: {
    type: 'Point' | 'LineString' | 'MultiLineString';
    coordinates: any;  // number[] for Point, number[][] for LineString, number[][][] for MultiLineString
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function queryOverpass(query: string, retries = 3): Promise<OverpassElement[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = getOverpassUrl();
      console.log(`   🔍 Querying ${url.split('/')[2]}...`);
      const response = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (response.status === 429 || response.status === 504 || response.status === 503) {
        console.log(`   ⏳ API busy (${response.status}), trying next endpoint...`);
        rotateEndpoint();
        await sleep(3000);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Overpass API error: ${response.status} - ${text.slice(0, 100)}`);
      }

      const data = await response.json() as { elements?: OverpassElement[] };
      return data.elements || [];
    } catch (error) {
      if (attempt === retries) throw error;
      console.log(`   ⚠️ Error, trying next endpoint (${attempt}/${retries})...`);
      rotateEndpoint();
      await sleep(3000);
    }
  }
  return [];
}

function nodeToGeoJSON(node: OverpassElement, category: string, line: string): GeoJSONFeature | null {
  if (!node.lat || !node.lon) return null;

  const tags = node.tags || {};

  // Skip under construction stations
  if (tags['railway:construction'] || tags.construction === 'station') {
    return null;
  }

  // Get original name and translate if Arabic
  const originalName = tags.name || tags['name:en'] || `Station ${node.id}`;
  const translatedName = translateStationName(originalName);
  const nameAr = tags['name:ar'] || (translatedName !== originalName ? originalName : null);

  return {
    type: 'Feature',
    properties: {
      id: `osm-node-${node.id}`,
      osmId: node.id,
      category,
      line,  // Line identifier for frontend styling
      name: translatedName,  // English name
      nameAr: nameAr,        // Arabic name (original if translated)
      network: tags.network || null,
      operator: tags.operator || null,
      wheelchair: tags.wheelchair || null,
    },
    geometry: {
      type: 'Point',
      coordinates: [node.lon, node.lat]
    }
  };
}

function wayToGeoJSON(way: OverpassElement, category: string, line: string): GeoJSONFeature | null {
  if (!way.geometry || way.geometry.length < 2) return null;

  const tags = way.tags || {};
  const coordinates = way.geometry.map(p => [p.lon, p.lat]);

  return {
    type: 'Feature',
    properties: {
      id: `osm-way-${way.id}`,
      osmId: way.id,
      category,
      line,  // Line identifier for frontend styling
      name: tags.name || tags['name:en'] || category,
      nameAr: tags['name:ar'] || null,
      railway: tags.railway || null,
      network: tags.network || null,
      operator: tags.operator || null,
    },
    geometry: {
      type: 'LineString',
      coordinates
    }
  };
}

/**
 * Download Metro data using route relations for proper line mapping
 * Strategy: Query relations with full geometry to get stations directly from route members
 */
async function downloadMetroData() {
  console.log('📥 Downloading Metro data...');

  // Step 1: Query route relations with full member geometry
  // This gets the Red Line and Green Line relations with station coordinates
  const relationsQuery = `
    [out:json][timeout:120];
    relation["type"="route"]["route"~"subway|light_rail"]["network"~"Dubai|RTA"](${BBOX});
    out body;
    >;
    out body qt;
  `;

  console.log('   📍 Fetching metro route relations with stations...');
  const allElements = await queryOverpass(relationsQuery);

  // Separate relations, nodes, and ways
  const relations = allElements.filter(e => e.type === 'relation');
  const nodeMap = new Map<number, OverpassElement>();
  for (const el of allElements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);
    }
  }

  console.log(`   📊 Got ${relations.length} relations, ${nodeMap.size} nodes`);

  // Build station features from relation members
  const stationFeatures: GeoJSONFeature[] = [];
  const seenStationIds = new Set<number>();

  for (const rel of relations) {
    const tags = rel.tags || {};
    const name = (tags.name || '').toLowerCase();
    const ref = (tags.ref || '').toLowerCase();
    const colour = tags.colour || tags.color || '';

    // Determine line identifier
    let line = LINES.RED;

    if (name.includes('green') || ref.includes('green') || ref === 'g' || colour.toLowerCase() === 'green') {
      line = LINES.GREEN;
    } else if (name.includes('blue') || ref.includes('blue') || colour.toLowerCase() === 'blue') {
      line = LINES.BLUE;
    }

    console.log(`   🚇 Processing: ${tags.name || 'unnamed'} → ${line}`);

    // Extract stations from relation members
    if (rel.members) {
      for (const member of rel.members) {
        if (member.type === 'node' && (member.role === 'stop' || member.role === 'station')) {
          const node = nodeMap.get(member.ref);
          if (node && !seenStationIds.has(node.id)) {
            const nodeTags = node.tags || {};

            // Skip if under construction
            if (nodeTags['railway:construction'] || nodeTags.construction === 'station') {
              continue;
            }

            // Skip stop_positions without names (these are technical stops)
            const stationName = nodeTags.name || nodeTags['name:en'];
            if (!stationName) continue;

            seenStationIds.add(node.id);
            const feature = nodeToGeoJSON(node, 'metro_stations', line);
            if (feature) {
              stationFeatures.push(feature);
            }
          }
        }
      }
    }
  }

  // Step 2: Query all metro lines (ways) - exclude service tracks
  const linesQuery = `
    [out:json][timeout:60];
    (
      way["railway"="subway"]["service"!~"yard|siding|crossover|depot"](${BBOX});
      way["railway"="light_rail"]["network"~"Dubai|RTA"]["service"!~"yard|siding|crossover|depot"](${BBOX});
    );
    out geom;
  `;

  await sleep(2000); // Avoid rate limiting
  console.log('   🛤️ Fetching metro lines...');
  const lines = await queryOverpass(linesQuery);

  // Process lines - filter out very short segments (infrastructure noise)
  const lineFeatures = lines
    .filter(e => e.type === 'way')
    .map(e => {
      const tags = e.tags || {};
      const name = tags.name || '';
      const nameEn = (tags['name:en'] || '').toLowerCase();
      const ref = (tags.ref || '').toLowerCase();

      // Determine line from name/ref - check both English and Arabic
      // Arabic: الخط الأخضر = Green Line, أخضر = green
      // Arabic: الخط الأحمر = Red Line, أحمر = red
      let line = LINES.RED;  // Default to red

      // Check for Green Line
      if (name.includes('أخضر') ||          // Arabic "green"
          name.includes('الأخضر') ||        // Arabic "the green"
          nameEn.includes('green') ||
          name.toLowerCase().includes('green') ||
          ref.includes('green') ||
          ref === 'g') {
        line = LINES.GREEN;
      }

      return wayToGeoJSON(e, 'metro_lines', line);
    })
    .filter(Boolean)
    .filter(f => f!.geometry.coordinates.length >= 5) as GeoJSONFeature[];  // Filter short segments

  // Deduplicate stations by name (prefer keeping first occurrence)
  const uniqueByName = new Map<string, GeoJSONFeature>();
  for (const station of stationFeatures) {
    const name = station.properties.name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!uniqueByName.has(name)) {
      uniqueByName.set(name, station);
    }
  }

  const dedupedStations = Array.from(uniqueByName.values());

  // Count by line
  const redCount = dedupedStations.filter(s => s.properties.line === LINES.RED).length;
  const greenCount = dedupedStations.filter(s => s.properties.line === LINES.GREEN).length;

  console.log(`   ✅ Metro: ${lineFeatures.length} line segments`);
  console.log(`   ✅ Stations: ${dedupedStations.length} total (Red: ${redCount}, Green: ${greenCount})`);

  return { lines: lineFeatures, stations: dedupedStations };
}

/**
 * Download Tram data - uses route relation for accurate station mapping
 */
async function downloadTramData() {
  console.log('📥 Downloading Tram data...');

  // Use route relation to get tram data with stations
  const tramQuery = `
    [out:json][timeout:90];
    relation["type"="route"]["route"="tram"]["network"~"Dubai|RTA"](${BBOX});
    out body;
    >;
    out body qt;
  `;

  const allElements = await queryOverpass(tramQuery);

  // Separate elements
  const relations = allElements.filter(e => e.type === 'relation');
  const ways = allElements.filter(e => e.type === 'way' && e.geometry);
  const nodeMap = new Map<number, OverpassElement>();
  for (const el of allElements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);
    }
  }

  console.log(`   📊 Got ${relations.length} relations, ${ways.length} ways, ${nodeMap.size} nodes`);

  // Extract stations from relation members
  const stationFeatures: GeoJSONFeature[] = [];
  const seenStationNames = new Set<string>();

  for (const rel of relations) {
    if (rel.members) {
      for (const member of rel.members) {
        if (member.type === 'node' && (member.role === 'stop' || member.role === 'station')) {
          const node = nodeMap.get(member.ref);
          if (node) {
            const nodeTags = node.tags || {};
            const name = nodeTags.name || nodeTags['name:en'];
            if (name && !seenStationNames.has(name.toLowerCase())) {
              seenStationNames.add(name.toLowerCase());
              const feature = nodeToGeoJSON(node, 'tram_stations', LINES.TRAM);
              if (feature) stationFeatures.push(feature);
            }
          }
        }
      }
    }
  }

  // Fallback: Query tram lines directly if no ways from relation
  let lineFeatures: GeoJSONFeature[] = [];
  if (ways.length === 0) {
    console.log('   🔄 Fetching tram lines directly...');
    await sleep(3000);
    const linesQuery = `
      [out:json][timeout:60];
      way["railway"="tram"]["service"!~"yard|siding|crossover|depot"](${BBOX});
      out geom;
    `;
    const lines = await queryOverpass(linesQuery);
    lineFeatures = lines
      .filter(e => e.type === 'way')
      .map(e => wayToGeoJSON(e, 'tram_lines', LINES.TRAM))
      .filter(Boolean) as GeoJSONFeature[];
  } else {
    // Use ways from relation
    for (const way of ways) {
      if (way.tags?.railway === 'tram') {
        const feature = wayToGeoJSON(way, 'tram_lines', LINES.TRAM);
        if (feature) lineFeatures.push(feature);
      }
    }
  }

  // Fallback: Query tram stops directly if none found
  if (stationFeatures.length === 0) {
    console.log('   🔄 Fetching tram stations directly...');
    await sleep(3000);
    const stationsQuery = `
      [out:json][timeout:60];
      node["railway"="tram_stop"](${BBOX});
      out body;
    `;
    const stations = await queryOverpass(stationsQuery);
    for (const node of stations) {
      if (node.type === 'node' && node.tags?.name) {
        const name = node.tags.name.toLowerCase();
        if (!seenStationNames.has(name)) {
          seenStationNames.add(name);
          const feature = nodeToGeoJSON(node, 'tram_stations', LINES.TRAM);
          if (feature) stationFeatures.push(feature);
        }
      }
    }
  }

  // Filter out Dubai Trolley stations (different system from Dubai Tram)
  const dubaiTramStations = stationFeatures.filter(s => {
    const name = s.properties.name.toLowerCase();
    // Filter out Dubai Trolley (different system)
    if (name.includes('trolley')) {
      return false;
    }
    return true;
  });

  // Filter out Dubai Trolley lines and very short segments
  const filteredLines = lineFeatures.filter(line => {
    const name = (line.properties.name || '').toLowerCase();
    // Filter out Dubai Trolley
    if (name.includes('trolley')) {
      return false;
    }
    // Filter out very short segments (less than 5 points = likely infrastructure noise)
    const coords = line.geometry.coordinates;
    if (coords.length < 5) {
      return false;
    }
    return true;
  });

  console.log(`   ✅ Tram: ${filteredLines.length} line segments (filtered from ${lineFeatures.length}), ${dubaiTramStations.length} stations`);

  return { lines: filteredLines, stations: dubaiTramStations };
}

/**
 * Download Monorail data (Palm Jumeirah Monorail)
 * Palm Monorail has 4 stations: Gateway, Al Ittihad Park, Palm Mall, Atlantis
 */
async function downloadMonorailData() {
  console.log('📥 Downloading Monorail data...');

  // Use route relation for monorail
  const monorailQuery = `
    [out:json][timeout:90];
    (
      relation["type"="route"]["route"="monorail"](${BBOX});
      way["railway"="monorail"]["service"!~"yard|siding|crossover|depot"](${BBOX});
    );
    out body;
    >;
    out body qt;
  `;

  const allElements = await queryOverpass(monorailQuery);

  // Separate elements
  const relations = allElements.filter(e => e.type === 'relation');
  const ways = allElements.filter(e => e.type === 'way' && e.geometry);
  const nodeMap = new Map<number, OverpassElement>();
  for (const el of allElements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);
    }
  }

  console.log(`   📊 Got ${relations.length} relations, ${ways.length} ways, ${nodeMap.size} nodes`);

  // Filter function to separate Palm Monorail from Airport APM
  // Palm Monorail is roughly in the area lng 55.1-55.2, Airport APM is around 55.3-55.4
  const isPalmMonorail = (coords: number[][]) => {
    const avgLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
    return avgLng < 55.25;  // Palm Monorail is west of 55.25
  };

  // Process lines - filter short segments and Airport APM
  let lineFeatures = ways
    .filter(e => e.tags?.railway === 'monorail')
    .map(e => wayToGeoJSON(e, 'monorail', LINES.MONORAIL))
    .filter(Boolean)
    .filter(f => f!.geometry.coordinates.length >= 5)
    .filter(f => isPalmMonorail(f!.geometry.coordinates)) as GeoJSONFeature[];

  // Fallback: Query monorail lines directly if none found
  if (lineFeatures.length === 0) {
    console.log('   🔄 Fetching monorail lines directly...');
    await sleep(3000);
    const linesQuery = `
      [out:json][timeout:60];
      way["railway"="monorail"]["service"!~"yard|siding|crossover|depot"](${BBOX});
      out geom;
    `;
    const lines = await queryOverpass(linesQuery);
    lineFeatures = lines
      .filter(e => e.type === 'way')
      .map(e => wayToGeoJSON(e, 'monorail', LINES.MONORAIL))
      .filter(Boolean)
      .filter(f => f!.geometry.coordinates.length >= 5)
      .filter(f => isPalmMonorail(f!.geometry.coordinates)) as GeoJSONFeature[];
  }

  // Extract stations from relation members
  const stationFeatures: GeoJSONFeature[] = [];
  const seenStationNames = new Set<string>();

  for (const rel of relations) {
    if (rel.members) {
      for (const member of rel.members) {
        if (member.type === 'node' && (member.role === 'stop' || member.role === 'station')) {
          const node = nodeMap.get(member.ref);
          if (node) {
            const nodeTags = node.tags || {};
            const name = nodeTags.name || nodeTags['name:en'];
            if (name && !seenStationNames.has(name.toLowerCase())) {
              seenStationNames.add(name.toLowerCase());
              const feature = nodeToGeoJSON(node, 'monorail_stations', LINES.MONORAIL);
              if (feature) stationFeatures.push(feature);
            }
          }
        }
      }
    }
  }

  // Fallback: Query stations directly if none found
  if (stationFeatures.length === 0) {
    console.log('   🔄 Fetching monorail stations directly...');
    await sleep(2000);
    const stationsQuery = `
      [out:json][timeout:60];
      (
        node["railway"="station"]["monorail"="yes"](${BBOX});
        node["railway"="halt"]["monorail"="yes"](${BBOX});
      );
      out body;
    `;
    const stations = await queryOverpass(stationsQuery);
    for (const node of stations) {
      if (node.type === 'node' && node.tags?.name) {
        const name = node.tags.name.toLowerCase();
        if (!seenStationNames.has(name)) {
          seenStationNames.add(name);
          const feature = nodeToGeoJSON(node, 'monorail_stations', LINES.MONORAIL);
          if (feature) stationFeatures.push(feature);
        }
      }
    }
  }

  // Filter: Keep only Palm Monorail stations, exclude airport APM
  const palmMonorailStations = stationFeatures.filter(s => {
    const name = s.properties.name.toLowerCase();
    // Explicitly exclude airport concourses/terminals (Dubai Airport APM)
    if (name.includes('concourse') || name.includes('terminal') ||
        name.includes('مبنى') || name.includes('كونكورس')) {
      return false;
    }
    // Keep everything else (Palm Monorail stations)
    return true;
  });

  // Manually add missing Palm Monorail stations (not in OSM)
  const existingNames = new Set(palmMonorailStations.map(s => s.properties.name.toLowerCase()));

  // Get station positions from track endpoints
  const allCoords: number[][] = [];
  lineFeatures.forEach(f => {
    allCoords.push(...f.geometry.coordinates);
  });

  // Find extreme points for Gateway (southeast) and Atlantis (northwest)
  let gatewayCoord = [55.1562, 25.1003];  // Default: southeast end of track
  let atlantisCoord = [55.1210578, 25.1274242]; // Default: northwest end of track

  if (allCoords.length > 0) {
    // Gateway is at the southern end (lowest lat near eastern side)
    const southEastPoints = allCoords.filter(c => c[1] < 25.105);
    if (southEastPoints.length > 0) {
      // Find the easternmost of southern points
      southEastPoints.sort((a, b) => b[0] - a[0]);
      gatewayCoord = southEastPoints[0];
    }

    // Atlantis is at the western end (lowest lng)
    const westPoints = [...allCoords].sort((a, b) => a[0] - b[0]);
    atlantisCoord = westPoints[0];
  }

  // Gateway Station - at the entrance of Palm Jumeirah (connects to Dubai Tram)
  if (!existingNames.has('gateway') && !existingNames.has('gateway station')) {
    palmMonorailStations.push({
      type: 'Feature',
      properties: {
        id: 'palm-gateway',
        osmId: null,
        category: 'monorail_stations',
        line: LINES.MONORAIL,
        name: 'Gateway',
        nameAr: 'غيتواي',
        network: 'Palm Jumeirah Monorail',
        operator: 'Nakheel',
        wheelchair: null,
      },
      geometry: {
        type: 'Point',
        coordinates: gatewayCoord
      }
    });
  }

  // Atlantis Aquaventure Station - at the end near Atlantis Hotel
  if (!existingNames.has('atlantis') && !existingNames.has('atlantis aquaventure')) {
    palmMonorailStations.push({
      type: 'Feature',
      properties: {
        id: 'palm-atlantis',
        osmId: null,
        category: 'monorail_stations',
        line: LINES.MONORAIL,
        name: 'Atlantis Aquaventure',
        nameAr: 'أتلانتس أكوافنتشر',
        network: 'Palm Jumeirah Monorail',
        operator: 'Nakheel',
        wheelchair: null,
      },
      geometry: {
        type: 'Point',
        coordinates: atlantisCoord
      }
    });
  }

  console.log(`   ✅ Monorail: ${lineFeatures.length} line segments, ${palmMonorailStations.length} stations (OSM: ${stationFeatures.length}, added: ${palmMonorailStations.length - stationFeatures.filter(s => !s.properties.name.toLowerCase().includes('concourse') && !s.properties.name.toLowerCase().includes('terminal')).length})`);

  return { lines: lineFeatures, stations: palmMonorailStations };
}

async function main() {
  console.log('\n🚇 Dubai OSM Transport Data Downloader\n');
  console.log('=========================================');
  console.log('Transport System:');
  console.log('  - Metro Red Line: 35 stations');
  console.log('  - Metro Green Line: 20 stations');
  console.log('  - Dubai Tram: 11 stations');
  console.log('  - Palm Monorail: 4 stations');
  console.log('=========================================\n');

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initialize with empty defaults
  let metro = { lines: [] as GeoJSONFeature[], stations: [] as GeoJSONFeature[] };
  let tram = { lines: [] as GeoJSONFeature[], stations: [] as GeoJSONFeature[] };
  let monorail = { lines: [] as GeoJSONFeature[], stations: [] as GeoJSONFeature[] };

  try {
    // Run sequentially to avoid rate limiting
    metro = await downloadMetroData();
    await sleep(5000);
  } catch (error) {
    console.error('⚠️ Metro download failed:', error);
  }

  try {
    tram = await downloadTramData();
    await sleep(5000);
  } catch (error) {
    console.error('⚠️ Tram download failed:', error);
  }

  try {
    monorail = await downloadMonorailData();
  } catch (error) {
    console.error('⚠️ Monorail download failed:', error);
  }

  // Calculate distance between two points in meters
  function distanceMeters(p1: number[], p2: number[]): number {
    const R = 6371000;
    const dLat = (p2[1] - p1[1]) * Math.PI / 180;
    const dLon = (p2[0] - p1[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Connect segments that are truly adjacent (within threshold), keep separate branches apart
  function connectAdjacentSegments(coords: number[][][]): number[][][] {
    if (coords.length === 0) return [];
    if (coords.length === 1) return coords;

    const CONNECT_THRESHOLD = 500; // Only connect if endpoints are within 500m
    const used = new Set<number>();
    const result: number[][][] = [];

    while (used.size < coords.length) {
      // Find first unused segment
      let startIdx = -1;
      for (let i = 0; i < coords.length; i++) {
        if (!used.has(i)) { startIdx = i; break; }
      }
      if (startIdx === -1) break;

      let currentLine: number[][] = [...coords[startIdx]];
      used.add(startIdx);

      // Keep extending this line with adjacent segments
      let changed = true;
      while (changed) {
        changed = false;
        const currentEnd = currentLine[currentLine.length - 1];
        const currentStart = currentLine[0];

        let bestIdx = -1;
        let bestDist = Infinity;
        let reverseNext = false;
        let appendToStart = false;

        for (let i = 0; i < coords.length; i++) {
          if (used.has(i)) continue;

          const seg = coords[i];
          const segStart = seg[0];
          const segEnd = seg[seg.length - 1];

          const d1 = distanceMeters(currentEnd, segStart);
          const d2 = distanceMeters(currentEnd, segEnd);
          const d3 = distanceMeters(currentStart, segStart);
          const d4 = distanceMeters(currentStart, segEnd);

          if (d1 < bestDist) { bestDist = d1; bestIdx = i; reverseNext = false; appendToStart = false; }
          if (d2 < bestDist) { bestDist = d2; bestIdx = i; reverseNext = true; appendToStart = false; }
          if (d3 < bestDist) { bestDist = d3; bestIdx = i; reverseNext = true; appendToStart = true; }
          if (d4 < bestDist) { bestDist = d4; bestIdx = i; reverseNext = false; appendToStart = true; }
        }

        // Only connect if within threshold (truly adjacent)
        if (bestIdx !== -1 && bestDist < CONNECT_THRESHOLD) {
          used.add(bestIdx);
          let nextSeg = [...coords[bestIdx]];
          if (reverseNext) nextSeg = nextSeg.reverse();

          if (appendToStart) {
            currentLine = [...nextSeg, ...currentLine];
          } else {
            currentLine = [...currentLine, ...nextSeg];
          }
          changed = true;
        }
      }

      result.push(currentLine);
    }

    return result;
  }

  // Merge segments: connect truly adjacent ones, keep branches separate
  function mergeLineSegments(segments: GeoJSONFeature[], category: string): GeoJSONFeature[] {
    // Group by line property
    const byLine: Record<string, GeoJSONFeature[]> = {};
    for (const seg of segments) {
      const line = seg.properties.line || 'unknown';
      if (!byLine[line]) byLine[line] = [];
      byLine[line].push(seg);
    }

    // Merge adjacent segments, keep separate branches as MultiLineString
    const merged: GeoJSONFeature[] = [];
    for (const [line, segs] of Object.entries(byLine)) {
      const rawCoords = segs.map(s => s.geometry.coordinates as number[][]);
      const connectedBranches = connectAdjacentSegments(rawCoords);

      if (connectedBranches.length === 1) {
        // Single continuous line
        merged.push({
          type: 'Feature',
          properties: {
            id: `${category}-${line}`,
            osmId: null,
            category,
            line,
            name: segs[0]?.properties.name || category,
          },
          geometry: {
            type: 'LineString',
            coordinates: connectedBranches[0],
          }
        });
        console.log(`   📦 ${line}: ${segs.length} segments → 1 line (${connectedBranches[0].length} points)`);
      } else {
        // Multiple branches
        merged.push({
          type: 'Feature',
          properties: {
            id: `${category}-${line}`,
            osmId: null,
            category,
            line,
            name: segs[0]?.properties.name || category,
          },
          geometry: {
            type: 'MultiLineString',
            coordinates: connectedBranches,
          }
        });
        const totalPts = connectedBranches.reduce((s, b) => s + b.length, 0);
        console.log(`   📦 ${line}: ${segs.length} segments → ${connectedBranches.length} branches (${totalPts} points)`);
      }
    }
    return merged;
  }

  // Merge line segments
  const mergedMetroLines = mergeLineSegments(metro.lines, 'metro_lines');
  const mergedTramLines = mergeLineSegments(tram.lines, 'tram_lines');
  const mergedMonorailLines = mergeLineSegments(monorail.lines, 'monorail');

  // Combine all data into one GeoJSON file
  const allFeatures = [
    ...mergedMetroLines,
    ...metro.stations,
    ...mergedTramLines,
    ...tram.stations,
    ...mergedMonorailLines,
    ...monorail.stations,
  ];

  if (allFeatures.length === 0) {
    console.error('❌ No features downloaded. Check API status.');
    process.exit(1);
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      source: 'OpenStreetMap via Overpass API',
      timestamp: new Date().toISOString(),
      license: 'ODbL - www.openstreetmap.org',
      description: 'Dubai public transport infrastructure',
      counts: {
        metro_lines: mergedMetroLines.length,
        metro_stations: metro.stations.length,
        tram_lines: mergedTramLines.length,
        tram_stations: tram.stations.length,
        monorail_lines: mergedMonorailLines.length,
        monorail_stations: monorail.stations.length,
      }
    },
    features: allFeatures
  };

  const outputPath = join(DATA_DIR, 'Dubai_Transport_OSM.geojson');
  writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

  console.log('\n=========================================');
  console.log('📊 Summary (after merging):');
  console.log(`   Metro:    ${mergedMetroLines.length} lines (from ${metro.lines.length} segments), ${metro.stations.length} stations`);
  console.log(`   Tram:     ${mergedTramLines.length} lines (from ${tram.lines.length} segments), ${tram.stations.length} stations`);
  console.log(`   Monorail: ${mergedMonorailLines.length} lines (from ${monorail.lines.length} segments), ${monorail.stations.length} stations`);
  console.log(`   Total:    ${allFeatures.length} features`);
  console.log(`\n✅ Saved to: ${outputPath}\n`);
}

main();
