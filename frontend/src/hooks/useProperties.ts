import { useState, useEffect, useCallback } from 'react';
import { OffPlanProperty } from '../types';
import { fetchResidentialProjectById } from '../lib/api';

// Convert residential project to OffPlanProperty format
function convertResidentialProjectToProperty(result: any): OffPlanProperty | null {
  if (!result || !result.project) return null
  
  const project = result.project
  
  // construction_progress is now a direct number (0-100)
  const completionPercent = project.construction_progress || 0
  
  // Normalize status to match old schema
  let normalizedStatus: 'upcoming' | 'under-construction' | 'completed' = 'upcoming'
  if (project.status === 'under-construction') {
    normalizedStatus = 'under-construction'
  } else if (project.status === 'completed' || project.status === 'handed-over') {
    normalizedStatus = 'completed'
  }
  
  return {
    id: project.id,
    buildingId: undefined,
    buildingName: project.project_name,
    projectName: project.project_name,
    buildingDescription: project.description,
    developer: project.developer,
    developerId: undefined,
    developerLogoUrl: undefined,
    location: {
      lat: project.latitude || 0,
      lng: project.longitude || 0,
    },
    areaName: project.area,
    areaId: undefined,
    dldLocationId: undefined,
    minBedrooms: project.min_bedrooms || 0,
    maxBedrooms: project.max_bedrooms || 0,
    bedsDescription: project.min_bedrooms && project.max_bedrooms 
      ? `${project.min_bedrooms}-${project.max_bedrooms} BR`
      : undefined,
    minSize: undefined,
    maxSize: undefined,
    startingPrice: project.starting_price,
    medianPriceSqft: undefined,
    medianPricePerUnit: project.starting_price,
    medianRentPerUnit: undefined,
    launchDate: project.launch_date,
    completionDate: project.completion_date,
    completionPercent: completionPercent,
    status: normalizedStatus,
    unitCount: project.total_units,
    buildingUnitCount: project.total_units,
    salesVolume: undefined,
    propSalesVolume: undefined,
    images: project.project_images || [],
    logoUrl: undefined,
    brochureUrl: project.brochure_url,
    amenities: project.amenities || [],
    displayAs: 'project',
    verified: project.verified,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  }
}

/**
 * Hook for fetching a single property (using residential projects API)
 */
export function useProperty(id?: string) {
  const [property, setProperty] = useState<OffPlanProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProperty = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await fetchResidentialProjectById(id);
      const convertedProperty = convertResidentialProjectToProperty(result);
      setProperty(convertedProperty);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load property');
      setProperty(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  return { property, loading, error, refetch: loadProperty };
}
