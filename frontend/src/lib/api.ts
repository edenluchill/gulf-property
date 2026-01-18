import { OffPlanProperty, PropertyFilters, PropertySearchResult, MapBounds, DubaiArea, DubaiLandmark } from '../types';
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

/**
 * Convert snake_case API response to camelCase for frontend
 */
function convertProperty(apiProperty: any): OffPlanProperty {
  return {
    id: apiProperty.id,
    buildingId: apiProperty.building_id,
    buildingName: apiProperty.building_name,
    projectName: apiProperty.project_name,
    buildingDescription: apiProperty.building_description,
    developer: apiProperty.developer,
    developerId: apiProperty.developer_id,
    developerLogoUrl: apiProperty.developer_logo_url,
    location: apiProperty.location,
    areaName: apiProperty.area_name,
    areaId: apiProperty.area_id,
    dldLocationId: apiProperty.dld_location_id,
    minBedrooms: apiProperty.min_bedrooms,
    maxBedrooms: apiProperty.max_bedrooms,
    bedsDescription: apiProperty.beds_description,
    minSize: apiProperty.min_size,
    maxSize: apiProperty.max_size,
    startingPrice: apiProperty.starting_price,
    medianPriceSqft: apiProperty.median_price_sqft,
    medianPricePerUnit: apiProperty.median_price_per_unit,
    medianRentPerUnit: apiProperty.median_rent_per_unit,
    launchDate: apiProperty.launch_date,
    completionDate: apiProperty.completion_date,
    completionPercent: apiProperty.completion_percent,
    status: apiProperty.status,
    unitCount: apiProperty.unit_count,
    buildingUnitCount: apiProperty.building_unit_count,
    salesVolume: apiProperty.sales_volume,
    propSalesVolume: apiProperty.prop_sales_volume,
    images: apiProperty.images || [],
    logoUrl: apiProperty.logo_url,
    brochureUrl: apiProperty.brochure_url,
    amenities: apiProperty.amenities || [],
    displayAs: apiProperty.display_as,
    verified: apiProperty.verified,
    createdAt: apiProperty.created_at,
    updatedAt: apiProperty.updated_at,
  };
}

/**
 * Fetch clustered properties from backend (server-side clustering)
 * Returns optimized clusters with only IDs, max 100 clusters
 */
export async function fetchPropertyClusters(
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
    if (filters.minPriceSqft) params.append('minPriceSqft', filters.minPriceSqft.toString());
    if (filters.maxPriceSqft) params.append('maxPriceSqft', filters.maxPriceSqft.toString());
    if (filters.minBedrooms) params.append('minBedrooms', filters.minBedrooms.toString());
    if (filters.maxBedrooms) params.append('maxBedrooms', filters.maxBedrooms.toString());
    if (filters.minSize) params.append('minSize', filters.minSize.toString());
    if (filters.maxSize) params.append('maxSize', filters.maxSize.toString());
    if (filters.launchDateStart) params.append('launchDateStart', filters.launchDateStart);
    if (filters.launchDateEnd) params.append('launchDateEnd', filters.launchDateEnd);
    if (filters.completionDateStart) params.append('completionDateStart', filters.completionDateStart);
    if (filters.completionDateEnd) params.append('completionDateEnd', filters.completionDateEnd);
    if (filters.minCompletionPercent !== undefined) params.append('minCompletionPercent', filters.minCompletionPercent.toString());
    if (filters.maxCompletionPercent !== undefined) params.append('maxCompletionPercent', filters.maxCompletionPercent.toString());
    if (filters.status) params.append('status', filters.status);
  }

  try {
    const response = await fetch(`${API_URL}/properties/clusters?${params.toString()}`)
    const result: ApiResponse<any[]> = await response.json()

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch property clusters')
    }

    return result.data
  } catch (error) {
    console.error('Error fetching property clusters:', error)
    return []
  }
}

/**
 * Fetch multiple properties by IDs (batch fetch, max 10)
 */
export async function fetchPropertiesBatch(ids: string[]): Promise<OffPlanProperty[]> {
  try {
    const response = await fetch(`${API_URL}/properties/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ids.slice(0, 10) }) // Max 10
    });

    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch properties');
    }

    return result.data.map(convertProperty);
  } catch (error) {
    console.error('Error fetching properties batch:', error);
    return [];
  }
}

/**
 * Fetch properties for map view with bounding box
 */
export async function fetchPropertiesForMap(
  bounds?: MapBounds,
  filters?: Omit<PropertyFilters, 'bounds' | 'limit' | 'offset'>
): Promise<OffPlanProperty[]> {
  const params = new URLSearchParams();

  if (bounds) {
    params.append('minLng', bounds.minLng.toString());
    params.append('minLat', bounds.minLat.toString());
    params.append('maxLng', bounds.maxLng.toString());
    params.append('maxLat', bounds.maxLat.toString());
  }

  if (filters) {
    if (filters.developer) params.append('developer', filters.developer);
    if (filters.project) params.append('project', filters.project);
    if (filters.area) params.append('area', filters.area);
    if (filters.minPrice) params.append('minPrice', filters.minPrice.toString());
    if (filters.maxPrice) params.append('maxPrice', filters.maxPrice.toString());
    if (filters.minPriceSqft) params.append('minPriceSqft', filters.minPriceSqft.toString());
    if (filters.maxPriceSqft) params.append('maxPriceSqft', filters.maxPriceSqft.toString());
    if (filters.minBedrooms) params.append('minBedrooms', filters.minBedrooms.toString());
    if (filters.maxBedrooms) params.append('maxBedrooms', filters.maxBedrooms.toString());
    if (filters.minSize) params.append('minSize', filters.minSize.toString());
    if (filters.maxSize) params.append('maxSize', filters.maxSize.toString());
    if (filters.launchDateStart) params.append('launchDateStart', filters.launchDateStart);
    if (filters.launchDateEnd) params.append('launchDateEnd', filters.launchDateEnd);
    if (filters.completionDateStart) params.append('completionDateStart', filters.completionDateStart);
    if (filters.completionDateEnd) params.append('completionDateEnd', filters.completionDateEnd);
    if (filters.minCompletionPercent !== undefined) params.append('minCompletionPercent', filters.minCompletionPercent.toString());
    if (filters.maxCompletionPercent !== undefined) params.append('maxCompletionPercent', filters.maxCompletionPercent.toString());
    if (filters.status) params.append('status', filters.status);
  }

  try {
    const response = await fetch(`${API_URL}/properties/map?${params.toString()}`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch properties');
    }

    return result.data.map(convertProperty);
  } catch (error) {
    console.error('Error fetching properties for map:', error);
    return [];
  }
}

/**
 * Fetch all properties with pagination
 */
export async function fetchProperties(
  filters?: PropertyFilters
): Promise<PropertySearchResult> {
  const params = new URLSearchParams();

  if (filters) {
    if (filters.developer) params.append('developer', filters.developer);
    if (filters.project) params.append('project', filters.project);
    if (filters.area) params.append('area', filters.area);
    if (filters.minPrice) params.append('minPrice', filters.minPrice.toString());
    if (filters.maxPrice) params.append('maxPrice', filters.maxPrice.toString());
    if (filters.minPriceSqft) params.append('minPriceSqft', filters.minPriceSqft.toString());
    if (filters.maxPriceSqft) params.append('maxPriceSqft', filters.maxPriceSqft.toString());
    if (filters.minBedrooms) params.append('minBedrooms', filters.minBedrooms.toString());
    if (filters.maxBedrooms) params.append('maxBedrooms', filters.maxBedrooms.toString());
    if (filters.minSize) params.append('minSize', filters.minSize.toString());
    if (filters.maxSize) params.append('maxSize', filters.maxSize.toString());
    if (filters.launchDateStart) params.append('launchDateStart', filters.launchDateStart);
    if (filters.launchDateEnd) params.append('launchDateEnd', filters.launchDateEnd);
    if (filters.completionDateStart) params.append('completionDateStart', filters.completionDateStart);
    if (filters.completionDateEnd) params.append('completionDateEnd', filters.completionDateEnd);
    if (filters.minCompletionPercent !== undefined) params.append('minCompletionPercent', filters.minCompletionPercent.toString());
    if (filters.maxCompletionPercent !== undefined) params.append('maxCompletionPercent', filters.maxCompletionPercent.toString());
    if (filters.status) params.append('status', filters.status);
    if (filters.searchQuery) params.append('searchQuery', filters.searchQuery);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
  }

  try {
    const response = await fetch(`${API_URL}/properties?${params.toString()}`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch properties');
    }

    return {
      properties: result.data.map(convertProperty),
      total: result.total || result.data.length,
    };
  } catch (error) {
    console.error('Error fetching properties:', error);
    return {
      properties: [],
      total: 0,
    };
  }
}

/**
 * Fetch single property by ID
 */
export async function fetchPropertyById(id: string): Promise<OffPlanProperty | null> {
  try {
    const response = await fetch(`${API_URL}/properties/${id}`);
    const result: ApiResponse<any> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Property not found');
    }

    return convertProperty(result.data);
  } catch (error) {
    console.error('Error fetching property:', error);
    return null;
  }
}

/**
 * Fetch developers list
 */
export async function fetchDevelopers(): Promise<{ developer: string; developer_logo_url: string }[]> {
  try {
    const response = await fetch(`${API_URL}/properties/meta/developers`);
    const result: ApiResponse<{ developer: string; developer_logo_url: string }[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch developers');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching developers:', error);
    return [];
  }
}

/**
 * Fetch areas list with statistics
 */
export async function fetchAreas(): Promise<{
  area_name: string;
  property_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
}[]> {
  try {
    const response = await fetch(`${API_URL}/properties/meta/areas`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch areas');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching areas:', error);
    return [];
  }
}

/**
 * Fetch projects list with statistics
 */
export async function fetchProjects(): Promise<{
  project_name: string;
  developer: string;
  property_count: number;
  avg_price: number;
  min_price: number;
  max_price: number;
}[]> {
  try {
    const response = await fetch(`${API_URL}/properties/meta/projects`);
    const result: ApiResponse<any[]> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch projects');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
}

/**
 * Fetch overall statistics
 */
export async function fetchStats(): Promise<{
  total_properties: number;
  total_developers: number;
  total_areas: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  upcoming_count: number;
  under_construction_count: number;
  completed_count: number;
} | null> {
  try {
    const response = await fetch(`${API_URL}/properties/meta/stats`);
    const result: ApiResponse<any> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch statistics');
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return null;
  }
}

/**
 * Helper function to convert OffPlanProperty to legacy Project format for backward compatibility
 */
export function convertToLegacyProject(property: OffPlanProperty): any {
  return {
    id: property.id,
    name: property.buildingName,
    developer: property.developer,
    location: {
      lat: property.location.lat,
      lng: property.location.lng,
      address: property.areaName,
      district: property.areaName,
    },
    price: {
      min: property.startingPrice || 0,
      max: property.medianPricePerUnit || property.startingPrice || 0,
    },
    units: property.unitCount || 0,
    completionDate: property.completionDate || '',
    status: property.status,
    images: property.images,
    description: property.buildingDescription || `${property.buildingName} in ${property.areaName}`,
    features: [],
    floorPlans: [],
    paymentPlan: {
      downPayment: 20,
      duringConstruction: 60,
      onHandover: 20,
    },
    amenities: property.amenities,
  };
}

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