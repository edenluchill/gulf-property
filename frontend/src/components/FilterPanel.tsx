import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Slider } from './ui/slider'
import { Button } from './ui/button'
import { PropertyFilters } from '../types'
import { formatPrice } from '../lib/utils'
import { X } from 'lucide-react'
import { fetchResidentialDevelopers, fetchResidentialAreas } from '../lib/api'

interface FilterPanelProps {
  filters: PropertyFilters
  onFiltersChange: (filters: PropertyFilters) => void
  onReset: () => void
}

export default function FilterPanel({ filters, onFiltersChange, onReset }: FilterPanelProps) {
  const [priceRange, setPriceRange] = useState([0, 30000000])
  const [developers, setDevelopers] = useState<string[]>([])
  const [areas, setAreas] = useState<string[]>([])

  useEffect(() => {
    // Fetch developers and areas from residential projects API
    fetchResidentialDevelopers().then((data) => {
      setDevelopers(data.map(d => d.developer).sort())
    })
    fetchResidentialAreas().then((data) => {
      setAreas(data.map(a => a.area_name).sort())
    })
  }, [])

  const handlePriceChange = (values: number[]) => {
    setPriceRange(values)
  }

  const applyPriceFilter = () => {
    onFiltersChange({
      ...filters,
      minPrice: priceRange[0],
      maxPrice: priceRange[1],
    })
  }

  const hasActiveFilters = 
    filters.developer || 
    filters.area || 
    filters.minPrice || 
    filters.maxPrice ||
    filters.minBedrooms ||
    filters.maxBedrooms ||
    filters.status ||
    filters.completionDateStart ||
    filters.completionDateEnd

  return (
    <Card className="h-full shadow-lg border-slate-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Filters</CardTitle>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="text-slate-600 hover:text-slate-900"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Developer Filter */}
        <div className="space-y-2">
          <Label>Developer</Label>
          <Select
            value={filters.developer || 'all'}
            onValueChange={(value) =>
              onFiltersChange({
                ...filters,
                developer: value === 'all' ? undefined : value,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Developers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Developers</SelectItem>
              {developers.map((dev) => (
                <SelectItem key={dev} value={dev}>
                  {dev}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Area Filter */}
        <div className="space-y-2">
          <Label>Area</Label>
          <Select
            value={filters.area || 'all'}
            onValueChange={(value) =>
              onFiltersChange({
                ...filters,
                area: value === 'all' ? undefined : value,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Areas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Areas</SelectItem>
              {areas.map((area) => (
                <SelectItem key={area} value={area}>
                  {area}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bedrooms Filter */}
        <div className="space-y-2">
          <Label>Bedrooms</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={filters.minBedrooms?.toString() || 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  minBedrooms: value === 'all' ? undefined : parseInt(value),
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Min" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="0">Studio</SelectItem>
                <SelectItem value="1">1+</SelectItem>
                <SelectItem value="2">2+</SelectItem>
                <SelectItem value="3">3+</SelectItem>
                <SelectItem value="4">4+</SelectItem>
                <SelectItem value="5">5+</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.maxBedrooms?.toString() || 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  maxBedrooms: value === 'all' ? undefined : parseInt(value),
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Max" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="6">6+</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Price Range Filter */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Price Range</Label>
            <span className="text-sm text-slate-600">
              {formatPrice(priceRange[0])} - {formatPrice(priceRange[1])}
            </span>
          </div>
          <Slider
            min={0}
            max={30000000}
            step={100000}
            value={priceRange}
            onValueChange={handlePriceChange}
            onValueCommit={applyPriceFilter}
            className="py-4"
          />
        </div>

        {/* Status Filter */}
        <div className="space-y-2">
          <Label>Project Status</Label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) =>
              onFiltersChange({
                ...filters,
                status: value === 'all' ? undefined : value as 'upcoming' | 'under-construction' | 'completed',
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="under-construction">Under Construction</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Completion Date Filter */}
        <div className="space-y-2">
          <Label>Completion Date</Label>
          <Select
            value={filters.completionDateEnd || 'all'}
            onValueChange={(value) => {
              if (value === 'all') {
                onFiltersChange({
                  ...filters,
                  completionDateStart: undefined,
                  completionDateEnd: undefined,
                })
              } else {
                onFiltersChange({
                  ...filters,
                  completionDateStart: new Date().toISOString().split('T')[0],
                  completionDateEnd: value,
                })
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any Time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Time</SelectItem>
              <SelectItem value="2025-12-31">By 2025</SelectItem>
              <SelectItem value="2026-12-31">By 2026</SelectItem>
              <SelectItem value="2027-12-31">By 2027</SelectItem>
              <SelectItem value="2028-12-31">By 2028</SelectItem>
              <SelectItem value="2029-12-31">By 2029</SelectItem>
              <SelectItem value="2030-12-31">By 2030</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Status Badge */}
        <div className="pt-4 border-t">
          <div className="text-sm text-slate-600">
            {hasActiveFilters ? (
              <span className="text-primary font-medium">
                Filters applied
              </span>
            ) : (
              <span>No filters applied</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
