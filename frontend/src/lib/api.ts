import { OffPlanProperty, PropertyFilters, PropertySearchResult, MapBounds } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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
    const response = await fetch(`${API_BASE_URL}/properties/clusters?${params.toString()}`)
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
    const response = await fetch(`${API_BASE_URL}/properties/batch`, {
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
    const response = await fetch(`${API_BASE_URL}/properties/map?${params.toString()}`);
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
    const response = await fetch(`${API_BASE_URL}/properties?${params.toString()}`);
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
    const response = await fetch(`${API_BASE_URL}/properties/${id}`);
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
    const response = await fetch(`${API_BASE_URL}/properties/meta/developers`);
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
    const response = await fetch(`${API_BASE_URL}/properties/meta/areas`);
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
    const response = await fetch(`${API_BASE_URL}/properties/meta/projects`);
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
    const response = await fetch(`${API_BASE_URL}/properties/meta/stats`);
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
