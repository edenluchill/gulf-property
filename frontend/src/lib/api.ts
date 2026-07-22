import { PropertyFilters, MapBounds, DubaiArea, DubaiLandmark } from '../types';
import type { AreaMonthly as AreaMonthlyResponse } from './map/timeline';
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

// ── Sealed /dubai/areas decode (mirrors backend services/seal.ts) ──────────────
// OBFUSCATION ONLY: these passphrases live in the bundle by necessity (we must be
// able to decrypt to render). Multi-stage + daily rotation just raises the cost of
// casual copying — the Network tab shows binary, and a recorded scraper breaks
// every day. It does not stop a determined scripter.
const VEIL_PASS = 'pinzos-area-veil-v1';
const XOR_PASS = 'pinzos-area-xor-v1';

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}
async function sha256Bytes(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function veilKeystream(date: string, len: number): Promise<Uint8Array> {
  const out = new Uint8Array(len);
  for (let i = 0; i * 32 < len; i++) {
    const block = await sha256Bytes(`${XOR_PASS}:${date}:${i}`);
    out.set(block.subarray(0, Math.min(32, len - i * 32)), i * 32);
  }
  return out;
}
async function gunzipToText(buf: ArrayBuffer): Promise<string> {
  const stream = new Response(buf).body!.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
async function unsealWith(buf: ArrayBuffer, date: string): Promise<DubaiArea[]> {
  const blob = new Uint8Array(buf.slice(0));
  const ks = await veilKeystream(date, blob.length);          // stage 1: undo XOR
  for (let i = 0; i < blob.length; i++) blob[i] ^= ks[i];
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const ctTag = new Uint8Array(ct.length + 16);
  ctTag.set(ct); ctTag.set(tag, ct.length);
  const keyBytes = await sha256Bytes(`${VEIL_PASS}:${date}`);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']
  );
  const gz = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ctTag as unknown as BufferSource
  ); // stage 2: AES
  return JSON.parse(await gunzipToText(gz));                                    // stage 3: gunzip
}

/**
 * Fetch Dubai areas (districts with boundaries). Requests the sealed variant and
 * decrypts client-side; tries today then yesterday (UTC) to survive the daily
 * key rollover at the midnight boundary / minor clock skew.
 */
export async function fetchDubaiAreas(usage?: string, segment?: string): Promise<DubaiArea[]> {
  const u = usage && usage !== 'residential' ? `&usage=${encodeURIComponent(usage)}` : '';
  // 市场口径（全部/期房/现房）——地图口径筛选器显式传；不传时服务端有自己的默认
  const s = segment ? `&segment=${encodeURIComponent(segment)}` : '';
  try {
    const response = await fetch(`${API_URL}/dubai/areas?sealed=1${u}${s}`);
    if (!response.ok) throw new Error(`areas ${response.status}`);
    const buf = await response.arrayBuffer();
    for (const date of [utcDate(0), utcDate(-1)]) {
      try { return await unsealWith(buf, date); } catch { /* try previous day */ }
    }
    throw new Error('unseal failed');
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
    // 非 200(如计量门 429)返回 {success:false,...} —— 直接当数组用会让下游 .map 崩掉整棵树
    if (!response.ok) return [];
    const results = await response.json();
    return Array.isArray(results) ? results : [];
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
    // 非 200(如计量门 429)返回 {success:false,...} —— 曾把它当数组返回,
    // MapPage 里 .map 直接白屏整站。永远只返回真数组。
    if (!response.ok) return [];
    const landmarks = await response.json();
    return Array.isArray(landmarks) ? landmarks : [];
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
  /** 付款结构档位 "建设期/交付"(如 "80/20"),后端从 payment_plan 推导;无数据为 null */
  paymentPlan?: string | null
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
  /** 后端只回 level(code);文案由 PriceCheckModule 走 t('compare:priceCheck.*') 出。 */
  verdict?: { level: string };
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
/**
 * 数据截止到哪天。DLD 会**停发数据**(2026-07-08 起停了 6 天),那时页面上最新一条
 * 就停住不动,看起来像我们坏了 —— owner 和经纪都会这么以为。把截止日标出来,
 * 断更就是一句「数据截至 X 日」的事实,不是 bug。
 */
export interface DataFreshness {
  txThrough: string | null       // 最新成交日
  txPublishedAt: string | null   // DLD 最后一次发布成交的时间(源 API 自带字段)
  rentPublishedAt: string | null
}
export async function fetchDataFreshness(): Promise<DataFreshness | null> {
  try {
    // 走 /meta 而不是 /market —— /api/market 整个前缀挂了 mapMeter(匿名地图限时),
    // 放那儿会烧地图额度,还会对额度用完的匿名访客 429。
    const r = await fetch(`${API_URL}/meta/data-freshness`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null } // 拿不到就不显示这行,绝不能挡住整页数据
}
function txQuery(p: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(x => { if (x) qs.append(k, x); });  // 多选(如 project)重复传参
    else if (v) qs.set(k, v);
  });
  return qs.toString();
}
export async function fetchTxFilters(): Promise<TxFilters> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/filters`);
    if (!r.ok) return { areas: [], rooms: [] };
    return await r.json();
  } catch { return { areas: [], rooms: [] }; }
}
/** 统一搜索建议:一个框同时搜区域 / 楼盘 / 楼栋。 */
export interface TxSuggestion {
  type: 'area' | 'project' | 'building';
  name: string;
  count: number;
  area?: string | null;      // project / building 所属区域
  project?: string | null;   // building 所属楼盘
  buildings?: number;        // project 下的楼栋数(>1 才提示「含 N 栋」)
}
export async function fetchTxSuggest(q: string): Promise<TxSuggestion[]> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/suggest?${txQuery({ q })}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.suggestions || [];
  } catch { return []; }
}
export async function fetchTxProjects(params: { area?: string; q?: string }): Promise<{ name: string; count: number }[]> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/projects?${txQuery(params)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.projects || [];
  } catch { return []; }
}
export async function fetchTxSummary(p: Record<string, string | string[] | undefined>): Promise<TxSummary | null> {
  // 失败自动重试一次（部署重启/网络抖动的瞬时失败不该让用户看到"无数据"）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API_URL}/market/transactions/summary?${txQuery(p)}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    if (attempt === 0) await new Promise(res => setTimeout(res, 1200));
  }
  return null;
}
export async function fetchTxList(p: Record<string, string | string[] | undefined>): Promise<{ rows: TxRow[]; limit: number; offset: number }> {
  try {
    const r = await fetch(`${API_URL}/market/transactions/list?${txQuery(p)}`);
    if (!r.ok) return { rows: [], limit: 25, offset: 0 };
    return await r.json();
  } catch { return { rows: [], limit: 25, offset: 0 }; }
}

// ---- 租金市场（/transactions 页的租金视图）----
export interface RentSummary {
  count: number;
  rentPerSqm: { p25: number; median: number; p75: number } | null;
  medianAnnualRent: number | null;
  avgSizeSqm: number | null;
  totalVolume: number | null;
  trend: { month: string; count: number; medianSqm: number }[];
  note: string;
}
export interface RentRow {
  date: string | null; area: string; building: string; subtype: string;
  sizeSqm: number | null; annualRent: number | null; rentPerSqm: number | null;
  regType: 'new' | 'renew';
}
export async function fetchRentFilters(): Promise<{ areas: { name: string; count: number }[] }> {
  try {
    const r = await fetch(`${API_URL}/market/rent/filters`);
    if (!r.ok) return { areas: [] };
    return await r.json();
  } catch { return { areas: [] }; }
}
export async function fetchRentProjects(params: { area?: string; q?: string }): Promise<{ name: string; count: number }[]> {
  try {
    const r = await fetch(`${API_URL}/market/rent/projects?${txQuery(params)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.projects || [];
  } catch { return []; }
}
export async function fetchRentSummary(p: Record<string, string | string[] | undefined>): Promise<RentSummary | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API_URL}/market/rent/summary?${txQuery(p)}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    if (attempt === 0) await new Promise(res => setTimeout(res, 1200));
  }
  return null;
}
export async function fetchRentList(p: Record<string, string | string[] | undefined>): Promise<{ rows: RentRow[]; limit: number; offset: number }> {
  try {
    const r = await fetch(`${API_URL}/market/rent/list?${txQuery(p)}`);
    if (!r.ok) return { rows: [], limit: 25, offset: 0 };
    return await r.json();
  } catch { return { rows: [], limit: 25, offset: 0 }; }
}

// ---- 区域洞察（地图区域弹窗：四指标月度序列 + 近期成交）----
// 增值率周期 key,与后端 APPRECIATION_PERIODS + 前端 PeriodSelector 一一对应。
export type AppreciationPeriodKey = '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '5y';
export type AppreciationByPeriod = Partial<Record<AppreciationPeriodKey, number | null>>;

// 单周期窗口内的全指标值(「近N期」口径)。
export interface PeriodMetrics {
  growth: number | null;    // 窗口涨幅(增值率)
  priceSqm: number | null;  // 窗口内中位价/㎡
  unitPrice: number | null; // 窗口内中位总价
  count: number;            // 窗口内成交量
  yield: number | null;     // 窗口内回报率(仅 all 口径)
}
export type MetricsByPeriod = Partial<Record<AppreciationPeriodKey, PeriodMetrics>>;

export interface AreaInsights {
  months: string[];
  price: (number | null)[];
  volume: number[];
  /** 全口径月度成交量（含现房/地块）——成交量展示用，不随价格口径缩水 */
  volumeAll?: number[];
  growth: (number | null)[];
  /** 各周期资本增值率(跟随 segment 口径);滚动窗口中位价之比,样本不足为 null */
  appreciation?: AppreciationByPeriod;
  /** 全市同口径增值率基准(「本区 vs 全市」对比) */
  appreciationCity?: AppreciationByPeriod;
  /** 各周期全指标窗口值(价格/总价/成交量/回报;跟随 segment) */
  metricsByPeriod?: MetricsByPeriod;
  rentalYield: (number | null)[];
  dataThrough: string | null;
  medianUnitPrice?: number | null;   // median TOTAL transaction price (房子中位总价) for the usage
  /** 请求的市场口径（散客默认 offplan） */
  segment?: 'offplan' | 'ready' | 'all';
  /** 价格/增长实际生效口径 —— 期房样本不足时后端回退 'all'，前端要如实标注 */
  priceSegment?: 'offplan' | 'ready' | 'all';
  segmentCounts12m?: { all: number; offplan: number; ready: number };
  /** 成交列表实际口径：offplan/ready = 该口径专取的 30 条；all = 混合列表（带标签） */
  txSegment?: 'offplan' | 'ready' | 'all';
  recentTransactions: {
    date: string | null; building: string | null; rooms: string | null;
    sizeSqm: number | null; price: number | null; pricePerSqm: number | null;
    saleType: 'offplan' | 'ready';
  }[];
  recentRentals?: {
    date: string | null; building: string | null; subtype: string | null;
    sizeSqm: number | null; annualRent: number | null; rentPerSqm: number | null;
    regType: 'new' | 'renew';
  }[];
}
// 全部官方区各周期增值率(三口径),地图按周期上色用。一次取回,切周期/口径不重取。
export interface AllAreaAppreciation {
  dataThrough: string | null;
  areas: Record<string, Record<'all' | 'offplan' | 'ready', MetricsByPeriod>>;
}
export async function fetchAllAreaAppreciation(): Promise<AllAreaAppreciation | null> {
  try {
    const r = await fetch(`${API_URL}/market/area-appreciation`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// 路网测距(自建 OSRM)。恒返回结果 —— OSRM 不可用时后端给直线×1.35 的估算值并标
// mode:'estimate',前端据此画虚线 + 标「估算」,绝不把估算冒充实测路线。
export interface RoadRoute {
  mode: 'road' | 'estimate';
  distanceKm: number;
  durationMin: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null;
}
export async function fetchRoadRoute(
  a: { lat: number; lng: number }, b: { lat: number; lng: number }
): Promise<RoadRoute | null> {
  try {
    const q = `a=${a.lat},${a.lng}&b=${b.lat},${b.lng}`;
    const r = await fetch(`${API_URL}/routing/route?${q}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// 各区逐月(近 3 个月滚动)中位租金/成交价/同比 —— 地图时间轴用。gzip 后约 72KB,
// 一次全取,拖动零请求(着色走 feature-state,见 lib/map/timeline.ts 文件头)。
export async function fetchAreaMonthly(): Promise<AreaMonthlyResponse | null> {
  try {
    const r = await fetch(`${API_URL}/market/area-monthly`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchAreaInsights(areaId: string, usage?: string, segment?: string): Promise<AreaInsights | null> {
  try {
    // Backend default is 'all' — send the param for every non-'all' usage
    // (omitting it for 'residential' used to silently return all-usage data).
    const u = usage && usage !== 'all' ? `&usage=${encodeURIComponent(usage)}` : '';
    // 市场口径：显式传（不传时后端按散客默认=期房）；经纪面可传 'all'
    const s = segment ? `&segment=${encodeURIComponent(segment)}` : '';
    const r = await fetch(`${API_URL}/market/area-insights?areaId=${encodeURIComponent(areaId)}${u}${s}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ---- 区域弹窗内下钻：在本区内搜楼盘 / 楼栋 ----
//
// 候选一次全量取回、在内存里匹配 —— 打字零请求（也就零地图额度，见 mapMeter
// 的 UNMETERED 注释：输入辅助不是数据消费）。跨区细筛仍走成交页深链。
export interface AreaPlace {
  name: string;
  txCount: number;
  rentCount?: number;     // 楼盘才有（租约表没有 building_name 列）
  buildings?: number;     // 楼盘名下的楼栋数
  project?: string | null; // 楼栋所属楼盘
}
export interface AreaPlaces { projects: AreaPlace[]; buildings: AreaPlace[] }
export async function fetchAreaPlaces(areaId: string): Promise<AreaPlaces> {
  try {
    const r = await fetch(`${API_URL}/market/area-places?areaId=${encodeURIComponent(areaId)}`);
    if (!r.ok) return { projects: [], buildings: [] };
    return await r.json();
  } catch { return { projects: [], buildings: [] }; }
}
/** 弹窗成交列表（下钻 + 翻页）。口径跟随 usage 透镜，与弹窗指标一致。
 *  行结构刻意与 AreaInsights.recentTransactions 逐字段相同 —— 列表直接拼接。 */
export type AreaTxRow = AreaInsights['recentTransactions'][number]
export type AreaRentRow = NonNullable<AreaInsights['recentRentals']>[number]
export async function fetchAreaTx(p: {
  areaId: string; usage?: string; type?: string;
  project?: string; building?: string; limit?: number; offset?: number;
}): Promise<{ rows: AreaTxRow[] }> {
  try {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => {
      if (v === undefined || v === '') return;
      // 'all' 是 usage/type 的「不筛」哨兵值，别顺手把叫 all 的楼盘名也吃掉
      if ((k === 'usage' || k === 'type') && v === 'all') return;
      qs.set(k, String(v));
    });
    const r = await fetch(`${API_URL}/market/area-tx?${qs.toString()}`);
    if (!r.ok) return { rows: [] };
    return await r.json();
  } catch { return { rows: [] }; }
}
export async function fetchAreaRentals(p: {
  areaId: string; project?: string; limit?: number; offset?: number;
}): Promise<{ rows: AreaRentRow[] }> {
  try {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
    const r = await fetch(`${API_URL}/market/area-rentals?${qs.toString()}`);
    if (!r.ok) return { rows: [] };
    return await r.json();
  } catch { return { rows: [] }; }
}

// ---- 区域分级（功能 C）----
/** 区域分级。**后端只回结构化数据,不回文案** —— label/perspective 都是 tag 的
 *  一一映射(前端按 tag 出 t());reasons 是 { code, params } 由前端 t(code, params) 渲染。 */
export interface AreaClassReason { code: string; params?: Record<string, number> }
export interface AreaClass {
  id: string; name: string; tag: string; reasons: AreaClassReason[];
  metrics: {
    transactionCount: number | null; capitalGrowthPct: number | null;
    rentalYieldPct: number | null; medianUnitPrice: number | null; medianPriceSqm: number | null;
  };
}
export interface AreaClassResp {
  thresholds: { volume_high: number; volume_low: number; growth_high_pct: number };
  // methodology 文案已移到前端 t('insights:classification.methodology')。
  count: number; areas: AreaClass[];
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
  area: string; tag: string; why: AreaClassReason[];
  metrics: { transactionCount: number | null; capitalGrowthPct: number | null; rentalYieldPct: number | null; medianUnitPrice: number | null };
  assumedPrice: number; paybackYears: number | null;
  /** code(目前只有 'growth_clamped')或 null;文案由前端 t() 出。 */
  dataQualityNote: string | null;
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

// ---- 项目投资 + 位置情报（详情页改版）----
export interface YieldFactor {
  key: 'price' | 'rent' | 'offplan';
  dir: 'up' | 'down' | 'flat';
  label: string;
  detail: string;
  est_pp: number | null;
}

export interface YieldComparison {
  basis: 'measured' | 'price_adjusted'; // price_adjusted ⇢ 项目回报为估算(按区域租金)
  estimated: boolean;
  project_yield_pct: number;
  area_yield_pct: number;
  gap_pp: number;
  verdict: 'above' | 'inline' | 'below';
  premium_pct: number | null;
  tier: 'development' | 'area' | 'area_name';
  confidence: 'high' | 'medium' | 'low';
  sample_n: number | null;
  data_through: string | null;
  factors: YieldFactor[];
}

export interface ProjectInsights {
  area: {
    id: string | null;
    name: string | null;
    median_price_sqm: number | null;
    rental_yield_pct: number | null;
    price_growth_pct: number | null;
    sales_transaction_count: number | null;
    data_through: string | null;
    // Matching precision: 'development' (master_project, tightest) > 'area'
    // (spatial official community) > 'area_name' (legacy fallback).
    tier: 'development' | 'area' | 'area_name';
    label: string | null;
    confidence: 'high' | 'medium' | 'low';
    rent_count: number | null;
  } | null;
  investment: {
    purchase_price: number;
    rental_income_5yr: number;
    appreciation_5yr: number;
    total_profit_5yr: number;
    annualized_return_pct: number;
    area_yield_pct?: number;
    area_growth_pct?: number;
    payback_years: number | null;
    reference_price: number;
  } | null;
  // 项目(开发体)租金回报 vs 所在区域,含价格×租金的精确分解;仅在有独立开发体
  // 回报时出现(项目太新→只知区域→为 null)。见后端 projectInsights.ts。
  yield_comparison: YieldComparison | null;
  nearby: {
    metro: { name: string; distance_m: number; lat?: number; lng?: number }[];
    pois: { category: string; name: string; distance_m: number; lat?: number; lng?: number }[];
    landmarks: { name: string; type: string; distance_m: number; lat?: number; lng?: number }[];
  };
  commute: { hub: string; distance_m: number; mins_est: number }[];
}

// ---- 本盘 + 附近同类项目横评（对比分析 tab）----
export interface CompareRow {
  id: string;
  name: string | null;
  developer: string | null;
  area: string | null;
  distance_m: number | null;
  status: string | null;
  starting_price: number | null;
  yield_pct: number | null;
  growth_pct: number | null;
  annualized_5yr: number | null;
  premium_pct: number | null;
  yield_gap_pp: number | null;
  tier: 'development' | 'area' | 'area_name' | null;
  confidence: 'high' | 'medium' | 'low' | null;
}
export async function fetchNearbyCompare(id: string): Promise<{ subject: CompareRow; nearby: CompareRow[] } | null> {
  try {
    const r = await fetch(`${API_URL}/residential-projects/${id}/nearby-compare`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.success ? j.data : null;
  } catch { return null; }
}

export async function fetchProjectInsights(id: string): Promise<ProjectInsights | null> {
  try {
    const r = await fetch(`${API_URL}/residential-projects/${id}/insights`);
    if (!r.ok) return null;
    const json = await r.json();
    return json?.success ? (json.data as ProjectInsights) : null;
  } catch {
    return null;
  }
}

// ---- 项目真实成交（DLD，按匹配到的开发体）----
export interface ProjectTransactions {
  matched: boolean
  development: string | null
  sales: { date: string | null; building: string | null; rooms: string | null; sizeSqm: number | null; price: number | null; pricePerSqm: number | null; saleType: 'offplan' | 'ready' }[]
  rentals: { date: string | null; building: string | null; subtype: string | null; sizeSqm: number | null; annualRent: number | null; rentPerSqm: number | null; regType: 'new' | 'renew' }[]
}

export async function fetchProjectTransactions(id: string): Promise<ProjectTransactions | null> {
  try {
    const r = await fetch(`${API_URL}/residential-projects/${id}/transactions`)
    if (!r.ok) return null
    const json = await r.json()
    return json?.success ? (json.data as ProjectTransactions) : null
  } catch {
    return null
  }
}

// ============================================================================
// AI ANALYTICS — 找房助手（affordability / recommend）。公开路由，无需 auth。
// 形状对齐 backend/src/routes/ai-analytics.ts + recommend_for_budget()。
// ============================================================================

/** recommend_for_budget() 返回的单个区域。affordable_areas / recommend.results 共用此形状。 */
export interface RecommendedArea {
  area_name: string
  median_price_aed: number
  median_price_sqm: number
  sales_count: number
  gross_yield_pct: number | null
  cagr_3y_pct: number | null
}

export interface AffordabilityResult {
  max_price_aed: number
  down_payment_aed: number
  monthly_payment_aed: number | null
  assumptions: { down_pct: number; rate: number; years: number; dbr: number }
  affordable_areas: RecommendedArea[]
}

export type RecommendGoal = 'yield' | 'growth' | 'balanced'

export interface AffordabilityParams {
  income?: number
  cash?: number
  down_pct?: number
  rate?: number
  years?: number
  property_type?: string
  bedrooms?: number
}

export interface RecommendParams {
  budget: number
  goal?: RecommendGoal
  property_type?: string
  bedrooms?: number
  limit?: number
}

function analyticsQuery(p: AffordabilityParams | RecommendParams): string {
  const qs = new URLSearchParams()
  Object.entries(p as Record<string, string | number | undefined>).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  })
  return qs.toString()
}

/** 月收入或首付现金 → 可买总价 + 预算内推荐区域。后端默认 DLD 假设(首付20%/利率4.5%/25年/DBR40%)。 */
export async function fetchAffordability(params: AffordabilityParams): Promise<AffordabilityResult | null> {
  try {
    const r = await fetch(`${API_URL}/ai/analytics/affordability?${analyticsQuery(params)}`)
    if (!r.ok) return null
    return await r.json()
  } catch (error) {
    console.error('Error fetching affordability:', error)
    return null
  }
}

/** 预算 + 目标 → 按 净/毛回报+增值 排序的推荐区域列表。 */
export async function fetchRecommendAreas(params: RecommendParams): Promise<RecommendedArea[]> {
  try {
    const r = await fetch(`${API_URL}/ai/analytics/recommend?${analyticsQuery(params)}`)
    if (!r.ok) return []
    const data: { results?: RecommendedArea[] } = await r.json()
    return data.results ?? []
  } catch (error) {
    console.error('Error fetching recommendations:', error)
    return []
  }
}

/**
 * investment_analysis() 原样返回。/ai/analytics/investment 公开路由,直接吐 SQL 函数的 jsonb。
 * 无成交时返回 { error, area, ptype, bedrooms } —— 调用方据 'error' 判断 no-data。
 * net_yield = 本函数 gross − 片区物业费 drag;service_charge_sqft / net_yield_pct 缺物业费时为 null。
 */
export interface AreaInvestment {
  area: string
  ptype: string
  bedrooms: number | null
  is_offplan: boolean | null
  sample: { sales_count: number; rent_count: number; confidence: 'high' | 'medium' | 'low' }
  median_price_aed: number
  median_price_sqm: number
  avg_size_sqm: number
  gross_yield_pct: number | null
  net_yield_pct: number | null
  service_charge_sqft: number | null
  cagr_3y_pct: number
  growth_used_pct: number
  projection_5y: {
    future_price_aed: number
    rental_income_5y_aed: number
    total_roi_pct: number
    payback_years: number | null
  }
  note: string
  error?: undefined
}

interface AreaInvestmentError {
  error: string
  area: string
  ptype: string
  bedrooms: number | null
}

/** 片区投资分析（毛/净回报 + 物业费）。无数据返回 null,调用方安全跳过净回报块。 */
export async function fetchAreaInvestment(
  area: string,
  bedrooms?: number | null,
  offplan?: boolean | null
): Promise<AreaInvestment | null> {
  if (!area) return null
  try {
    const qs = new URLSearchParams({ area, property_type: 'apartment' })
    if (bedrooms != null) qs.set('bedrooms', String(bedrooms))
    if (offplan != null) qs.set('offplan', String(offplan))
    const r = await fetch(`${API_URL}/ai/analytics/investment?${qs.toString()}`)
    if (!r.ok) return null
    const data: AreaInvestment | AreaInvestmentError = await r.json()
    if ((data as AreaInvestmentError).error) return null
    return data as AreaInvestment
  } catch (error) {
    console.error('Error fetching area investment:', error)
    return null
  }
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
