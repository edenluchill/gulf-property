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
  deleteDubaiArea,
  createDubaiLandmark,
  deleteDubaiLandmark,
  batchUpdateDubai,
} from '../lib/api'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

type EditMode = 'idle' | 'placing-landmark' | 'drawing-area'
type SelectedItem = { type: 'area'; item: DubaiArea } | { type: 'landmark'; item: DubaiLandmark } | null
type ActiveTab = 'areas' | 'landmarks'

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
  mapRef,
}: any) {
  const map = useMap()
  const polygonLayersRef = useRef<Map<string, L.Polygon>>(new Map())
  const markerLayersRef = useRef<Map<string, L.Marker>>(new Map())
  const labelLayersRef = useRef<Map<string, L.Marker>>(new Map())
  const labelSpansRef = useRef<Map<string, number>>(new Map())

  // Store map reference
  useEffect(() => {
    if (mapRef) {
      mapRef.current = map
    }
  }, [map, mapRef])

  // Initialize Geoman (no controls on map, will be in sidebar)
  useEffect(() => {
    // Global snap settings for perfect alignment
    map.pm.setGlobalOptions({
      snapDistance: 20,
      snapMiddle: true,
      snapSegment: true,
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
      map.off('pm:create')
      map.off('click')
    }
  }, [map, editMode, onShapeCreate, onMapClick])

  // Render areas as polygons (editable + draggable + with center labels)
  useEffect(() => {
    // Clear old layers
    polygonLayersRef.current.forEach((layer) => map.removeLayer(layer))
    polygonLayersRef.current.clear()
    labelLayersRef.current.forEach((label) => map.removeLayer(label))
    labelLayersRef.current.clear()
    labelSpansRef.current.clear()

    areas.forEach((area: DubaiArea) => {
      if (!area.boundary || area.boundary.type !== 'Polygon') return

      const coords = (area.boundary as any).coordinates[0].map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      )

      const isSelected = selectedItem?.type === 'area' && selectedItem.item.id === area.id

      const polygon = L.polygon(coords, {
        color: isSelected ? '#000' : area.color,
        fillColor: area.color,
        fillOpacity: area.opacity || 0.3,
        weight: isSelected ? 4 : 2,
        dashArray: isSelected ? undefined : '5, 10',
        pmIgnore: false, // Allow Geoman to handle this layer
        bubblingMouseEvents: isSelected ? true : false, // Allow events for selected polygon
      })

      // ⚠️ CRITICAL: Add to map FIRST before calling pm.enable()
      polygon.addTo(map)
      polygonLayersRef.current.set(area.id, polygon)

      // Enable editing ONLY for selected polygons (shows vertices)
      if (isSelected) {
        polygon.pm.enable({
          allowSelfIntersection: false,
          snapDistance: 20,
          snapMiddle: true,
          snapSegment: true,
          draggable: false, // We use custom drag for all polygons
          preventMarkerRemoval: true,
        })

        // Handle vertex editing
        polygon.on('pm:edit', () => {
          const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
          const geoJsonCoords = latlngs.map((ll: L.LatLng) => [ll.lng, ll.lat])
          geoJsonCoords.push(geoJsonCoords[0])

          onAreaUpdate(area.id, {
            type: 'Polygon',
            coordinates: [geoJsonCoords],
          })
        })

        // Disable map dragging when editing vertices
        polygon.on('pm:markerdragstart', () => {
          map.dragging.disable()
        })

        polygon.on('pm:markerdragend', () => {
          map.dragging.enable()
        })
      } else {
        polygon.pm.disable()
      }

      // ⭐ CUSTOM DRAG - Works for ALL polygons (selected or not)
      let isDragging = false
      let hasDragged = false
      let startLatLng: L.LatLng | null = null
      let startPoints: L.LatLng[] = []

      polygon.on('mousedown', (e: any) => {
        // Only drag if clicking on the polygon itself (not vertices)
        if (!e.originalEvent.target.classList || 
            !e.originalEvent.target.classList.contains('marker-icon')) {
          isDragging = true
          hasDragged = false
          startLatLng = e.latlng
          const latlngs = polygon.getLatLngs()
          startPoints = Array.isArray(latlngs[0]) ? [...latlngs[0] as L.LatLng[]] : []
          
          // Hide editing vertices and label while dragging
          if (isSelected) {
            polygon.pm.disable()
          }
          const label = labelLayersRef.current.get(area.id)
          if (label) {
            label.setOpacity(0)
          }
          
          map.dragging.disable()
          L.DomEvent.stop(e)
        }
      })

      map.on('mousemove', (e: any) => {
        if (isDragging && startLatLng) {
          hasDragged = true
          const latDiff = e.latlng.lat - startLatLng.lat
          const lngDiff = e.latlng.lng - startLatLng.lng
          
          const newPoints = startPoints.map((point: L.LatLng) => 
            L.latLng(point.lat + latDiff, point.lng + lngDiff)
          )
          
          polygon.setLatLngs(newPoints)
        }
      })

      const endDrag = () => {
        if (isDragging) {
          isDragging = false
          startLatLng = null
          startPoints = []
          
          // If dragged, select the area and save
          if (hasDragged) {
            // Select this area if not already selected
            if (!isSelected) {
              onItemSelect({ type: 'area', item: area })
            }
            
            const label = labelLayersRef.current.get(area.id)
            if (label) {
              label.setOpacity(1)
              // Update label position to new center
              const newCenter = polygon.getBounds().getCenter()
              label.setLatLng(newCenter)
            }
            
            const latlngs = polygon.getLatLngs()[0] as L.LatLng[]
            const geoJsonCoords = latlngs.map((ll: L.LatLng) => [ll.lng, ll.lat])
            geoJsonCoords.push(geoJsonCoords[0])

            onAreaUpdate(area.id, {
              type: 'Polygon',
              coordinates: [geoJsonCoords],
            })
          } else {
            // Just a click, not a drag - select the area
            const label = labelLayersRef.current.get(area.id)
            if (label) {
              label.setOpacity(1)
            }
            if (!isSelected) {
              onItemSelect({ type: 'area', item: area })
            }
          }
          
          map.dragging.enable()
          hasDragged = false
        }
      }

      map.on('mouseup', endDrag)
      polygon.on('mouseup', endDrag)

      // Add center label (properly centered)
      const center = polygon.getBounds().getCenter()
      // Estimate label width based on text length (rough calculation)
      const estimatedWidth = area.name.length * 7 + 24
      const labelIcon = L.divIcon({
        html: `
          <div style="
            background: ${isSelected ? '#000' : area.color};
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            border: 2px solid white;
            pointer-events: none;
            text-align: center;
          ">
            ${area.name}
          </div>
        `,
        className: 'area-label',
        iconSize: [estimatedWidth, 24],
        iconAnchor: [estimatedWidth / 2, 12], // Center horizontally and vertically
      })

      const labelMarker = L.marker(center, {
        icon: labelIcon,
        interactive: false,
        keyboard: false,
      })

      labelMarker.addTo(map)
      labelLayersRef.current.set(area.id, labelMarker)

      // Compute polygon span for zoom-based visibility
      let minLat = Infinity, maxLat = -Infinity, minLng2 = Infinity, maxLng2 = -Infinity
      for (const [lat, lng] of coords) {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng2) minLng2 = lng
        if (lng > maxLng2) maxLng2 = lng
      }
      const dLat = maxLat - minLat
      const dLng = maxLng2 - minLng2
      labelSpansRef.current.set(area.id, Math.sqrt(dLat * dLat + dLng * dLng))
    })

    return () => {
      // Clean up map-level listeners
      map.off('mousemove')
      map.off('mouseup')
      
      polygonLayersRef.current.forEach((layer) => {
        layer.off('mousedown')
        layer.off('mouseup')
        layer.off('click')
        layer.off('pm:edit')
        layer.off('pm:markerdragstart')
        layer.off('pm:markerdragend')
        if (layer.pm) {
          layer.pm.disable()
        }
      })
    }
  }, [map, areas, selectedItem, onItemSelect, onAreaUpdate])

  // Progressive label visibility — larger areas stay visible at low zoom
  useEffect(() => {
    const getMinSpan = (zoom: number): number => {
      if (zoom >= 14) return 0
      if (zoom >= 13) return 0.005
      if (zoom >= 12) return 0.012
      if (zoom >= 11) return 0.025
      return 0.045
    }

    const updateVisibility = () => {
      const minSpan = getMinSpan(map.getZoom())
      labelLayersRef.current.forEach((label, areaId) => {
        const span = labelSpansRef.current.get(areaId) ?? 0
        label.setOpacity(span >= minSpan ? 1 : 0)
      })
    }

    updateVisibility()
    map.on('zoomend', updateVisibility)
    return () => { map.off('zoomend', updateVisibility) }
  }, [map, areas])

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
        bubblingMouseEvents: false, // Prevent events from bubbling to map
      })

      // Prevent marker mouse events from reaching the map
      marker.on('mousedown', (e: any) => {
        L.DomEvent.stop(e)
      })

      marker.on('mouseup', (e: any) => {
        L.DomEvent.stop(e)
      })

      // Click to select (prevent map interaction)
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e)
        onItemSelect({ type: 'landmark', item: landmark })
      })

      // Disable map dragging when dragging marker
      marker.on('dragstart', () => {
        map.dragging.disable()
      })

      marker.on('dragend', (e: any) => {
        const { lat, lng } = e.target.getLatLng()
        onLandmarkDrag(landmark.id, lat, lng)
        map.dragging.enable()
      })

      marker.addTo(map)
      markerLayersRef.current.set(landmark.id, marker)
    })

    return () => {
      markerLayersRef.current.forEach((marker) => {
        marker.off('mousedown')
        marker.off('mouseup')
        marker.off('click')
        marker.off('dragstart')
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('areas')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Track modified items (draft state)
  const [modifiedAreaIds, setModifiedAreaIds] = useState<Set<string>>(new Set())
  const [modifiedLandmarkIds, setModifiedLandmarkIds] = useState<Set<string>>(new Set())

  // Store original data as baseline for comparison
  const [originalAreas, setOriginalAreas] = useState<DubaiArea[]>([])
  const [originalLandmarks, setOriginalLandmarks] = useState<DubaiLandmark[]>([])

  // History for Undo/Redo
  const [history, setHistory] = useState<Array<{ areas: DubaiArea[], landmarks: DubaiLandmark[] }>>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Form data
  const [formData, setFormData] = useState<any>({})

  useEffect(() => {
    loadData()
  }, [])

  // Initialize history when data is loaded
  useEffect(() => {
    if (areas.length > 0 || landmarks.length > 0) {
      if (history.length === 0) {
        setHistory([{ areas: [...areas], landmarks: [...landmarks] }])
        setHistoryIndex(0)
      }
    }
  }, [areas.length, landmarks.length])

  // Compare current state with original to find modified items
  const updateModifiedItems = (currentAreas: DubaiArea[], currentLandmarks: DubaiLandmark[]) => {
    const modifiedAreas = new Set<string>()
    const modifiedLandmarks = new Set<string>()

    // Compare areas
    currentAreas.forEach(area => {
      if (!area.id.startsWith('temp-')) {
        const original = originalAreas.find(a => a.id === area.id)
        if (original && JSON.stringify(area.boundary) !== JSON.stringify(original.boundary)) {
          modifiedAreas.add(area.id)
        }
      }
    })

    // Compare landmarks
    currentLandmarks.forEach(landmark => {
      if (!landmark.id.startsWith('temp-')) {
        const original = originalLandmarks.find(l => l.id === landmark.id)
        if (original && 
            (landmark.location.lat !== original.location.lat || 
             landmark.location.lng !== original.location.lng)) {
          modifiedLandmarks.add(landmark.id)
        }
      }
    })

    setModifiedAreaIds(modifiedAreas)
    setModifiedLandmarkIds(modifiedLandmarks)
  }

  // Save current state to history
  const saveToHistory = () => {
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push({ 
      areas: JSON.parse(JSON.stringify(areas)), 
      landmarks: JSON.parse(JSON.stringify(landmarks)) 
    })
    // Limit history to 50 states
    if (newHistory.length > 50) {
      newHistory.shift()
    } else {
      setHistoryIndex(historyIndex + 1)
    }
    setHistory(newHistory)
  }

  // Undo
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      const snapshot = history[newIndex]
      setAreas([...snapshot.areas])
      setLandmarks([...snapshot.landmarks])
      setHistoryIndex(newIndex)
      
      // Update modified items by comparing with original
      updateModifiedItems(snapshot.areas, snapshot.landmarks)
    }
  }

  // Redo
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      const snapshot = history[newIndex]
      setAreas([...snapshot.areas])
      setLandmarks([...snapshot.landmarks])
      setHistoryIndex(newIndex)
      
      // Update modified items by comparing with original
      updateModifiedItems(snapshot.areas, snapshot.landmarks)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      } else if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [historyIndex, history])

  useEffect(() => {
    if (selectedItem) {
      setFormData(selectedItem.item)
    } else {
      setFormData({})
    }
  }, [selectedItem])

  // Sync formData changes to areas/landmarks state (for real-time updates)
  const handleFormDataChange = (updates: any) => {
    const newFormData = { ...formData, ...updates }
    setFormData(newFormData)

    if (!selectedItem) return

    if (selectedItem.type === 'area') {
      const updatedAreas = areas.map((a) => 
        a.id === selectedItem.item.id ? { ...a, ...updates } : a
      )
      setAreas(updatedAreas)
      setSelectedItem({ type: 'area', item: { ...selectedItem.item, ...updates } })
      
      // Mark as modified if not a temp item
      if (!selectedItem.item.id.startsWith('temp-')) {
        const hasChanges = Object.keys(updates).some(key => {
          const original = originalAreas.find(a => a.id === selectedItem.item.id)
          return original && JSON.stringify(original[key as keyof DubaiArea]) !== JSON.stringify(updates[key])
        })
        if (hasChanges) {
          setModifiedAreaIds(new Set(modifiedAreaIds).add(selectedItem.item.id))
        }
      }
    } else if (selectedItem.type === 'landmark') {
      const updatedLandmarks = landmarks.map((l) => 
        l.id === selectedItem.item.id ? { ...l, ...updates } : l
      )
      setLandmarks(updatedLandmarks)
      setSelectedItem({ type: 'landmark', item: { ...selectedItem.item, ...updates } })
      
      // Mark as modified if not a temp item
      if (!selectedItem.item.id.startsWith('temp-')) {
        const hasChanges = Object.keys(updates).some(key => {
          const original = originalLandmarks.find(l => l.id === selectedItem.item.id)
          return original && JSON.stringify(original[key as keyof DubaiLandmark]) !== JSON.stringify(updates[key])
        })
        if (hasChanges) {
          setModifiedLandmarkIds(new Set(modifiedLandmarkIds).add(selectedItem.item.id))
        }
      }
    }
  }

  const loadData = async () => {
    const [areasData, landmarksData] = await Promise.all([
      fetchDubaiAreas(),
      fetchDubaiLandmarks(),
    ])
    setAreas(areasData)
    setLandmarks(landmarksData)
    // Store original data for comparison
    setOriginalAreas(JSON.parse(JSON.stringify(areasData)))
    setOriginalLandmarks(JSON.parse(JSON.stringify(landmarksData)))
  }

  const handleAddArea = () => {
    setEditMode('drawing-area')
    setSelectedItem(null)
    // Trigger Leaflet Geoman draw mode
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.pm.enableDraw('Polygon', {
          snappable: true,
          snapDistance: 20,
        })
      }
    }, 100)
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
      description: '',
      color: '#3B82F6',
      opacity: 0.3,
    }
    setAreas([...areas, newArea])
    setSelectedItem({ type: 'area', item: newArea })
    setEditMode('idle')
    // Disable draw mode
    if (mapRef.current) {
      mapRef.current.pm.disableDraw()
    }
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

  const handleAreaUpdate = (id: string, boundary: any, shouldSaveHistory = true) => {
    const updated = areas.map((a) => (a.id === id ? { ...a, boundary } : a))
    setAreas(updated)
    if (selectedItem?.type === 'area' && selectedItem.item.id === id) {
      setSelectedItem({ type: 'area', item: { ...selectedItem.item, boundary } })
    }
    // Mark as modified (draft state)
    if (!id.startsWith('temp-')) {
      setModifiedAreaIds(new Set(modifiedAreaIds).add(id))
    }
    // Save to history after state update
    if (shouldSaveHistory) {
      setTimeout(() => saveToHistory(), 0)
    }
  }

  const handleLandmarkDrag = (id: string, lat: number, lng: number, shouldSaveHistory = true) => {
    const updated = landmarks.map((l) => (l.id === id ? { ...l, location: { lat, lng } } : l))
    setLandmarks(updated)
    if (selectedItem?.type === 'landmark' && selectedItem.item.id === id) {
      setSelectedItem({ type: 'landmark', item: { ...selectedItem.item, location: { lat, lng } } })
      setFormData({ ...formData, location: { lat, lng } })
    }
    // Mark as modified (draft state)
    if (!id.startsWith('temp-')) {
      setModifiedLandmarkIds(new Set(modifiedLandmarkIds).add(id))
    }
    // Save to history after state update
    if (shouldSaveHistory) {
      setTimeout(() => saveToHistory(), 0)
    }
  }

  const handleSaveAll = async () => {
    // Include temp items (new items) in the count
    const tempAreas = areas.filter(a => a.id.startsWith('temp-'))
    const tempLandmarks = landmarks.filter(l => l.id.startsWith('temp-'))
    const totalChanges = modifiedAreaIds.size + modifiedLandmarkIds.size + tempAreas.length + tempLandmarks.length
    
    if (totalChanges === 0) {
      alert('No changes to save')
      return
    }

    if (!confirm(`Save ${totalChanges} change(s)?`)) return

    setIsSaving(true)
    try {
      // Prepare modified areas (existing items that were changed)
      const modifiedAreas = areas.filter(a => modifiedAreaIds.has(a.id))
      
      // Prepare modified landmarks (existing items that were changed)
      const modifiedLandmarks = landmarks.filter(l => modifiedLandmarkIds.has(l.id))

      // Prepare new areas (temp items)
      const newAreas = areas.filter(a => a.id.startsWith('temp-'))
      
      // Prepare new landmarks (temp items)
      const newLandmarks = landmarks.filter(l => l.id.startsWith('temp-'))

      // Create new items first
      const createdAreas: DubaiArea[] = []
      for (const area of newAreas) {
        const created = await createDubaiArea(area)
        if (created) createdAreas.push(created)
      }

      const createdLandmarks: DubaiLandmark[] = []
      for (const landmark of newLandmarks) {
        const created = await createDubaiLandmark(landmark)
        if (created) createdLandmarks.push(created)
      }

      // Batch update existing modified items
      if (modifiedAreas.length > 0 || modifiedLandmarks.length > 0) {
        await batchUpdateDubai({
          areas: modifiedAreas,
          landmarks: modifiedLandmarks,
        })
      }

      // Update state: replace temp items with created ones, keep modified items
      const updatedAreas = areas.map(a => {
        if (a.id.startsWith('temp-')) {
          const created = createdAreas.find(c => c.name === a.name)
          return created || a
        }
        return a
      })

      const updatedLandmarks = landmarks.map(l => {
        if (l.id.startsWith('temp-')) {
          const created = createdLandmarks.find(c => c.name === l.name)
          return created || l
        }
        return l
      })

      setAreas(updatedAreas)
      setLandmarks(updatedLandmarks)
      
      // Clear modified sets
      setModifiedAreaIds(new Set())
      setModifiedLandmarkIds(new Set())
      
      // Update original baseline to current state
      setOriginalAreas(JSON.parse(JSON.stringify(updatedAreas)))
      setOriginalLandmarks(JSON.parse(JSON.stringify(updatedLandmarks)))
      
      // Update selected item if it was a temp item
      if (selectedItem) {
        if (selectedItem.type === 'area' && selectedItem.item.id.startsWith('temp-')) {
          const created = createdAreas.find(c => c.name === selectedItem.item.name)
          if (created) setSelectedItem({ type: 'area', item: created })
        } else if (selectedItem.type === 'landmark' && selectedItem.item.id.startsWith('temp-')) {
          const created = createdLandmarks.find(c => c.name === selectedItem.item.name)
          if (created) setSelectedItem({ type: 'landmark', item: created })
        }
      }
      
      // Clear cache and update timestamps to trigger MapPage reload
      localStorage.removeItem('gulf_dubai_areas')
      localStorage.removeItem('gulf_dubai_landmarks')
      localStorage.removeItem('gulf_dubai_areas_timestamp')
      localStorage.removeItem('gulf_dubai_landmarks_timestamp')
      
      // Trigger custom event to notify MapPage immediately
      window.dispatchEvent(new CustomEvent('dubaiDataUpdated'))
      
      alert(`✅ Saved ${totalChanges} change(s) successfully!`)
    } catch (error) {
      console.error('Batch save error:', error)
      alert('❌ Failed to save changes. Please try again.')
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
          localStorage.removeItem('gulf_dubai_areas_timestamp')
          // Notify MapPage of the deletion
          window.dispatchEvent(new CustomEvent('dubaiDataUpdated'))
        }
      } else {
        const landmark = selectedItem.item
        if (landmark.id.startsWith('temp-')) {
          setLandmarks(landmarks.filter((l) => l.id !== landmark.id))
        } else {
          await deleteDubaiLandmark(landmark.id)
          setLandmarks(landmarks.filter((l) => l.id !== landmark.id))
          localStorage.removeItem('gulf_dubai_landmarks')
          localStorage.removeItem('gulf_dubai_landmarks_timestamp')
          // Notify MapPage of the deletion
          window.dispatchEvent(new CustomEvent('dubaiDataUpdated'))
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
      handleFormDataChange({ imageUrl: url })
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)]">
      {/* Global Action Buttons - Fixed Position */}
      <div className="fixed top-20 right-6 z-50 flex gap-2">
        {/* Undo/Redo Buttons */}
        <div className="flex gap-1 bg-white rounded-lg shadow-lg p-1">
          <Button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            size="sm"
            variant="ghost"
            title="Undo (Ctrl+Z)"
            className="hover:bg-slate-100"
          >
            <span className="text-lg">↶</span>
          </Button>
          <Button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            size="sm"
            variant="ghost"
            title="Redo (Ctrl+Shift+Z)"
            className="hover:bg-slate-100"
          >
            <span className="text-lg">↷</span>
          </Button>
        </div>

        {/* Save All Button */}
        {(modifiedAreaIds.size + modifiedLandmarkIds.size + areas.filter(a => a.id.startsWith('temp-')).length + landmarks.filter(l => l.id.startsWith('temp-')).length) > 0 && (
          <Button
            onClick={handleSaveAll}
            disabled={isSaving}
            size="lg"
            className="bg-green-600 hover:bg-green-700 text-white shadow-lg"
          >
            <Save className="w-5 h-5 mr-2" />
            {isSaving ? 'Saving...' : `Save All (${modifiedAreaIds.size + modifiedLandmarkIds.size + areas.filter(a => a.id.startsWith('temp-')).length + landmarks.filter(l => l.id.startsWith('temp-')).length})`}
          </Button>
        )}
      </div>

      {/* Left Toolbar */}
      <div className="w-80 bg-white border-r flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b bg-slate-50">
          <h2 className="font-bold text-lg mb-3">Dubai Map Editor</h2>
          
          {/* Draft indicator */}
          {(() => {
            const tempCount = areas.filter(a => a.id.startsWith('temp-')).length + landmarks.filter(l => l.id.startsWith('temp-')).length
            const totalChanges = modifiedAreaIds.size + modifiedLandmarkIds.size + tempCount
            return totalChanges > 0 && (
              <div className="mb-3 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                <p className="font-semibold text-orange-900">
                  📝 {totalChanges} unsaved change(s)
                </p>
                <p className="text-orange-700 mt-1">
                  Click "Save All" to save your changes
                </p>
              </div>
            )
          })()}
          
          {/* Pro Tips */}
          <div className="p-2 bg-blue-50 rounded text-xs text-slate-700 space-y-1">
            <p className="font-semibold text-blue-900">✨ Quick Guide:</p>
            <p>• Click to select, drag to move</p>
            <p>• Hover edges to edit shape</p>
            <p>• Vertices auto-snap perfectly</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => {
              setActiveTab('areas')
              setEditMode('idle')
            }}
            className={`flex-1 px-4 py-3 font-semibold text-sm transition-colors ${
              activeTab === 'areas'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-4 h-4 inline mr-2" />
            Areas ({areas.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('landmarks')
              setEditMode('idle')
            }}
            className={`flex-1 px-4 py-3 font-semibold text-sm transition-colors ${
              activeTab === 'landmarks'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MapPin className="w-4 h-4 inline mr-2" />
            Landmarks ({landmarks.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {activeTab === 'areas' && (
            <>
              {/* Area Tools */}
              <div className="p-4 bg-slate-50 border-b space-y-2">
                <Button
                  onClick={handleAddArea}
                  variant={editMode === 'drawing-area' ? 'default' : 'outline'}
                  className="w-full"
                  size="lg"
                >
                  <Layers className="w-5 h-5 mr-2" />
                  {editMode === 'drawing-area' ? '🎨 Draw on Map...' : 'Add New Area'}
                </Button>
                
                {editMode === 'drawing-area' && (
                  <div className="p-3 bg-blue-50 rounded text-sm space-y-2">
                    <p className="font-semibold text-blue-900">Drawing Mode Active:</p>
                    <div className="space-y-1 text-xs text-slate-700">
                      <p>✏️ Click map points to draw polygon</p>
                      <p>🔗 Points auto-snap when close</p>
                      <p>✅ Click first point to finish</p>
                      <p>✂️ Use Cut tool for complex shapes</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Areas List */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-1">
                  {areas.map((area) => (
                    <div
                      key={area.id}
                      onClick={() => {
                        setSelectedItem({ type: 'area', item: area })
                        setEditMode('idle')
                      }}
                      className={`p-3 rounded cursor-pointer transition-all flex items-center gap-3 ${
                        selectedItem?.type === 'area' && selectedItem.item.id === area.id
                          ? 'bg-blue-50 border-blue-300 border-2 shadow-sm'
                          : 'hover:bg-slate-50 border-2 border-transparent'
                      }`}
                    >
                      <div className="w-4 h-4 rounded" style={{ background: area.color }} />
                      <span className="text-sm flex-1 font-medium">{area.name}</span>
                      {area.id.startsWith('temp-') && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">New</span>
                      )}
                      {modifiedAreaIds.has(area.id) && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Draft</span>
                      )}
                    </div>
                  ))}
                  {areas.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No areas yet. Click "Add New Area" to start.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'landmarks' && (
            <>
              {/* Landmark Tools */}
              <div className="p-4 bg-slate-50 border-b space-y-2">
                <Button
                  onClick={handleAddLandmark}
                  variant={editMode === 'placing-landmark' ? 'default' : 'outline'}
                  className="w-full"
                  size="lg"
                >
                  <MapPin className="w-5 h-5 mr-2" />
                  {editMode === 'placing-landmark' ? '📍 Click Map...' : 'Add New Landmark'}
                </Button>
                
                {editMode === 'placing-landmark' && (
                  <div className="p-3 bg-blue-50 rounded text-sm space-y-2">
                    <p className="font-semibold text-blue-900">Placement Mode Active:</p>
                    <p className="text-xs text-slate-700">📍 Click anywhere on map to place landmark</p>
                  </div>
                )}
              </div>

              {/* Landmarks List */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-1">
                  {landmarks.map((landmark) => (
                    <div
                      key={landmark.id}
                      onClick={() => {
                        setSelectedItem({ type: 'landmark', item: landmark })
                        setEditMode('idle')
                      }}
                      className={`p-3 rounded cursor-pointer transition-all flex items-center gap-3 ${
                        selectedItem?.type === 'landmark' && selectedItem.item.id === landmark.id
                          ? 'bg-blue-50 border-blue-300 border-2 shadow-sm'
                          : 'hover:bg-slate-50 border-2 border-transparent'
                      }`}
                    >
                      <div className="w-4 h-4 rounded-full" style={{ background: landmark.color }} />
                      <span className="text-sm flex-1 font-medium">{landmark.name}</span>
                      {landmark.id.startsWith('temp-') && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">New</span>
                      )}
                      {modifiedLandmarkIds.has(landmark.id) && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Draft</span>
                      )}
                    </div>
                  ))}
                  {landmarks.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No landmarks yet. Click "Add New Landmark" to start.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[25.0961, 55.1561]}
          zoom={11}
          className="h-full w-full"
          doubleClickZoom={false}
          zoomControl={true}
          scrollWheelZoom={true}
          dragging={true}
          touchZoom={true}
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
            mapRef={mapRef}
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
                onChange={(e) => handleFormDataChange({ name: e.target.value })}
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
                          onClick={() => handleFormDataChange({ imageUrl: '' })}
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
                      onChange={(e) => handleFormDataChange({ imageUrl: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Type</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.landmarkType || ''}
                    onChange={(e) => handleFormDataChange({ landmarkType: e.target.value })}
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
                    onChange={(e) => handleFormDataChange({ size: e.target.value })}
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
                  <Label>Opacity: {((formData.opacity || 0.3) * 100).toFixed(0)}%</Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formData.opacity || 0.3}
                    onChange={(e) => handleFormDataChange({ opacity: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
                
                {/* Market Data - Editable */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-700">📊 Market Data</h4>
                  
                  <div>
                    <Label>Projects Count</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 14"
                      value={formData.projectCounts || ''}
                      onChange={(e) => handleFormDataChange({ projectCounts: parseInt(e.target.value) || 0 })}
                    />
                  </div>

                  <div>
                    <Label>Average Price (AED)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 850000"
                      value={formData.averagePrice || ''}
                      onChange={(e) => handleFormDataChange({ averagePrice: parseInt(e.target.value) || 0 })}
                    />
                  </div>

                  <div>
                    <Label>Capital Appreciation (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 11.2"
                      value={formData.capitalAppreciation || ''}
                      onChange={(e) => handleFormDataChange({ capitalAppreciation: parseFloat(e.target.value) || 0 })}
                    />
                  </div>

                  <div>
                    <Label>Rental Yield (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 7.8"
                      value={formData.rentalYield || ''}
                      onChange={(e) => handleFormDataChange({ rentalYield: parseFloat(e.target.value) || 0 })}
                    />
                  </div>

                  <div>
                    <Label>Sales Volume (Units/Year)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 250"
                      value={formData.salesVolume || ''}
                      onChange={(e) => handleFormDataChange({ salesVolume: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <Label>Description</Label>
              <textarea
                className="w-full border rounded px-3 py-2"
                rows={3}
                value={formData.description || ''}
                onChange={(e) => handleFormDataChange({ description: e.target.value })}
              />
            </div>

            <div>
              <Label>Color</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={formData.color || '#3B82F6'}
                  onChange={(e) => handleFormDataChange({ color: e.target.value })}
                  className="w-12 h-10 rounded cursor-pointer"
                />
                <Input
                  value={formData.color || ''}
                  onChange={(e) => handleFormDataChange({ color: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="p-4 border-t bg-slate-50 flex gap-2">
            <div className="flex-1 text-sm text-slate-600 flex items-center">
              <span>💡 Changes auto-tracked. Click "Save All" to save.</span>
            </div>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
