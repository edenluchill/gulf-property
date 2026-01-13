import { useState, useEffect, useCallback } from 'react';
import { OffPlanProperty, PropertyFilters, MapBounds } from '../types';
import { fetchPropertiesForMap, fetchProperties, fetchPropertyById } from '../lib/api';

/**
 * Hook for fetching properties for map view
 */
export function useMapProperties(bounds?: MapBounds, filters?: Omit<PropertyFilters, 'bounds' | 'limit' | 'offset'>) {
  const [properties, setProperties] = useState<OffPlanProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProperties = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPropertiesForMap(bounds, filters);
      setProperties(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load properties');
      setProperties([]);
    } finally {
      setLoading(false);
    }
  }, [bounds, filters]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  return { properties, loading, error, refetch: loadProperties };
}

/**
 * Hook for fetching properties with pagination
 */
export function useProperties(filters?: PropertyFilters) {
  const [properties, setProperties] = useState<OffPlanProperty[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProperties = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchProperties(filters);
      setProperties(result.properties);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load properties');
      setProperties([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  return { properties, total, loading, error, refetch: loadProperties };
}

/**
 * Hook for fetching a single property
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
      const data = await fetchPropertyById(id);
      setProperty(data);
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
