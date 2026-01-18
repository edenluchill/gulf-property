import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Save, Trash2, RotateCcw, Edit, X } from 'lucide-react'
import { DubaiArea } from '../types'
import { fetchDubaiAreas, createDubaiArea, updateDubaiArea, deleteDubaiArea } from '../lib/api'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

// Geoman Controls Component
function GeomanControls({ onShapeCreate }: any) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    // Enable Geoman toolbar
    map.pm.addControls({
      position: 'topleft',
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawMarker: false,
      drawText: false,
      cutPolygon: false,
    })

    // Listen for shape creation
    map.on('pm:create', (e: any) => {
      const layer = e.layer
      const geoJSON = layer.toGeoJSON()
      onShapeCreate(geoJSON)
      map.removeLayer(layer) // Remove the drawing layer, we'll add our own
    })

    // Set drawing options
    map.pm.setGlobalOptions({
      snapDistance: 20,
      allowSelfIntersection: false,
    })

    return () => {
      map.pm.removeControls()
      map.off('pm:create')
    }
  }, [map, onShapeCreate])

  return null
}

// Editable Polygon Component
function EditablePolygon({ area, isSelected, onClick, onUpdate, isEditMode }: any) {
  const map = useMap()
  const layerRef = useRef<L.Polygon | null>(null)

  useEffect(() => {
    if (!area.boundary || area.boundary.type !== 'Polygon') return

    const coords = (area.boundary as any).coordinates[0].map(
      ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
    )

    // Create polygon
    const polygon = L.polygon(coords, {
      color: isSelected ? '#000000' : area.color,
      fillColor: area.color,
      fillOpacity: area.opacity,
      weight: isSelected ? 3 : 2,
    })

    polygon.on('click', onClick)
    polygon.addTo(map)
    layerRef.current = polygon

    // Bind popup
    const popupContent = `
      <div style="padding: 8px;">
        <h3 style="font-weight: bold; margin-bottom: 4px;">${area.name}</h3>
        <p style="font-size: 12px; color: #666;">${area.description || ''}</p>
      </div>
    `
    polygon.bindPopup(popupContent)

    // Enable editing if selected and in edit mode
    if (isSelected && isEditMode) {
      polygon.pm.enable({
        allowSelfIntersection: false,
        snapDistance: 20,
      })

      // Listen for edits
      polygon.on('pm:edit', () => {
        const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
        const geoJsonCoords = latlngs.map((ll: L.LatLng) => [ll.lng, ll.lat])
        // Close the polygon
        geoJsonCoords.push(geoJsonCoords[0])
        
        onUpdate({
          type: 'Polygon',
          coordinates: [geoJsonCoords],
        })
      })
    } else {
      polygon.pm.disable()
    }

    return () => {
      polygon.off('click')
      polygon.off('pm:edit')
      if (polygon.pm) {
        polygon.pm.disable()
      }
      map.removeLayer(polygon)
    }
  }, [map, area, isSelected, isEditMode, onClick, onUpdate])

  return null
}

export default function AreasEditorEnhanced() {
  const [areas, setAreas] = useState<DubaiArea[]>([])
  const [selectedArea, setSelectedArea] = useState<DubaiArea | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [originalAreas, setOriginalAreas] = useState<DubaiArea[]>([])

  // Form state
  const [formData, setFormData] = useState<Partial<DubaiArea>>({})

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
    setOriginalAreas(JSON.parse(JSON.stringify(data)))
  }

  const handleShapeCreate = (geoJSON: any) => {
    const newArea: any = {
      id: `temp-${Date.now()}`,
      name: 'New District',
      nameAr: '',
      boundary: geoJSON.geometry,
      areaType: 'residential',
      wealthLevel: 'mid-range',
      culturalAttribute: 'family-oriented',
      description: '',
      color: '#3B82F6',
      opacity: 0.3,
      displayOrder: 0,
    }
    setAreas([...areas, newArea])
    setSelectedArea(newArea)
    setIsEditMode(true)
  }

  const handleSave = async () => {
    if (!selectedArea || !formData) return
    
    setIsSaving(true)
    try {
      if (selectedArea.id.startsWith('temp-')) {
        const created = await createDubaiArea(formData)
        if (created) {
          setAreas(areas.map(a => a.id === selectedArea.id ? created : a))
          setSelectedArea(created)
          localStorage.removeItem('gulf_dubai_areas')
        }
      } else {
        const updated = await updateDubaiArea(selectedArea.id, formData)
        if (updated) {
          setAreas(areas.map(a => a.id === selectedArea.id ? updated : a))
          setSelectedArea(updated)
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
      setAreas(areas.filter(a => a.id !== selectedArea.id))
      setSelectedArea(null)
    } else {
      const success = await deleteDubaiArea(selectedArea.id)
      if (success) {
        setAreas(areas.filter(a => a.id !== selectedArea.id))
        setSelectedArea(null)
        localStorage.removeItem('gulf_dubai_areas')
      }
    }
  }

  const handleReset = () => {
    if (!confirm('Reset all changes?')) return
    setAreas(JSON.parse(JSON.stringify(originalAreas)))
    setSelectedArea(null)
    setIsEditMode(false)
    loadAreas()
  }

  const handleBoundaryUpdate = (boundary: any) => {
    const updatedFormData = { ...formData, boundary }
    setFormData(updatedFormData)
    if (selectedArea) {
      const updated = { ...selectedArea, ...updatedFormData }
      setAreas(areas.map(a => a.id === selectedArea.id ? updated : a))
      setSelectedArea(updated)
    }
  }

  const handleFormChange = (field: string, value: any) => {
    const updatedFormData = { ...formData, [field]: value }
    setFormData(updatedFormData)
    if (selectedArea) {
      const updated = { ...selectedArea, ...updatedFormData }
      setAreas(areas.map(a => a.id === selectedArea.id ? updated : a))
      setSelectedArea(updated)
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-96 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b bg-slate-50">
          <div className="flex gap-2 mb-3">
            <Button onClick={handleReset} variant="outline" className="flex-1">
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset All
            </Button>
          </div>
          <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-lg">
            <p className="font-medium mb-1">🎨 Drawing Tools</p>
            <p className="text-xs">• Click the polygon tool in map</p>
            <p className="text-xs">• Click to add points</p>
            <p className="text-xs">• Double-click to finish</p>
            <p className="text-xs mt-2 font-medium">✏️ Editing</p>
            <p className="text-xs">• Select area and enable Edit</p>
            <p className="text-xs">• Drag vertices to adjust</p>
            <p className="text-xs">• Click midpoints to add</p>
            <p className="text-xs">• Click vertices to delete</p>
          </div>
        </div>

        {/* Areas List */}
        <div className="p-4">
          <h3 className="font-semibold mb-2">Areas ({areas.length})</h3>
          <div className="space-y-2">
            {areas.map((area) => (
              <div
                key={area.id}
                onClick={() => {
                  setSelectedArea(area)
                  setIsEditMode(false)
                }}
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
                  {isEditMode ? 'Editing' : 'Edit Shape'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedArea(null)
                    setIsEditMode(false)
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name || ''}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                />
              </div>

              <div>
                <Label>Description</Label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm"
                  rows={4}
                  value={formData.description || ''}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  placeholder="Describe this area..."
                />
              </div>

              <div>
                <Label>Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color || '#3B82F6'}
                    onChange={(e) => handleFormChange('color', e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer border"
                  />
                  <Input
                    value={formData.color || ''}
                    onChange={(e) => handleFormChange('color', e.target.value)}
                    placeholder="#3B82F6"
                  />
                </div>
              </div>

              <div>
                <Label>Opacity: {(formData.opacity || 0.3).toFixed(2)}</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={formData.opacity || 0.3}
                  onChange={(e) => handleFormChange('opacity', parseFloat(e.target.value))}
                  className="w-full accent-primary"
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
          style={{ background: '#f8f9fa' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <GeomanControls 
            onShapeCreate={handleShapeCreate}
            onShapeEdit={() => {}}
            onShapeDelete={() => {}}
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
