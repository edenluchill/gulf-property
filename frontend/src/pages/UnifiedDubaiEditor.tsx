import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Save, Trash2, MapPin, Layers, Upload, X, Route, ArrowLeft } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
import { RoutesMapController, RoutesSidebar, useRoutesEditor } from '../components/RoutesEditor'

type EditMode = 'idle' | 'placing-landmark' | 'drawing-area'
type SelectedItem = { type: 'area'; item: DubaiArea } | { type: 'landmark'; item: DubaiLandmark } | null
type ActiveTab = 'areas' | 'landmarks' | 'routes'

// Create landmark icon: image thumbnail or neutral icon, white border + shadow
function createLandmarkIcon(landmark: DubaiLandmark, isSelected: boolean): L.DivIcon {
  const size = isSelected ? 52 : 44
  const borderW = isSelected ? 3 : 2.5
  const borderColor = isSelected ? '#1e40af' : '#fff'
  const shadow = isSelected
    ? 'box-shadow:0 0 0 3px rgba(30,64,175,0.35),0 1px 4px rgba(0,0,0,0.25),0 4px 12px rgba(0,0,0,0.12);'
    : 'box-shadow:0 1px 4px rgba(0,0,0,0.25),0 4px 12px rgba(0,0,0,0.12);'

  if (landmark.imageUrl) {
    const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;border:${borderW}px solid ${borderColor};${shadow}background:#f1f5f9;">
      <img src="${landmark.imageUrl}" style="width:100%;height:100%;object-fit:cover;" />
    </div>`
    return L.divIcon({
      html,
      className: 'landmark-marker-icon',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  }

  // No image: dark slate circle + white MapPin icon
  const iconSvg = renderToStaticMarkup(
    createElement(MapPin, { size: Math.round(size * 0.45), stroke: 'rgba(255,255,255,0.8)', strokeWidth: 2.5, fill: 'none' })
  )
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;border:${borderW}px solid ${borderColor};${shadow}background:#334155;display:flex;align-items:center;justify-content:center;">
    ${iconSvg}
  </div>`

  return L.divIcon({
    html,
    className: 'landmark-marker-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Build landmark popup HTML
function buildLandmarkPopupHtml(
  landmark: DubaiLandmark,
  labels: { built: (year: number) => string; website: string }
): string {
  const imgHtml = landmark.imageUrl
    ? `<img src="${landmark.imageUrl}" style="width:100%;height:160px;object-fit:cover;" />`
    : ''
  const yearHtml = landmark.yearBuilt ? `<span>${labels.built(landmark.yearBuilt)}</span>` : ''
  const linkHtml = landmark.websiteUrl
    ? `<a href="${landmark.websiteUrl}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;">${labels.website} &rarr;</a>`
    : ''
  const metaHtml = (yearHtml || linkHtml)
    ? `<div style="display:flex;gap:8px;margin-top:8px;font-size:12px;color:#6b7280;">${yearHtml}${linkHtml}</div>`
    : ''

  return `<div style="width:288px;overflow:hidden;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
    ${imgHtml}
    <div style="padding:12px;">
      <div style="font-weight:700;font-size:16px;">${landmark.name}</div>
      ${landmark.nameAr ? `<div style="font-size:13px;color:#6b7280;" dir="rtl">${landmark.nameAr}</div>` : ''}
      ${landmark.description ? `<div style="font-size:13px;color:#4b5563;margin-top:4px;">${landmark.description}</div>` : ''}
      ${metaHtml}
    </div>
  </div>`
}

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
  showLabels,
  activeTab,
}: any) {
  const { t } = useTranslation('editor')
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
        color: isSelected ? '#1e40af' : area.color,  // Blue when selected, area color otherwise
        fillColor: area.color,
        fillOpacity: isSelected ? 0.5 : (area.opacity ?? 0.4),  // Match display map opacity
        weight: isSelected ? 3 : 1,  // Thin border like display map
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
        // Skip interaction when on Routes tab
        if (activeTab === 'routes') return

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

      // Add center label (matching display map style)
      const center = polygon.getBounds().getCenter()
      // Get Chinese translation if available
      const zhName = area.translations?.zh?.name || area.translations?.['zh-CN']?.name || ''
      const displayText = zhName ? `${area.name}\n${zhName}` : area.name
      const lineCount = zhName ? 2 : 1
      // Estimate dimensions
      const maxLineLen = Math.max(area.name.length, zhName.length)
      const estimatedWidth = maxLineLen * 6 + 12
      const estimatedHeight = lineCount * 14 + 4

      const labelIcon = L.divIcon({
        html: `
          <div style="
            color: #334155;
            font-size: 9px;
            font-weight: 600;
            white-space: pre-line;
            line-height: 1.3;
            pointer-events: none;
            text-align: center;
            text-shadow:
              -1px -1px 0 #fff,
              1px -1px 0 #fff,
              -1px 1px 0 #fff,
              1px 1px 0 #fff,
              0 0 4px #fff,
              0 0 4px #fff;
            ${isSelected ? 'color: #1e40af; font-weight: 700;' : ''}
          ">${displayText}</div>
        `,
        className: 'area-label-clean',
        iconSize: [estimatedWidth, estimatedHeight],
        iconAnchor: [estimatedWidth / 2, estimatedHeight / 2],
      })

      const labelMarker = L.marker(center, {
        icon: labelIcon,
        interactive: false,
        keyboard: false,
      })

      if (showLabels) {
        labelMarker.addTo(map)
      }
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
  }, [map, areas, selectedItem, onItemSelect, onAreaUpdate, activeTab])

  // Label visibility - controlled by showLabels toggle
  useEffect(() => {
    labelLayersRef.current.forEach((label) => {
      if (showLabels) {
        if (!map.hasLayer(label)) {
          label.addTo(map)
        }
        label.setOpacity(1)
      } else {
        label.setOpacity(0)
      }
    })
  }, [map, showLabels, areas])

  // Render landmarks as markers with type-specific icons and rich popups
  useEffect(() => {
    // Clear old markers
    markerLayersRef.current.forEach((marker) => map.removeLayer(marker))
    markerLayersRef.current.clear()

    landmarks.forEach((landmark: DubaiLandmark) => {
      const isSelected = selectedItem?.type === 'landmark' && selectedItem.item.id === landmark.id

      const icon = createLandmarkIcon(landmark, isSelected)

      const marker = L.marker([landmark.location.lat, landmark.location.lng], {
        icon,
        draggable: activeTab !== 'routes',
        bubblingMouseEvents: false,
      })

      // Bind rich popup
      marker.bindPopup(buildLandmarkPopupHtml(landmark, {
        built: (year: number) => t('unified.popupBuilt', { year }),
        website: t('unified.popupWebsite'),
      }), {
        maxWidth: 300,
        minWidth: 200,
        className: 'landmark-popup',
        closeButton: true,
      })

      // Prevent marker mouse events from reaching the map
      marker.on('mousedown', (e: any) => {
        L.DomEvent.stop(e)
      })

      marker.on('mouseup', (e: any) => {
        L.DomEvent.stop(e)
      })

      // Click to select + open popup (skip when on Routes tab)
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e)
        if (activeTab === 'routes') return
        onItemSelect({ type: 'landmark', item: landmark })
        marker.openPopup()
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
  }, [map, landmarks, selectedItem, onItemSelect, onLandmarkDrag, activeTab])

  return null
}

export default function UnifiedDubaiEditor() {
  const { t } = useTranslation('editor')
  const [areas, setAreas] = useState<DubaiArea[]>([])
  const [landmarks, setLandmarks] = useState<DubaiLandmark[]>([])
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [editMode, setEditMode] = useState<EditMode>('idle')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('areas')
  const [showLabels, setShowLabels] = useState(true)  // Toggle for labels
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Routes editor state (custom routes and stops)
  const routesEditor = useRoutesEditor()

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
  const [routeFormData, setRouteFormData] = useState<any>({})

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

  // Sync routeFormData with routesEditor selection
  useEffect(() => {
    if (routesEditor.selectedItem) {
      setRouteFormData(routesEditor.selectedItem.item)
    } else {
      setRouteFormData({})
    }
  }, [routesEditor.selectedItem])

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

  // Handle route/stop form data changes
  const handleRouteFormDataChange = (updates: any) => {
    const newFormData = { ...routeFormData, ...updates }
    setRouteFormData(newFormData)
  }

  // Save route/stop changes
  const handleSaveRouteForm = async () => {
    if (!routesEditor.selectedItem) return
    await routesEditor.handleSave(routeFormData)
  }

  // Delete route/stop
  const handleDeleteRouteItem = async () => {
    await routesEditor.handleDelete()
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
      alert(t('unified.alertNoChanges'))
      return
    }

    if (!confirm(t('unified.confirmSave', { count: totalChanges }))) return

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
      
      alert(t('unified.alertSaved', { count: totalChanges }))
    } catch (error) {
      console.error('Batch save error:', error)
      alert(t('unified.alertSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return

    if (!confirm(t('common.deleteConfirm', { name: selectedItem.item.name }))) return

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
      alert(t('unified.alertDeleteFailed'))
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert(t('unified.alertSelectImage'))
      return
    }

    setIsUploading(true)
    try {
      const formDataUpload = new FormData()
      formDataUpload.append('image', file)

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/upload/landmark-image`, {
        method: 'POST',
        body: formDataUpload,
      })

      if (!response.ok) throw new Error('Upload failed')

      const { url } = await response.json()
      handleFormDataChange({ imageUrl: url })
    } catch (error) {
      console.error('Upload error:', error)
      alert(t('unified.alertUploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }

  const hasSelection = !!(selectedItem || routesEditor.selectedItem)
  const closeSelection = () => { setSelectedItem(null); routesEditor.setSelectedItem(null) }
  const editTitle = selectedItem?.type === 'area' ? t('unified.editTitleArea') :
    selectedItem?.type === 'landmark' ? t('unified.editTitleLandmark') :
    routesEditor.selectedItem?.type === 'route' ? t('unified.editTitleRoute') :
    routesEditor.selectedItem?.type === 'stop' ? t('unified.editTitleStop') : t('unified.editTitleDefault')

  return (
    <div className="flex h-full">
      {/* Global Action Buttons - Fixed Position */}
      <div className="fixed top-20 right-4 xl:right-6 z-50 flex gap-2">
        {/* Undo/Redo Buttons */}
        <div className="flex gap-1 bg-white rounded-lg shadow-lg p-1">
          <Button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            size="sm"
            variant="ghost"
            title={t('unified.undo')}
            className="hover:bg-slate-100"
          >
            <span className="text-lg">↶</span>
          </Button>
          <Button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            size="sm"
            variant="ghost"
            title={t('unified.redo')}
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
            <Save className="w-5 h-5 me-2" />
            {isSaving ? t('common.saving') : t('unified.saveAll', { count: modifiedAreaIds.size + modifiedLandmarkIds.size + areas.filter(a => a.id.startsWith('temp-')).length + landmarks.filter(l => l.id.startsWith('temp-')).length })}
          </Button>
        )}
      </div>

      {/* Left Toolbar — hidden on tablet when editing (edit panel takes its place) */}
      <div className={`w-64 xl:w-80 bg-white border-r flex-col overflow-hidden ${hasSelection ? 'hidden xl:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-3 xl:p-4 border-b bg-slate-50">
          <h2 className="font-bold text-lg mb-3">{t('unified.title')}</h2>

          {/* Draft indicator */}
          {(() => {
            const tempCount = areas.filter(a => a.id.startsWith('temp-')).length + landmarks.filter(l => l.id.startsWith('temp-')).length
            const totalChanges = modifiedAreaIds.size + modifiedLandmarkIds.size + tempCount
            return totalChanges > 0 && (
              <div className="mb-3 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                <p className="font-semibold text-orange-900">
                  {t('unified.unsavedChanges', { count: totalChanges })}
                </p>
                <p className="text-orange-700 mt-1">
                  {t('unified.clickSaveAll')}
                </p>
              </div>
            )
          })()}

          {/* Pro Tips */}
          <div className="p-2 bg-blue-50 rounded text-xs text-slate-700 space-y-1 hidden xl:block">
            <p className="font-semibold text-blue-900">{t('unified.quickGuide')}</p>
            <p>{t('unified.guide1')}</p>
            <p>{t('unified.guide2')}</p>
            <p>{t('unified.guide3')}</p>
          </div>

          {/* Show/Hide Labels Toggle */}
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700">{t('unified.showAreaLabels')}</span>
          </label>
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
            <Layers className="w-4 h-4 inline me-2" />
            {t('unified.tabAreas', { count: areas.length })}
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
            <MapPin className="w-4 h-4 inline me-2" />
            {t('unified.tabLandmarks', { count: landmarks.length })}
          </button>
          <button
            onClick={() => {
              setActiveTab('routes')
              setEditMode('idle')
              setSelectedItem(null)
            }}
            className={`flex-1 px-4 py-3 font-semibold text-sm transition-colors ${
              activeTab === 'routes'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Route className="w-4 h-4 inline me-2" />
            {t('unified.tabRoutes')}
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
                  <Layers className="w-5 h-5 me-2" />
                  {editMode === 'drawing-area' ? t('unified.drawOnMap') : t('unified.addNewArea')}
                </Button>

                {editMode === 'drawing-area' && (
                  <div className="p-3 bg-blue-50 rounded text-sm space-y-2">
                    <p className="font-semibold text-blue-900">{t('unified.drawingModeActive')}</p>
                    <div className="space-y-1 text-xs text-slate-700">
                      <p>{t('unified.drawStep1')}</p>
                      <p>{t('unified.drawStep2')}</p>
                      <p>{t('unified.drawStep3')}</p>
                      <p>{t('unified.drawStep4')}</p>
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
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">{t('unified.newBadge')}</span>
                      )}
                      {modifiedAreaIds.has(area.id) && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">{t('unified.draftBadge')}</span>
                      )}
                    </div>
                  ))}
                  {areas.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      {t('unified.noAreas')}
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
                  <MapPin className="w-5 h-5 me-2" />
                  {editMode === 'placing-landmark' ? t('unified.clickMap') : t('unified.addNewLandmark')}
                </Button>

                {editMode === 'placing-landmark' && (
                  <div className="p-3 bg-blue-50 rounded text-sm space-y-2">
                    <p className="font-semibold text-blue-900">{t('unified.placementModeActive')}</p>
                    <p className="text-xs text-slate-700">{t('unified.placeStep')}</p>
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
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">{t('unified.newBadge')}</span>
                      )}
                      {modifiedLandmarkIds.has(landmark.id) && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">{t('unified.draftBadge')}</span>
                      )}
                    </div>
                  ))}
                  {landmarks.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      {t('unified.noLandmarks')}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'routes' && (
            <RoutesSidebar
              routes={routesEditor.routes}
              selectedItem={routesEditor.selectedItem}
              editMode={routesEditor.editMode}
              onAddRoute={routesEditor.handleAddRoute}
              onAddStop={routesEditor.handleAddStop}
              onItemSelect={routesEditor.setSelectedItem}
            />
          )}
        </div>
      </div>

      {/* Edit Panel — tablet: replaces left panel (order-first), desktop: right column (order-last) */}
      {hasSelection && (
        <div className="w-64 xl:w-96 bg-white border-r xl:border-r-0 xl:border-l flex flex-col overflow-hidden order-first xl:order-last">
          {/* Header — back arrow on tablet, X on desktop */}
          <div className="p-3 xl:p-4 border-b bg-slate-50 flex items-center gap-2">
            <button
              onClick={closeSelection}
              className="xl:hidden p-1 -ms-1 hover:bg-slate-200 rounded-md transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <h3 className="font-semibold flex-1">{editTitle}</h3>
            <Button variant="ghost" size="sm" onClick={closeSelection} className="hidden xl:flex">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 xl:p-4 space-y-4">
            {/* Areas & Landmarks */}
            {selectedItem && (
              <>
                <div>
                  <Label>{t('common.nameRequired')}</Label>
                  <Input
                    value={formData.name || ''}
                    onChange={(e) => handleFormDataChange({ name: e.target.value })}
                  />
                </div>
              </>
            )}

            {/* Routes & Stops */}
            {routesEditor.selectedItem && !selectedItem && (
              <>
                <div>
                  <Label>{t('common.nameRequired')}</Label>
                  <Input
                    value={routeFormData.name || ''}
                    onChange={(e) => handleRouteFormDataChange({ name: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t('common.color')}</Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={routeFormData.color || '#3b82f6'}
                      onChange={(e) => handleRouteFormDataChange({ color: e.target.value })}
                      className="w-12 h-10 rounded cursor-pointer"
                    />
                    <Input
                      value={routeFormData.color || ''}
                      onChange={(e) => handleRouteFormDataChange({ color: e.target.value })}
                    />
                  </div>
                </div>

                {routesEditor.selectedItem.type === 'route' && (
                  <>
                    <div>
                      <Label>{t('unified.routeType')}</Label>
                      <select
                        className="w-full border rounded px-3 py-2"
                        value={routeFormData.route_type || 'metro'}
                        onChange={(e) => handleRouteFormDataChange({ route_type: e.target.value })}
                      >
                        <option value="metro">{t('unified.routeKind.metro')}</option>
                        <option value="tram">{t('unified.routeKind.tram')}</option>
                        <option value="bus">{t('unified.routeKind.bus')}</option>
                        <option value="monorail">{t('unified.routeKind.monorail')}</option>
                        <option value="ferry">{t('unified.routeKind.ferry')}</option>
                        <option value="custom">{t('unified.routeKind.custom')}</option>
                      </select>
                    </div>

                    {/* Add Stop — creates at midpoint, drag to position */}
                    <Button
                      onClick={routesEditor.handleAddStop}
                      variant="outline"
                      className="w-full"
                      size="sm"
                    >
                      <MapPin className="w-4 h-4 me-2" />
                      {t('unified.addStop')}
                    </Button>
                  </>
                )}

                <div>
                  <Label>{t('common.description')}</Label>
                  <textarea
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                    value={routeFormData.description || ''}
                    onChange={(e) => handleRouteFormDataChange({ description: e.target.value })}
                  />
                </div>
              </>
            )}

            {selectedItem?.type === 'landmark' && (
              <>
                {/* Image Upload/URL */}
                <div>
                  <Label>{t('unified.photo')}</Label>
                  <div className="space-y-2">
                    {formData.imageUrl && (
                      <div className="relative">
                        <img
                          src={formData.imageUrl}
                          alt={t('common.imagePreview')}
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
                        <Upload className="w-4 h-4 me-2" />
                        {isUploading ? t('unified.uploading') : t('unified.upload')}
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
                      placeholder={t('unified.pasteImageUrl')}
                      value={formData.imageUrl || ''}
                      onChange={(e) => handleFormDataChange({ imageUrl: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('unified.typeLabel')}</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.landmarkType || ''}
                    onChange={(e) => handleFormDataChange({ landmarkType: e.target.value })}
                  >
                    <option value="tower">{t('landmarks.kind.tower')}</option>
                    <option value="mall">{t('landmarks.kind.mall')}</option>
                    <option value="hotel">{t('landmarks.kind.hotel')}</option>
                    <option value="attraction">{t('landmarks.kind.attraction')}</option>
                    <option value="beach">{t('landmarks.kind.beach')}</option>
                    <option value="park">{t('landmarks.kind.park')}</option>
                    <option value="mosque">{t('landmarks.kind.mosque')}</option>
                    <option value="restaurant">{t('landmarks.kind.restaurant')}</option>
                    <option value="airport">{t('landmarks.kind.airport')}</option>
                    <option value="museum">{t('landmarks.kind.museum')}</option>
                  </select>
                </div>

                <div>
                  <Label>{t('unified.sizeLabel')}</Label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={formData.size || 'medium'}
                    onChange={(e) => handleFormDataChange({ size: e.target.value })}
                  >
                    <option value="small">{t('landmarks.sizeOption.small')}</option>
                    <option value="medium">{t('landmarks.sizeOption.medium')}</option>
                    <option value="large">{t('landmarks.sizeOption.large')}</option>
                  </select>
                </div>

                <div>
                  <Label>{t('landmarks.yearBuilt')}</Label>
                  <Input
                    type="number"
                    placeholder={t('unified.yearBuiltPlaceholder')}
                    value={formData.yearBuilt || ''}
                    onChange={(e) => handleFormDataChange({ yearBuilt: e.target.value ? parseInt(e.target.value) : undefined })}
                  />
                </div>

                <div>
                  <Label>{t('landmarks.websiteUrl')}</Label>
                  <Input
                    type="url"
                    placeholder="https://..."
                    value={formData.websiteUrl || ''}
                    onChange={(e) => handleFormDataChange({ websiteUrl: e.target.value })}
                  />
                </div>
              </>
            )}

            {selectedItem?.type === 'area' && (
              <div>
                <Label>{t('common.opacity', { value: `${((formData.opacity || 0.3) * 100).toFixed(0)}%` })}</Label>
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
            )}

            {/* Area/Landmark Description & Color */}
            {selectedItem && (
              <>
                <div>
                  <Label>{t('common.description')}</Label>
                  <textarea
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                    value={formData.description || ''}
                    onChange={(e) => handleFormDataChange({ description: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t('common.color')}</Label>
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
              </>
            )}
          </div>

          {/* Footer - different actions for areas/landmarks vs routes/stops */}
          {selectedItem && (
            <div className="p-3 xl:p-4 border-t bg-slate-50 flex gap-2">
              <div className="flex-1 text-xs xl:text-sm text-slate-600 flex items-center">
                <span>{t('unified.autoTracked')}</span>
              </div>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}

          {routesEditor.selectedItem && !selectedItem && (
            <div className="p-3 xl:p-4 border-t bg-slate-50 flex gap-2">
              <Button
                onClick={handleSaveRouteForm}
                disabled={routesEditor.isSaving}
                className="flex-1"
                size="sm"
              >
                <Save className="w-4 h-4 me-2" />
                {routesEditor.isSaving ? t('common.saving') : t('common.save')}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteRouteItem}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

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
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
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
            showLabels={showLabels}
            activeTab={activeTab}
          />

          {/* Routes Map Controller - only render when on routes tab */}
          {activeTab === 'routes' && (
            <RoutesMapController
              routes={routesEditor.routes}
              selectedItem={routesEditor.selectedItem}
              editMode={routesEditor.editMode}
              onRouteCreate={routesEditor.handleRouteCreate}
              onRouteUpdate={routesEditor.handleRouteUpdate}
              onStopUpdate={routesEditor.handleStopUpdate}
              onItemSelect={routesEditor.setSelectedItem}
            />
          )}
        </MapContainer>
      </div>
    </div>
  )
}
