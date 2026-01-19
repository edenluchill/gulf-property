import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Save, Trash2, MapPin, Layers, Upload, X } from 'lucide-react'
import { DubaiArea, DubaiLandmark } from '../types'
import {
  fetchDubaiAreas,
  fetchDubaiLandmarks,
  createDubaiArea,
  updateDubaiArea,
  deleteDubaiArea,
  createDubaiLandmark,
  updateDubaiLandmark,
  deleteDubaiLandmark,
} from '../lib/api'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

type EditMode = 'idle' | 'placing-landmark' | 'drawing-area'
type SelectedItem = { type: 'area'; item: DubaiArea } | { type: 'landmark'; item: DubaiLandmark } | null

// Geoman + Map Click Handler
function MapController({
  editMode,
  onShapeCreate,
  onMapClick,
  areas,
  landmarks,
  selectedItem,
  onItemSelect,
  onAreaUpdate,
  onLandmarkDrag,
}: any) {
  const map = useMap()
  const polygonLayersRef = useRef<Map<string, L.Polygon>>(new Map())
  const markerLayersRef = useRef<Map<string, L.Marker>>(new Map())

  // Initialize Geoman
  useEffect(() => {
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

    map.on('pm:create', (e: any) => {
      const layer = e.layer
      const geoJSON = layer.toGeoJSON()
      onShapeCreate(geoJSON)
      map.removeLayer(layer)
    })

    map.on('click', (e: any) => {
      if (editMode === 'placing-landmark') {
        onMapClick(e.latlng.lat, e.latlng.lng)
      }
    })

    return () => {
      map.pm.removeControls()
      map.off('pm:create')
      map.off('click')
    }
  }, [map, editMode, onShapeCreate, onMapClick])

  // Render areas as polygons (always editable)
  useEffect(() => {
    // Clear old layers
    polygonLayersRef.current.forEach((layer) => map.removeLayer(layer))
    polygonLayersRef.current.clear()

    areas.forEach((area: DubaiArea) => {
      if (!area.boundary || area.boundary.type !== 'Polygon') return

      const coords = (area.boundary as any).coordinates[0].map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      )

      const isSelected = selectedItem?.type === 'area' && selectedItem.item.id === area.id

      const polygon = L.polygon(coords, {
        color: isSelected ? '#000' : area.color,
        fillColor: area.color,
        fillOpacity: area.opacity * 0.6,
        weight: isSelected ? 4 : 3,
        dashArray: '5, 10',
      })

      polygon.on('click', () => {
        onItemSelect({ type: 'area', item: area })
      })

      // Enable editing for selected area
      if (isSelected) {
        polygon.pm.enable({
          allowSelfIntersection: false,
          snapDistance: 20,
        })

        polygon.on('pm:edit', () => {
          const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
          const geoJsonCoords = latlngs.map((ll: L.LatLng) => [ll.lng, ll.lat])
          geoJsonCoords.push(geoJsonCoords[0])

          onAreaUpdate(area.id, {
            type: 'Polygon',
            coordinates: [geoJsonCoords],
          })
        })
      } else {
        polygon.pm.disable()
      }

      polygon.addTo(map)
      polygonLayersRef.current.set(area.id, polygon)
    })

    return () => {
      polygonLayersRef.current.forEach((layer) => {
        layer.off('click')
        layer.off('pm:edit')
        layer.pm.disable()
      })
    }
  }, [map, areas, selectedItem, onItemSelect, onAreaUpdate])

  // Render landmarks as markers (always draggable)
  useEffect(() => {
    // Clear old markers
    markerLayersRef.current.forEach((marker) => map.removeLayer(marker))
    markerLayersRef.current.clear()

    landmarks.forEach((landmark: DubaiLandmark) => {
      const isSelected = selectedItem?.type === 'landmark' && selectedItem.item.id === landmark.id

      const icon = L.divIcon({
        html: `
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: ${landmark.color};
            border: ${isSelected ? '4px solid #000' : '3px solid #fff'};
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: move;
          ">
            <svg style="width: 20px; height: 20px; color: white;" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
            </svg>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      })

      const marker = L.marker([landmark.location.lat, landmark.location.lng], {
        icon,
        draggable: true,
      })

      marker.on('click', () => {
        onItemSelect({ type: 'landmark', item: landmark })
      })

      marker.on('dragend', (e: any) => {
        const { lat, lng } = e.target.getLatLng()
        onLandmarkDrag(landmark.id, lat, lng)
      })

      marker.addTo(map)
      markerLayersRef.current.set(landmark.id, marker)
    })

    return () => {
      markerLayersRef.current.forEach((marker) => {
        marker.off('click')
        marker.off('dragend')
      })
    }
  }, [map, landmarks, selectedItem, onItemSelect, onLandmarkDrag])

  return null
}

export default function UnifiedDubaiEditor() {
  const [areas, setAreas] = useState<DubaiArea[]>([])
  const [landmarks, setLandmarks] = useState<DubaiLandmark[]>([])
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [editMode, setEditMode] = useState<EditMode>('idle')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form data
  const [formData, setFormData] = useState<any>({})

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedItem) {
      setFormData(selectedItem.item)
    } else {
      setFormData({})
    }
  }, [selectedItem])

  const loadData = async () => {
    const [areasData, landmarksData] = await Promise.all([
      fetchDubaiAreas(),
      fetchDubaiLandmarks(),
    ])
    setAreas(areasData)
    setLandmarks(landmarksData)
  }

  const handleAddArea = () => {
    setEditMode('drawing-area')
    setSelectedItem(null)
  }

  const handleAddLandmark = () => {
    setEditMode('placing-landmark')
    setSelectedItem(null)
  }

  const handleShapeCreate = (geoJSON: any) => {
    const newArea: any = {
      id: `temp-area-${Date.now()}`,
      name: 'New Area',
      boundary: geoJSON.geometry,
      areaType: 'residential',
      color: '#3B82F6',
      opacity: 0.3,
    }
    setAreas([...areas, newArea])
    setSelectedItem({ type: 'area', item: newArea })
    setEditMode('idle')
  }

  const handleMapClick = (lat: number, lng: number) => {
    if (editMode !== 'placing-landmark') return

    const newLandmark: any = {
      id: `temp-landmark-${Date.now()}`,
      name: 'New Landmark',
      location: { lat, lng },
      landmarkType: 'attraction',
      color: '#EF4444',
      size: 'medium',
    }
    setLandmarks([...landmarks, newLandmark])
    setSelectedItem({ type: 'landmark', item: newLandmark })
    setEditMode('idle')
  }

  const handleAreaUpdate = (id: string, boundary: any) => {
    const updated = areas.map((a) => (a.id === id ? { ...a, boundary } : a))
    setAreas(updated)
    if (selectedItem?.type === 'area' && selectedItem.item.id === id) {
      setSelectedItem({ type: 'area', item: { ...selectedItem.item, boundary } })
    }
  }

  const handleLandmarkDrag = (id: string, lat: number, lng: number) => {
    const updated = landmarks.map((l) => (l.id === id ? { ...l, location: { lat, lng } } : l))
    setLandmarks(updated)
    if (selectedItem?.type === 'landmark' && selectedItem.item.id === id) {
      setSelectedItem({ type: 'landmark', item: { ...selectedItem.item, location: { lat, lng } } })
      setFormData({ ...formData, location: { lat, lng } })
    }
  }

  const handleSave = async () => {
    if (!selectedItem) return

    setIsSaving(true)
    try {
      if (selectedItem.type === 'area') {
        const area = selectedItem.item
        if (area.id.startsWith('temp-')) {
          const created = await createDubaiArea(formData)
          if (created) {
            setAreas(areas.map((a) => (a.id === area.id ? created : a)))
            setSelectedItem({ type: 'area', item: created })
          }
        } else {
          const updated = await updateDubaiArea(area.id, formData)
          if (updated) {
            setAreas(areas.map((a) => (a.id === area.id ? updated : a)))
            setSelectedItem({ type: 'area', item: updated })
          }
        }
        localStorage.removeItem('gulf_dubai_areas')
      } else {
        const landmark = selectedItem.item
        if (landmark.id.startsWith('temp-')) {
          const created = await createDubaiLandmark(formData)
          if (created) {
            setLandmarks(landmarks.map((l) => (l.id === landmark.id ? created : l)))
            setSelectedItem({ type: 'landmark', item: created })
          }
        } else {
          const updated = await updateDubaiLandmark(landmark.id, formData)
          if (updated) {
            setLandmarks(landmarks.map((l) => (l.id === landmark.id ? updated : l)))
            setSelectedItem({ type: 'landmark', item: updated })
          }
        }
        localStorage.removeItem('gulf_dubai_landmarks')
      }
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return

    if (!confirm(`Delete "${selectedItem.item.name}"?`)) return

    try {
      if (selectedItem.type === 'area') {
        const area = selectedItem.item
        if (area.id.startsWith('temp-')) {
          setAreas(areas.filter((a) => a.id !== area.id))
        } else {
          await deleteDubaiArea(area.id)
          setAreas(areas.filter((a) => a.id !== area.id))
          localStorage.removeItem('gulf_dubai_areas')
        }
      } else {
        const landmark = selectedItem.item
        if (landmark.id.startsWith('temp-')) {
          setLandmarks(landmarks.filter((l) => l.id !== landmark.id))
        } else {
          await deleteDubaiLandmark(landmark.id)
          setLandmarks(landmarks.filter((l) => l.id !== landmark.id))
          localStorage.removeItem('gulf_dubai_landmarks')
        }
      }
      setSelectedItem(null)
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete')
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    setIsUploading(true)
    try {
      const formDataUpload = new FormData()
      formDataUpload.append('image', file)

      const response = await fetch('/api/upload/landmark-image', {
        method: 'POST',
        body: formDataUpload,
      })

      if (!response.ok) throw new Error('Upload failed')

      const { url } = await response.json()
      setFormData({ ...formData, imageUrl: url })
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)]">
      {/* Left Toolbar */}
      <div className="w-80 bg-white border-r flex flex-col overflow-hidden">
        {/* Tools Header */}
        <div className="p-4 border-b bg-slate-50">
          <h2 className="font-bold text-lg mb-3">Dubai Map Editor</h2>
          <div className="flex gap-2">
            <Button
              onClick={handleAddArea}
              variant={editMode === 'drawing-area' ? 'default' : 'outline'}
              className="flex-1"
              size="sm"
            >
              <Layers className="w-4 h-4 mr-2" />
              {editMode === 'drawing-area' ? 'Drawing...' : 'Add Area'}
            </Button>
            <Button
              onClick={handleAddLandmark}
              variant={editMode === 'placing-landmark' ? 'default' : 'outline'}
              className="flex-1"
              size="sm"
            >
              <MapPin className="w-4 h-4 mr-2" />
              {editMode === 'placing-landmark' ? 'Click Map' : 'Add Pin'}
            </Button>
          </div>
          {editMode !== 'idle' && (
            <p className="text-xs text-blue-600 mt-2">
              {editMode === 'drawing-area' && '🎨 Use tools on map to draw area'}
              {editMode === 'placing-landmark' && '📍 Click map to place landmark'}
            </p>
          )}
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* Areas */}
            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Areas ({areas.length})</h3>
              <div className="space-y-1">
                {areas.map((area) => (
                  <div
                    key={area.id}
                    onClick={() => setSelectedItem({ type: 'area', item: area })}
                    className={`p-2 rounded cursor-pointer transition-all flex items-center gap-2 ${
                      selectedItem?.type === 'area' && selectedItem.item.id === area.id
                        ? 'bg-blue-50 border-blue-200 border'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="w-3 h-3 rounded" style={{ background: area.color }} />
                    <span className="text-sm flex-1">{area.name}</span>
                    {area.id.startsWith('temp-') && (
                      <span className="text-xs text-orange-600">New</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Landmarks */}
            <div>
              <h3 className="text-sm font-semibold text-slate-600 mb-2">Landmarks ({landmarks.length})</h3>
              <div className="space-y-1">
                {landmarks.map((landmark) => (
                  <div
                    key={landmark.id}
                    onClick={() => setSelectedItem({ type: 'landmark', item: landmark })}
                    className={`p-2 rounded cursor-pointer transition-all flex items-center gap-2 ${
                      selectedItem?.type === 'landmark' && selectedItem.item.id === landmark.id
                        ? 'bg-blue-50 border-blue-200 border'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="w-3 h-3 rounded-full" style={{ background: landmark.color }} />
                    <span className="text-sm flex-1">{landmark.name}</span>
                    {landmark.id.startsWith('temp-') && (
                      <span className="text-xs text-orange-600">New</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[25.0961, 55.1561]}
          zoom={11}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />

          <MapController
            editMode={editMode}
            onShapeCreate={handleShapeCreate}
            onMapClick={handleMapClick}
            areas={areas}
            landmarks={landmarks}
            selectedItem={selectedItem}
            onItemSelect={setSelectedItem}
            onAreaUpdate={handleAreaUpdate}
            onLandmarkDrag={handleLandmarkDrag}
          />
        </MapContainer>
      </div>

      {/* Right Edit Panel */}
      {selectedItem && (
        <div className="w-96 bg-white border-l flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
            <h3 className="font-semibold">
              {selectedItem.type === 'area' ? 'Edit Area' : 'Edit Landmark'}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Common Fields */}
            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {selectedItem.type === 'landmark' && (
              <>
                {/* Image Upload/URL */}
                <div>
                  <Label>Photo</Label>
                  <div className="space-y-2">
                    {formData.imageUrl && (
                      <div className="relative">
                        <img
                          src={formData.imageUrl}
                          alt="Preview"
                          className="w-full h-40 object-cover rounded border"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => setFormData({ ...formData, imageUrl: '' })}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {isUploading ? 'Uploading...' : 'Upload'}
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageUpload}
                      />
                    </div>

                    <Input
                      type="url"
                      placeholder="Or paste image URL"
                      value={formData.imageUrl || ''}
                      onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Type</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.landmarkType || ''}
                    onChange={(e) => setFormData({ ...formData, landmarkType: e.target.value })}
                  >
                    <option value="tower">Tower</option>
                    <option value="mall">Mall</option>
                    <option value="hotel">Hotel</option>
                    <option value="attraction">Attraction</option>
                    <option value="beach">Beach</option>
                    <option value="park">Park</option>
                    <option value="airport">Airport</option>
                    <option value="museum">Museum</option>
                  </select>
                </div>

                <div>
                  <Label>Size</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.size || 'medium'}
                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              </>
            )}

            {selectedItem.type === 'area' && (
              <>
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
                  </select>
                </div>
              </>
            )}

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
          </div>

          <div className="p-4 border-t bg-slate-50 flex gap-2">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
