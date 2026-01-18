import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Save, Trash2, RotateCcw, MapPin, X } from 'lucide-react'
import { DubaiLandmark } from '../types'
import { fetchDubaiLandmarks, createDubaiLandmark, updateDubaiLandmark, deleteDubaiLandmark } from '../lib/api'
import L from 'leaflet'

// Default template for new landmarks
const DEFAULT_LANDMARK: Partial<DubaiLandmark> = {
  name: 'New Landmark',
  nameAr: '',
  location: { lat: 25.1972, lng: 55.2744 },
  landmarkType: 'attraction',
  iconName: 'landmark',
  description: '',
  descriptionAr: '',
  color: '#EF4444',
  size: 'medium',
  displayOrder: 0,
}

interface DraggableMarkerProps {
  landmark: DubaiLandmark
  isSelected: boolean
  onClick: () => void
  onDrag: (lat: number, lng: number) => void
  isDraggable: boolean
}

function DraggableLandmarkMarker({ landmark, isSelected, onClick, onDrag, isDraggable }: DraggableMarkerProps) {
  const sizeMap = { small: [24, 24], medium: [32, 32], large: [40, 40] }
  const size = sizeMap[landmark.size] || [32, 32]
  
  const icon = L.divIcon({
    html: `
      <div style="width: ${size[0]}px; height: ${size[1]}px;">
        <div style="
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: ${landmark.color};
          border: ${isSelected ? '3px solid #000' : '2px solid #fff'};
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          cursor: ${isDraggable ? 'move' : 'pointer'};
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg style="width: 50%; height: 50%; color: white;" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
          </svg>
        </div>
      </div>
    `,
    className: 'landmark-marker',
    iconSize: [size[0], size[1]],
    iconAnchor: [size[0] / 2, size[1]],
  })

  return (
    <Marker
      position={[landmark.location.lat, landmark.location.lng]}
      icon={icon}
      draggable={isDraggable}
      eventHandlers={{
        click: onClick,
        dragend: (e) => {
          const { lat, lng } = e.target.getLatLng()
          onDrag(lat, lng)
        },
      }}
    >
      <Popup>
        <div className="p-2">
          <h3 className="font-bold">{landmark.name}</h3>
          <p className="text-sm text-gray-600">{landmark.description}</p>
          {landmark.landmarkType && (
            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded mt-1 inline-block">
              {landmark.landmarkType}
            </span>
          )}
        </div>
      </Popup>
    </Marker>
  )
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export default function LandmarksEditor() {
  const [landmarks, setLandmarks] = useState<DubaiLandmark[]>([])
  const [selectedLandmark, setSelectedLandmark] = useState<DubaiLandmark | null>(null)
  const [isPlacingMode, setIsPlacingMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [originalLandmarks, setOriginalLandmarks] = useState<DubaiLandmark[]>([])

  // Form state
  const [formData, setFormData] = useState<Partial<DubaiLandmark>>(DEFAULT_LANDMARK)

  useEffect(() => {
    loadLandmarks()
  }, [])

  useEffect(() => {
    if (selectedLandmark) {
      setFormData(selectedLandmark)
    }
  }, [selectedLandmark])

  const loadLandmarks = async () => {
    const data = await fetchDubaiLandmarks()
    setLandmarks(data)
    setOriginalLandmarks(JSON.parse(JSON.stringify(data)))
  }

  const handleAddNew = () => {
    setIsPlacingMode(true)
    setSelectedLandmark(null)
    setFormData(DEFAULT_LANDMARK)
  }

  const handleMapClick = (lat: number, lng: number) => {
    if (!isPlacingMode) return

    const newLandmark: any = {
      ...DEFAULT_LANDMARK,
      id: `temp-${Date.now()}`,
      location: { lat, lng },
    }
    setLandmarks([...landmarks, newLandmark])
    setSelectedLandmark(newLandmark)
    setFormData(newLandmark)
    setIsPlacingMode(false)
  }

  const handleDrag = (lat: number, lng: number) => {
    if (!selectedLandmark) return
    
    const updated = { ...selectedLandmark, location: { lat, lng } }
    setLandmarks(landmarks.map(l => l.id === selectedLandmark.id ? updated : l))
    setSelectedLandmark(updated)
    setFormData({ ...formData, location: { lat, lng } })
  }

  const handleSave = async () => {
    if (!selectedLandmark || !formData) return
    
    setIsSaving(true)
    try {
      if (selectedLandmark.id.startsWith('temp-')) {
        // Create new landmark
        const created = await createDubaiLandmark(formData)
        if (created) {
          setLandmarks(landmarks.map(l => l.id === selectedLandmark.id ? created : l))
          setSelectedLandmark(created)
          localStorage.removeItem('gulf_dubai_landmarks')
        }
      } else {
        // Update existing landmark
        const updated = await updateDubaiLandmark(selectedLandmark.id, formData)
        if (updated) {
          setLandmarks(landmarks.map(l => l.id === selectedLandmark.id ? updated : l))
          setSelectedLandmark(updated)
          localStorage.removeItem('gulf_dubai_landmarks')
        }
      }
    } catch (error) {
      console.error('Error saving landmark:', error)
      alert('Failed to save landmark')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedLandmark) return
    
    if (!confirm(`Delete "${selectedLandmark.name}"?`)) return
    
    if (selectedLandmark.id.startsWith('temp-')) {
      setLandmarks(landmarks.filter(l => l.id !== selectedLandmark.id))
      setSelectedLandmark(null)
    } else {
      const success = await deleteDubaiLandmark(selectedLandmark.id)
      if (success) {
        setLandmarks(landmarks.filter(l => l.id !== selectedLandmark.id))
        setSelectedLandmark(null)
        localStorage.removeItem('gulf_dubai_landmarks')
      }
    }
  }

  const handleReset = () => {
    if (!confirm('Reset all changes?')) return
    setLandmarks(JSON.parse(JSON.stringify(originalLandmarks)))
    setSelectedLandmark(null)
    setIsPlacingMode(false)
    loadLandmarks()
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-96 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b bg-slate-50">
          <div className="flex gap-2">
            <Button
              onClick={handleAddNew}
              className="flex-1"
              variant={isPlacingMode ? "default" : "outline"}
            >
              <MapPin className="w-4 h-4 mr-2" />
              {isPlacingMode ? 'Click map to place' : 'Add Landmark'}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>
          {isPlacingMode && (
            <p className="text-sm text-blue-600 mt-2">
              Click anywhere on the map to place the landmark
            </p>
          )}
        </div>

        {/* Landmarks List */}
        <div className="p-4">
          <h3 className="font-semibold mb-2">Landmarks ({landmarks.length})</h3>
          <div className="space-y-2">
            {landmarks.map((landmark) => (
              <div
                key={landmark.id}
                onClick={() => {
                  setSelectedLandmark(landmark)
                  setIsPlacingMode(false)
                }}
                className={`p-3 border rounded cursor-pointer transition-all ${
                  selectedLandmark?.id === landmark.id ? 'border-primary bg-primary/5' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: landmark.color }}
                  />
                  <span className="font-medium">{landmark.name}</span>
                </div>
                <span className="text-xs text-gray-500">{landmark.landmarkType}</span>
                {landmark.id.startsWith('temp-') && (
                  <span className="text-xs text-orange-600 ml-2">Unsaved</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Edit Form */}
        {selectedLandmark && (
          <div className="p-4 border-t bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Edit Landmark</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedLandmark(null)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <Label>Type *</Label>
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
                  <option value="entertainment">Entertainment</option>
                </select>
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
                <Label>Year Built</Label>
                <Input
                  type="number"
                  value={formData.yearBuilt || ''}
                  onChange={(e) => setFormData({ ...formData, yearBuilt: parseInt(e.target.value) })}
                />
              </div>

              <div>
                <Label>Website URL</Label>
                <Input
                  type="url"
                  value={formData.websiteUrl || ''}
                  onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                />
              </div>

              <div>
                <Label>Location</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="Lat"
                    value={formData.location?.lat || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      location: { ...formData.location!, lat: parseFloat(e.target.value) }
                    })}
                  />
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="Lng"
                    value={formData.location?.lng || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      location: { ...formData.location!, lng: parseFloat(e.target.value) }
                    })}
                  />
                </div>
              </div>

              <div>
                <Label>Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color || '#EF4444'}
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
                <Label>Size</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={formData.size || 'medium'}
                  onChange={(e) => setFormData({ ...formData, size: e.target.value as any })}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
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

              <p className="text-xs text-blue-600 mt-2">
                💡 Drag the marker on the map to adjust position
              </p>
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
          
          <MapClickHandler onMapClick={handleMapClick} />
          
          {landmarks.map((landmark) => (
            <DraggableLandmarkMarker
              key={landmark.id}
              landmark={landmark}
              isSelected={selectedLandmark?.id === landmark.id}
              onClick={() => {
                setSelectedLandmark(landmark)
                setIsPlacingMode(false)
              }}
              onDrag={handleDrag}
              isDraggable={selectedLandmark?.id === landmark.id}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
