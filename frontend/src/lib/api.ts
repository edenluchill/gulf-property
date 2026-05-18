import { PropertyFilters, MapBounds, DubaiArea, DubaiLandmark } from '../types';
import { API_BASE_URL } from './config';
import { supabase } from './supabase';

// 后端路由都在 /api/* 下，所以需要添加 /api 前缀
const API_URL = `${API_BASE_URL}/api`;

/**
 * Get authorization headers for authenticated requests
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Authenticated fetch wrapper for write operations
 */
async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  total?: number;
  error?: string;
}

// ============================================================================
// LEGACY API FUNCTIONS REMOVED
// All old properties API functions have been removed.
// Use the new residential-projects API functions below instead.
// ============================================================================

// ============================================================================
// DUBAI AREAS & LANDMARKS API
// ============================================================================

/**
 * Fetch Dubai areas (districts with boundaries)
 */
export async function fetchDubaiAreas(): Promise<DubaiArea[]> {
  try {
    const response = await fetch(`${API_URL}/dubai/areas`);
    const areas: DubaiArea[] = await response.json();
    return areas;
  } catch (error) {
    console.error('Error fetching Dubai areas:', error);
    return [];
  }
}

/**
 * Search Dubai areas by name for map navigation
 */
export interface AreaSearchResult {
  id: string;
  name: string;
  nameAr: string | null;
  centroid: { lat: number; lng: number };
  transactionCount: number | null;
  avgPriceSqm: number | null;
}

export async function searchDubaiAreas(query: string): Promise<AreaSearchResult[]> {
  if (!query || query.length < 2) return [];

  try {
    const response = await fetch(`${API_URL}/dubai/areas/search?q=${encodeURIComponent(query)}`);
    const results: AreaSearchResult[] = await response.json();
    return results;
  } catch (error) {
    console.error('Error searching Dubai areas:', error);
    return [];
  }
}

/**
 * Fetch Dubai landmarks (points of interest)
 */
export async function fetchDubaiLandmarks(): Promise<DubaiLandmark[]> {
  try {
    const response = await fetch(`${API_URL}/dubai/landmarks`);
    const landmarks: DubaiLandmark[] = await response.json();
    return landmarks;
  } catch (error) {
    console.error('Error fetching Dubai landmarks:', error);
    return [];
  }
}

/**
 * Create a new Dubai area (requires authentication)
 */
export async function createDubaiArea(area: Partial<DubaiArea>): Promise<DubaiArea | null> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/areas`, {
      method: 'POST',
      body: JSON.stringify(area),
    });
    if (!response.ok) throw new Error('Failed to create area');
    return await response.json();
  } catch (error) {
    console.error('Error creating area:', error);
    return null;
  }
}

/**
 * Update a Dubai area (requires authentication)
 */
export async function updateDubaiArea(id: string, area: Partial<DubaiArea>): Promise<DubaiArea | null> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/areas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(area),
    });
    if (!response.ok) throw new Error('Failed to update area');
    return await response.json();
  } catch (error) {
    console.error('Error updating area:', error);
    return null;
  }
}

/**
 * Delete a Dubai area (requires authentication)
 */
export async function deleteDubaiArea(id: string): Promise<boolean> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/areas/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete area');
    return true;
  } catch (error) {
    console.error('Error deleting area:', error);
    return false;
  }
}

/**
 * Create a new Dubai landmark (requires authentication)
 */
export async function createDubaiLandmark(landmark: Partial<DubaiLandmark>): Promise<DubaiLandmark | null> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/landmarks`, {
      method: 'POST',
      body: JSON.stringify(landmark),
    });
    if (!response.ok) throw new Error('Failed to create landmark');
    return await response.json();
  } catch (error) {
    console.error('Error creating landmark:', error);
    return null;
  }
}

/**
 * Update a Dubai landmark (requires authentication)
 */
export async function updateDubaiLandmark(id: string, landmark: Partial<DubaiLandmark>): Promise<DubaiLandmark | null> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/landmarks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(landmark),
    });
    if (!response.ok) throw new Error('Failed to update landmark');
    return await response.json();
  } catch (error) {
    console.error('Error updating landmark:', error);
    return null;
  }
}

/**
 * Delete a Dubai landmark (requires authentication)
 */
export async function deleteDubaiLandmark(id: string): Promise<boolean> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/landmarks/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete landmark');
    return true;
  } catch (error) {
    console.error('Error deleting landmark:', error);
    return false;
  }
}

/**
 * Batch update Dubai areas and landmarks (requires authentication)
 */
export async function batchUpdateDubai(data: {
  areas: Partial<DubaiArea>[];
  landmarks: Partial<DubaiLandmark>[];
}): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authenticatedFetch(`${API_URL}/dubai/batch-update`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Batch update failed');
    return await response.json();
  } catch (error) {
    console.error('Error batch updating:', error);
    throw error;
  }
}

// ============================================================================
// RESIDENTIAL PROJECTS API (NEW SCHEMA)
// ============================================================================

/**
 * Fetch clustered residential projects from backend (server-side clustering)
 * Returns optimized clusters with only IDs, max 50 clusters
 */
export async function fetchResidentialProjectClusters(
  zoom: number,
  bounds?: MapBounds,
  filters?: Omit<PropertyFilters, 'bounds' | 'limit' | 'offset'>
): Promise<any[]> {
  const params = new URLSearchParams()
  params.append('zoom', zoom.toString())

  if (bounds) {
    params.append('minLng', bounds.minLng.toString())
    params.append('minLat', bounds.minLat.toString())
    params.append('maxLng', bounds.maxLng.toString())
    params.append('maxLat', bounds.maxLat.toString())
  }

  // Add all filters
  if (filters) {
    if (filters.developer) params.append('developer', filters.developer);
    if (filters.project) params.append('project', filters.project);
    if (filters.area) params.append('area', filters.area);
    if (filters.minPrice) params.append('minPrice', filters.minPrice.toString());
    if (filters.maxPrice) params.append('maxPrice', filters.maxPrice.toString());
    if (filters.minBedrooms) params.append('minBedrooms', filters.minBedrooms.toString());
    if (filters.maxBedrooms) params.append('maxBedrooms', filters.maxBedrooms.toString());
    if (filters.minSize) params.append('minSize', filters.minSize.toString());
    if (filters.maxSize) params.append('maxSize', filters.maxSize.toString());
    if (filters.status) params.append('status', filters.status);
  }

  try {
    const response = await fetch(`${API_URL}/residential-projects/clusters?${params.toString()}`)
    const result: ApiResponse<any[]> = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch project clusters')
    }

    return result.data
  } catch (error) {
    console.error('Error fetching residential project clusters:', error)
    return []
  }
}

/**
 * Map pin data for displaying projects on the map
 */
export interface MapPinProject {
  id: string
  name: string
  developer: string
  area: string
  minPrice: number | null
  maxPrice: number | null
  minBeds: number | null
  maxBeds: number | null
  status: string
  lat: number
  lng: number
  image: string | null
  completionDate: string | null
}

/**
 * Fetch all residential projects as map pins (no clustering)
 * Returns minimal data needed for map display with first image
 */
export async function fetchResidentialMapPins(): Promise<MapPinProject[]> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/map-pins`)
    const result: ApiResponse<MapPinProject[]> = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch map pins')
    }

    return result.data
  } catch (error) {
    console.error('Error fetching residential map pins:', error)
    return []
  }
}

/**
 * Fetch multiple residential projects by IDs (batch fetch, max 20)
 */
export async function fetchResidentialProjectsBatch(ids: string[]): Promise<any[]> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ids.slice(0, 20) }) // Max 20
    });

    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch projects');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching residential projects batch:', error);
    return [];
  }
}

/**
 * Fetch residential projects developers list
 */
export async function fetchResidentialDevelopers(): Promise<{ developer: string }[]> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/meta/developers`);
    const result: ApiResponse<{ developer: string }[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch developers');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching residential developers:', error);
    return [];
  }
}

/**
 * Fetch residential projects areas list with statistics
 */
export async function fetchResidentialAreas(): Promise<{
  area_name: string;
  project_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
}[]> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/meta/areas`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch areas');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching residential areas:', error);
    return [];
  }
}

/**
 * Fetch residential projects list with statistics
 */
export async function fetchResidentialProjects(): Promise<{
  project_name: string;
  developer: string;
  property_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
}[]> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/meta/projects`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch projects');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching residential projects:', error);
    return [];
  }
}

/**
 * Fetch single residential project by ID with full details
 */
export async function fetchResidentialProjectById(id: string): Promise<any | null> {
  try {
    const response = await fetch(`${API_URL}/residential-projects/${id}`);
    const result = await response.json();

    if (!result.project) {
      throw new Error('Project not found');
    }

    return result;
  } catch (error) {
    console.error('Error fetching residential project:', error);
    return null;
  }
}

// ============================================================================
// TRANSPORT API
// ============================================================================

export interface TransportGeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      id: string;
      category: string;
      name: string;
      color: string;
      [key: string]: any;
    };
    geometry: {
      type: 'LineString' | 'MultiLineString' | 'Point';
      coordinates: any;
    };
  }>;
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

/**
 * Fetch Dubai transport data as GeoJSON
 * @param categories - Optional array of categories to filter by
 */
export async function fetchTransportGeoJSON(categories?: TransportCategory[]): Promise<TransportGeoJSON | null> {
  try {
    let url = `${API_URL}/transport/geojson`;
    if (categories && categories.length > 0) {
      url += `?categories=${categories.join(',')}`;
    }
    const response = await fetch(url);
    const result = await response.json();

    if (!result.features) {
      throw new Error('Invalid GeoJSON response');
    }

    return result;
  } catch (error) {
    console.error('Error fetching transport GeoJSON:', error);
    return null;
  }
}

// ============================================================================
// Custom Routes API (replaces hardcoded transport data)
// ============================================================================

export interface CustomRoute {
  id: string;
  name: string;
  name_ar?: string;
  description?: string;
  color: string;
  line_width: number;
  route_type: string;
  geometry: any;  // GeoJSON LineString
  images?: string[];
  display_order: number;
  is_active: boolean;
  stops?: CustomStop[];
}

export interface CustomStop {
  id: string;
  route_id: string;
  name: string;
  name_ar?: string;
  description?: string;
  color?: string;
  location: { lat: number; lng: number };
  position_on_route?: number;
  images?: string[];
  display_order: number;
  is_active: boolean;
}

// Fetch all custom routes with stops
export async function fetchCustomRoutes(): Promise<CustomRoute[]> {
  try {
    const response = await fetch(`${API_URL}/custom-routes`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching custom routes:', error);
    return [];
  }
}

// Fetch custom routes as GeoJSON (for map display)
export async function fetchCustomRoutesGeoJSON(): Promise<TransportGeoJSON | null> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/geojson/all`);
    const result = await response.json();
    if (!result.features) {
      throw new Error('Invalid GeoJSON response');
    }
    return result;
  } catch (error) {
    console.error('Error fetching custom routes GeoJSON:', error);
    return null;
  }
}

// Create a new route
export async function createCustomRoute(route: Partial<CustomRoute>): Promise<CustomRoute | null> {
  try {
    const response = await fetch(`${API_URL}/custom-routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route),
    });
    return await response.json();
  } catch (error) {
    console.error('Error creating custom route:', error);
    return null;
  }
}

// Update a route
export async function updateCustomRoute(id: string, updates: Partial<CustomRoute>): Promise<CustomRoute | null> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating custom route:', error);
    return null;
  }
}

// Delete a route
export async function deleteCustomRoute(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/${id}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch (error) {
    console.error('Error deleting custom route:', error);
    return false;
  }
}

// Create a stop
export async function createCustomStop(routeId: string, stop: Partial<CustomStop>): Promise<CustomStop | null> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/${routeId}/stops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stop),
    });
    return await response.json();
  } catch (error) {
    console.error('Error creating custom stop:', error);
    return null;
  }
}

// Update a stop
export async function updateCustomStop(id: string, updates: Partial<CustomStop>): Promise<CustomStop | null> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/stops/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating custom stop:', error);
    return null;
  }
}

// Delete a stop
export async function deleteCustomStop(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/stops/${id}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch (error) {
    console.error('Error deleting custom stop:', error);
    return false;
  }
}

// Batch update stops (for repositioning after route edit)
export async function batchUpdateStops(
  routeId: string,
  stops: Array<{ id: string; location: { lat: number; lng: number }; position_on_route?: number }>
): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/custom-routes/${routeId}/stops/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stops }),
    });
    return response.ok;
  } catch (error) {
    console.error('Error batch updating stops:', error);
    return false;
  }
}
// ---- 成交真相层：价格体检 ----
export interface PriceCheckResult {
  matched: boolean;
  reason?: string;
  projectArea?: string | null;
  summary?: string;
  areaName?: string;
  sampleCount?: number;
  confidence?: 'ok' | 'low';
  dataThrough?: string | null;
  windowMonths?: number;
  currency?: string;
  unit?: string;
  area?: { min: number; p25: number; median: number; p75: number; max: number };
  project?: { pricePerSqm: number | null; source: string | null };
  premiumPct?: number | null;
  verdict?: { level: string; label: string; explanation: string };
  methodology?: string;
}

export async function fetchPriceCheck(projectId: string): Promise<PriceCheckResult | null> {
  try {
    const res = await fetch(`${API_URL}/market/price-check?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Error fetching price check:', error);
    return null;
  }
}

// ---- 成交查询（功能 B）----
export interface TxFilters { areas: { name: string; count: number }[]; rooms: string[] }
export interface TxSummary {
  count: number;
  pricePerSqm: { min: number; p25: number; median: number; p75: number; max: number; avg: number } | null;
  medianUnitPrice: number | null;
  avgSizeSqm: number | null;
  totalVolume: number | null;
  trend: { month: string; count: number; medianPps: number }[];
  note: string;
}
export interface TxRow {
  date: string | null; area: string; building: string; rooms: string;
  sizeSqm: number | null; price: number | null; pricePerSqm: number | null;
  saleType: 'offplan' | 'ready';
}
function txQuery(p: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return qs.toString();
}
export async function fetchTxFilters(): Promise<TxFilters> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/filters`);
    if (!r.ok) return { areas: [], rooms: [] };
    return await r.json();
  } catch { return { areas: [], rooms: [] }; }
}
export async function fetchTxSummary(p: Record<string, string | undefined>): Promise<TxSummary | null> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/summary?${txQuery(p)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
export async function fetchTxList(p: Record<string, string | undefined>): Promise<{ rows: TxRow[]; limit: number; offset: number }> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/list?${txQuery(p)}`);
    if (!r.ok) return { rows: [], limit: 25, offset: 0 };
    return await r.json();
  } catch { return { rows: [], limit: 25, offset: 0 }; }
}

// ---- 区域分级（功能 C）----
export interface AreaClass {
  id: string; name: string; tag: string; label: string; reasons: string[];
  metrics: {
    transactionCount: number | null; capitalGrowthPct: number | null;
    rentalYieldPct: number | null; medianUnitPrice: number | null; medianPriceSqm: number | null;
  };
  perspective: { invest: string; live: string };
}
export interface AreaClassResp {
  thresholds: { volume_high: number; volume_low: number; growth_high_pct: number };
  methodology: string; count: number; areas: AreaClass[];
}
export async function fetchAreaClassification(): Promise<AreaClassResp | null> {
  try {
    const r = await fetch(`${API_URL}/market/area-classification`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
export async function fetchAreaCompare(a: string, b: string): Promise<{ matched: boolean; a?: AreaClass; b?: AreaClass; summary: string } | null> {
  try {
    const r = await fetch(`${API_URL}/market/area-compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ---- AI 买房决策报告（功能 E）----
export interface Proj5yr {
  purchase_price: number; rental_income_5yr: number; appreciation_5yr: number;
  total_profit_5yr: number; annualized_return_pct: number;
}
export interface BuyingRec {
  area: string; tag: string; label: string; why: string[];
  perspective: { invest: string; live: string };
  metrics: { transactionCount: number | null; capitalGrowthPct: number | null; rentalYieldPct: number | null; medianUnitPrice: number | null };
  assumedPrice: number; paybackYears: number | null; dataQualityNote: string | null;
  projection: { horizonYears: number; conservative: Proj5yr | null; neutral: Proj5yr | null; optimistic: Proj5yr | null };
  matchingProjects: { id: string; developer: string; status: string; minPrice: number | null; maxPrice: number | null }[];
}
export interface BuyingReport {
  goal: string; goalLabel: string; budgetMax: number | null; bedrooms: string | null;
  horizonYears: number; generatedAt: string; recommendations: BuyingRec[];
  assumptions: string[]; disclaimer: string;
}
export async function generateBuyingReport(body: {
  goal: string; budgetMax?: number; bedrooms?: string; horizonYears?: number;
}): Promise<BuyingReport | null> {
  try {
    const r = await fetch(`${API_URL}/market/buying-report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ---- 数据版本指纹（客户端缓存自动失效）----
export async function fetchDataVersion(): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}/meta/data-version`);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.version ?? null;
  } catch { return null; }
}
