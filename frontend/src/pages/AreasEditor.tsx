import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMapEvents } from 'react-leaflet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Save, Trash2, Plus, RotateCcw, Edit, X } from 'lucide-react'
import { DubaiArea } from '../types'
import { fetchDubaiAreas, createDubaiArea, updateDubaiArea, deleteDubaiArea } from '../lib/api'
import L from 'leaflet'

// Default template for new areas
const DEFAULT_AREA: Partial<DubaiArea> = {
  name: 'New District',
  nameAr: '',
  boundary: {
    type: 'Polygon',
    coordinates: [[
      [55.20, 25.10],
      [55.21, 25.10],
      [55.21, 25.11],
      [55.20, 25.11],
      [55.20, 25.10],
    ]],
  },
  areaType: 'residential',
  wealthLevel: 'mid-range',
  culturalAttribute: 'family-oriented',
  description: '',
  descriptionAr: '',
  color: '#3B82F6',
  opacity: 0.3,
  displayOrder: 0,
}

interface EditablePolygonProps {
  area: DubaiArea
  isSelected: boolean
  onClick: () => void
  onUpdate: (boundary: any) => void
  isEditMode: boolean
}

function EditablePolygon({ area, isSelected, onClick, onUpdate, isEditMode }: EditablePolygonProps) {
  const [vertices, setVertices] = useState<[number, number][]>([])
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (area.boundary.type === 'Polygon') {
      const coords = (area.boundary as any).coordinates[0].map(([lng, lat]: [number, number]) => [lat, lng] as [number, number])
      setVertices(coords)
    }
  }, [area.boundary])

  const handleVertexDrag = (index: number, newLat: number, newLng: number) => {
    if (!isEditMode || !isSelected) return
    
    const newVertices = [...vertices]
    newVertices[index] = [newLat, newLng]
    
    // Close the polygon if it's the last vertex
    if (index === 0) {
      newVertices[newVertices.length - 1] = [newLat, newLng]
    } else if (index === newVertices.length - 1) {
      newVertices[0] = [newLat, newLng]
    }
    
    setVertices(newVertices)
    
    // Convert back to GeoJSON format
    const geoJsonCoords = newVertices.map(([lat, lng]) => [lng, lat])
    onUpdate({
      type: 'Polygon',
      coordinates: [geoJsonCoords],
    })
  }

  const DraggableMarker = ({ position, index }: { position: [number, number], index: number }) => {
    useMapEvents({
      drag: (e: any) => {
        if (isDragging) {
          const { lat, lng } = e.latlng
          handleVertexDrag(index, lat, lng)
        }
      },
    })

    return (
      <Marker
        position={position}
        draggable={isEditMode && isSelected}
        eventHandlers={{
          dragstart: () => setIsDragging(true),
          dragend: (e) => {
            setIsDragging(false)
            const { lat, lng } = e.target.getLatLng()
            handleVertexDrag(index, lat, lng)
          },
        }}
        icon={L.divIcon({
          html: `<div style="width: 12px; height: 12px; background: white; border: 2px solid ${area.color}; border-radius: 50%; cursor: move;"></div>`,
          className: 'vertex-marker',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        })}
      />
    )
  }

  return (
    <>
      <Polygon
        positions={vertices}
        pathOptions={{
          color: isSelected ? '#000000' : area.color,
          fillColor: area.color,
          fillOpacity: area.opacity,
          weight: isSelected ? 3 : 2,
        }}
        eventHandlers={{
          click: onClick,
        }}
      >
        <Popup>
          <div className="p-2">
            <h3 className="font-bold">{area.name}</h3>
            <p className="text-sm text-gray-600">{area.description}</p>
          </div>
        </Popup>
      </Polygon>
      
      {/* Show draggable vertices when selected and in edit mode */}
      {isSelected && isEditMode && vertices.slice(0, -1).map((vertex, index) => (
        <DraggableMarker key={index} position={vertex} index={index} />
      ))}
    </>
  )
}

export default function AreasEditor() {
  const [areas, setAreas] = useState<DubaiArea[]>([])
  const [selectedArea, setSelectedArea] = useState<DubaiArea | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [originalAreas, setOriginalAreas] = useState<DubaiArea[]>([])

  // Form state
  const [formData, setFormData] = useState<Partial<DubaiArea>>(DEFAULT_AREA)

  useEffect(() => {
    loadAreas()
  }, [])

  useEffect(() => {
    if (selectedArea) {
      setFormData(selectedArea)
    }
  }, [selectedArea])

  const loadAreas = async () => {
    const data = await fetchDubaiAreas()
    setAreas(data)
    setOriginalAreas(JSON.parse(JSON.stringify(data))) // Deep clone for reset
  }

  const handleAddNew = () => {
    const newArea: any = { ...DEFAULT_AREA, id: `temp-${Date.now()}` }
    setAreas([...areas, newArea])
    setSelectedArea(newArea)
    setIsEditMode(true)
  }

  const handleSave = async () => {
    if (!selectedArea || !formData) return
    
    setIsSaving(true)
    try {
      if (selectedArea.id.startsWith('temp-')) {
        // Create new area
        const created = await createDubaiArea(formData)
        if (created) {
          setAreas(areas.map(a => a.id === selectedArea.id ? created : a))
          setSelectedArea(created)
          // Clear cache
          localStorage.removeItem('gulf_dubai_areas')
        }
      } else {
        // Update existing area
        const updated = await updateDubaiArea(selectedArea.id, formData)
        if (updated) {
          setAreas(areas.map(a => a.id === selectedArea.id ? updated : a))
          setSelectedArea(updated)
          // Clear cache
          localStorage.removeItem('gulf_dubai_areas')
        }
      }
    } catch (error) {
      console.error('Error saving area:', error)
      alert('Failed to save area')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedArea) return
    
    if (!confirm(`Delete "${selectedArea.name}"?`)) return
    
    if (selectedArea.id.startsWith('temp-')) {
      // Just remove from local state
      setAreas(areas.filter(a => a.id !== selectedArea.id))
      setSelectedArea(null)
    } else {
      const success = await deleteDubaiArea(selectedArea.id)
      if (success) {
        setAreas(areas.filter(a => a.id !== selectedArea.id))
        setSelectedArea(null)
        // Clear cache
        localStorage.removeItem('gulf_dubai_areas')
      }
    }
  }

  const handleReset = () => {
    if (!confirm('Reset all changes? This will reload from the database.')) return
    setAreas(JSON.parse(JSON.stringify(originalAreas)))
    setSelectedArea(null)
    setIsEditMode(false)
    loadAreas()
  }

  const handleBoundaryUpdate = (boundary: any) => {
    setFormData({ ...formData, boundary })
    if (selectedArea) {
      const updated = { ...selectedArea, boundary }
      setAreas(areas.map(a => a.id === selectedArea.id ? updated : a))
      setSelectedArea(updated)
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-96 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b bg-slate-50">
          <div className="flex gap-2">
            <Button onClick={handleAddNew} className="flex-1">
              <Plus className="w-4 h-4 mr-2" />
              Add Area
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>
        </div>

        {/* Areas List */}
        <div className="p-4">
          <h3 className="font-semibold mb-2">Areas ({areas.length})</h3>
          <div className="space-y-2">
            {areas.map((area) => (
              <div
                key={area.id}
                onClick={() => setSelectedArea(area)}
                className={`p-3 border rounded cursor-pointer transition-all ${
                  selectedArea?.id === area.id ? 'border-primary bg-primary/5' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: area.color }}
                  />
                  <span className="font-medium">{area.name}</span>
                </div>
                {area.id.startsWith('temp-') && (
                  <span className="text-xs text-orange-600">Unsaved</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Edit Form */}
        {selectedArea && (
          <div className="p-4 border-t bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Edit Area</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={isEditMode ? "default" : "outline"}
                  onClick={() => setIsEditMode(!isEditMode)}
                >
                  <Edit className="w-3 h-3 mr-1" />
                  {isEditMode ? 'View' : 'Edit'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedArea(null)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <Label>Area Type</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={formData.areaType || ''}
                  onChange={(e) => setFormData({ ...formData, areaType: e.target.value })}
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="mixed">Mixed</option>
                  <option value="freehold">Freehold</option>
                </select>
              </div>

              <div>
                <Label>Wealth Level</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={formData.wealthLevel || ''}
                  onChange={(e) => setFormData({ ...formData, wealthLevel: e.target.value })}
                >
                  <option value="luxury">Luxury</option>
                  <option value="premium">Premium</option>
                  <option value="mid-range">Mid-Range</option>
                  <option value="affordable">Affordable</option>
                </select>
              </div>

              <div>
                <Label>Cultural Attribute</Label>
                <Input
                  value={formData.culturalAttribute || ''}
                  onChange={(e) => setFormData({ ...formData, culturalAttribute: e.target.value })}
                  placeholder="e.g., family-oriented, business-hub"
                />
              </div>

              <div>
                <Label>Description</Label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div>
                <Label>Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color || '#3B82F6'}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <Input
                    value={formData.color || ''}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Opacity: {formData.opacity || 0.3}</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={formData.opacity || 0.3}
                  onChange={(e) => setFormData({ ...formData, opacity: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="destructive" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {isEditMode && (
                <p className="text-xs text-blue-600 mt-2">
                  💡 Drag the white circles to adjust polygon vertices
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={[25.0961, 55.1561]}
          zoom={11}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {areas.map((area) => (
            <EditablePolygon
              key={area.id}
              area={area}
              isSelected={selectedArea?.id === area.id}
              onClick={() => setSelectedArea(area)}
              onUpdate={handleBoundaryUpdate}
              isEditMode={isEditMode}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
