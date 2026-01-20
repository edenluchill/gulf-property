import { PropertyFilters, MapBounds, DubaiArea, DubaiLandmark } from '../types';
import { API_BASE_URL } from './config';

// 后端路由都在 /api/* 下，所以需要添加 /api 前缀
const API_URL = `${API_BASE_URL}/api`;

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
 * Create a new Dubai area
 */
export async function createDubaiArea(area: Partial<DubaiArea>): Promise<DubaiArea | null> {
  try {
    const response = await fetch(`${API_URL}/dubai/areas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
 * Update a Dubai area
 */
export async function updateDubaiArea(id: string, area: Partial<DubaiArea>): Promise<DubaiArea | null> {
  try {
    const response = await fetch(`${API_URL}/dubai/areas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
 * Delete a Dubai area
 */
export async function deleteDubaiArea(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/dubai/areas/${id}`, {
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
 * Create a new Dubai landmark
 */
export async function createDubaiLandmark(landmark: Partial<DubaiLandmark>): Promise<DubaiLandmark | null> {
  try {
    const response = await fetch(`${API_URL}/dubai/landmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
 * Update a Dubai landmark
 */
export async function updateDubaiLandmark(id: string, landmark: Partial<DubaiLandmark>): Promise<DubaiLandmark | null> {
  try {
    const response = await fetch(`${API_URL}/dubai/landmarks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
 * Delete a Dubai landmark
 */
export async function deleteDubaiLandmark(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/dubai/landmarks/${id}`, {
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
 * Batch update Dubai areas and landmarks
 */
export async function batchUpdateDubai(data: {
  areas: Partial<DubaiArea>[];
  landmarks: Partial<DubaiLandmark>[];
}): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${API_URL}/dubai/batch-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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