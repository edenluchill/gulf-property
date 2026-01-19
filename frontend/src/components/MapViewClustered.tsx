import { useEffect, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, Polygon, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { DubaiArea, DubaiLandmark } from '../types'

// Helper function to format price in short form (K, M)
const formatPriceShort = (price: number): string => {
  if (price >= 1000000) {
    const millions = price / 1000000
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}M`
  } else if (price >= 1000) {
    const thousands = price / 1000
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`
  }
  return price.toString()
}

// Create custom cluster icon (blue-900 style) with animation
const createClusterIcon = (cluster: any) => {
  const { count, price_range } = cluster
  
  const priceRange = price_range.min && price_range.max 
    ? `${formatPriceShort(price_range.min)} - ${formatPriceShort(price_range.max)}`
    : 'POA'

  return L.divIcon({
    html: `
      <style>
        @keyframes pinDrop {
          0% {
            transform: translateY(-100px) scale(0.5);
            opacity: 0;
          }
          50% {
            transform: translateY(5px) scale(1.05);
          }
          70% {
            transform: translateY(-3px) scale(0.95);
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.2;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.3;
          }
        }
        .pin-animate {
          animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .pin-pulse {
          animation: pulse 2s ease-in-out infinite;
        }
      </style>
      <div class="relative inline-flex items-center justify-center pin-animate">
        <div class="absolute inset-0 bg-blue-900 opacity-20 rounded-full blur-md pin-pulse"></div>
        <div class="relative hover:scale-110 transition-all">
          <div class="bg-blue-900 text-white rounded-full px-3 py-1.5 shadow-xl border border-blue-700 cursor-pointer">
            <div class="flex items-center gap-1.5 whitespace-nowrap">
              <span class="text-sm font-bold">${count}</span>
              <span class="text-blue-300 text-xs">|</span>
              <span class="text-xs font-medium">${priceRange}</span>
            </div>
          </div>
          <!-- Small arrow pointing down -->
          <div class="absolute left-1/2 -translate-x-1/2" style="
            bottom: -5px;
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid #1e3a8a;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          "></div>
        </div>
      </div>
    `,
    className: 'custom-cluster-icon',
    iconSize: L.point(120, 40, true),
    iconAnchor: [60, 40],
  })
}

interface MapViewClusteredProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onClusterClick?: (cluster: any) => void
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  showDubaiLayer?: boolean
}

interface MapControllerProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
}

function MapController({ onBoundsChange }: MapControllerProps) {
  const map = useMap()

  // Listen for map movement to update bounds with throttling
  useEffect(() => {
    if (!onBoundsChange) return

    let timeoutId: number | null = null

    const handleMoveEnd = () => {
      // Clear any pending timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Throttle the bounds update to reduce API calls
      timeoutId = setTimeout(() => {
        const bounds = map.getBounds()
        const zoom = map.getZoom()
        onBoundsChange({
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        }, zoom)
      }, 200) // Wait 200ms after user stops moving
    }

    map.on('moveend', handleMoveEnd)
    map.on('zoomend', handleMoveEnd)
    
    // Initial call after event listeners are set up
    setTimeout(() => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, zoom)
    }, 100)
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      map.off('moveend', handleMoveEnd)
      map.off('zoomend', handleMoveEnd)
    }
  }, [map]) // Remove onBoundsChange from dependencies to prevent infinite loop

  return null
}

function MapViewClustered({ clusters, onBoundsChange, onClusterClick, dubaiAreas = [], dubaiLandmarks = [], showDubaiLayer = false }: MapViewClusteredProps) {
  // 调试信息
  console.log('🗺️ MapViewClustered render:', {
    showDubaiLayer,
    dubaiAreasCount: dubaiAreas.length,
    dubaiLandmarksCount: dubaiLandmarks.length,
    clustersCount: clusters.length
  })
  
  // Memoize cluster markers to prevent unnecessary re-renders
  const clusterMarkers = useMemo(() => {
    return clusters.map((cluster) => ({
      cluster,
      icon: createClusterIcon(cluster),
      position: [cluster.center.lat, cluster.center.lng] as [number, number]
    }))
  }, [clusters])

  // 地标照片映射 - 优先使用数据库中的图片，否则使用默认图片
  const getImageForLandmark = (landmark: DubaiLandmark): string => {
    // 1. 如果数据库有图片URL，直接使用
    if (landmark.imageUrl) {
      return landmark.imageUrl
    }
    
    // 2. 否则使用地标名称映射
    const landmarkImages: Record<string, string> = {
      'Burj Khalifa': 'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=400&h=400&fit=crop',
      'Burj Al Arab': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&h=400&fit=crop',
      'Dubai Mall': 'https://images.unsplash.com/photo-1567449303183-3e2e3e8ae753?w=400&h=400&fit=crop',
      'Dubai Marina': 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=400&h=400&fit=crop',
      'Palm Jumeirah': 'https://images.unsplash.com/photo-1580674285054-bed31e145f59?w=400&h=400&fit=crop',
      'Dubai Creek': 'https://images.unsplash.com/photo-1546412414-e1885259563a?w=400&h=400&fit=crop',
      'Gold Souk': 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=400&fit=crop',
      'Jumeirah Beach': 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=400&fit=crop',
    }
    
    if (landmarkImages[landmark.name]) {
      return landmarkImages[landmark.name]
    }
    
    // 3. 最后根据类型返回通用照片
    const typeImages: Record<string, string> = {
      'tower': 'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5?w=400&h=400&fit=crop',
      'building': 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&h=400&fit=crop',
      'mall': 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=400&fit=crop',
      'beach': 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=400&fit=crop',
      'mosque': 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=400&h=400&fit=crop',
      'hotel': 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=400&fit=crop',
      'park': 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=400&h=400&fit=crop',
      'default': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&h=400&fit=crop'
    }
    
    return typeImages[landmark.landmarkType] || typeImages.default
  }

  // Memoize Dubai landmark icons - 大尺寸照片pin设计
  const landmarkIcons = useMemo(() => {
    if (!Array.isArray(dubaiLandmarks)) return []
    return dubaiLandmarks.map((landmark) => {
      const sizeMap = { small: [70, 90], medium: [80, 100], large: [90, 110] }
      const size = sizeMap[landmark.size] || [80, 100]
      const imageUrl = getImageForLandmark(landmark)
      
      return {
        landmark,
        icon: L.divIcon({
          html: `
            <style>
              @keyframes pinDrop {
                0% {
                  transform: translateY(-100px) scale(0.5);
                  opacity: 0;
                }
                60% {
                  transform: translateY(5px) scale(1.05);
                }
                80% {
                  transform: translateY(-2px) scale(0.95);
                }
                100% {
                  transform: translateY(0) scale(1);
                  opacity: 1;
                }
              }
              .photo-pin-${landmark.id} {
                animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
              }
              .photo-pin-${landmark.id}:hover {
                transform: scale(1.1);
                transition: transform 0.2s ease;
              }
            </style>
            <div class="photo-pin-${landmark.id}" style="width: ${size[0]}px; height: ${size[1]}px; position: relative;">
              <!-- 底部阴影 -->
              <div style="
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: ${size[0] * 0.5}px;
                height: ${size[0] * 0.2}px;
                background: rgba(0, 0, 0, 0.35);
                border-radius: 50%;
                filter: blur(4px);
              "></div>
              
              <!-- Pin SVG - 正确的水滴方向（尖端朝下） -->
              <svg width="${size[0]}" height="${size[1]}" viewBox="0 0 80 100" style="filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3));">
                <defs>
                  <!-- 照片裁剪路径 -->
                  <clipPath id="pin-clip-${landmark.id}">
                    <circle cx="40" cy="35" r="28"/>
                  </clipPath>
                  
                  <!-- 渐变边框 -->
                  <linearGradient id="pin-border-${landmark.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#e0e0e0;stop-opacity:1" />
                  </linearGradient>
                </defs>
                
                <!-- 外部白色边框 -->
                <path d="M40 95 L40 95 C40 95, 40 70, 40 70 C40 70, 20 70, 12 58 C4 46, 4 35, 12 23 C20 11, 32 5, 40 5 C48 5, 60 11, 68 23 C76 35, 76 46, 68 58 C60 70, 40 70, 40 70 Z" 
                      fill="url(#pin-border-${landmark.id})" 
                      stroke="#d0d0d0" 
                      stroke-width="1"/>
                
                <!-- 照片区域 -->
                <image 
                  href="${imageUrl}" 
                  x="12" 
                  y="7" 
                  width="56" 
                  height="56" 
                  clip-path="url(#pin-clip-${landmark.id})"
                  preserveAspectRatio="xMidYMid slice"
                />
                
                <!-- 内圈边框 -->
                <circle cx="40" cy="35" r="28" 
                        fill="none" 
                        stroke="white" 
                        stroke-width="3"
                        opacity="0.9"/>
              </svg>
            </div>
          `,
          className: 'custom-landmark-icon',
          iconSize: L.point(size[0], size[1]),
          iconAnchor: [size[0] / 2, size[1] - 2],
        }),
        position: [landmark.location.lat, landmark.location.lng] as [number, number]
      }
    })
  }, [dubaiLandmarks])

  return (
    <MapContainer
      center={[25.0961, 55.1561]}
      zoom={11}
      className="h-full w-full rounded-lg overflow-hidden shadow-lg"
    >
      {/* 使用 Carto 的英文地图瓦片 - 清晰现代的设计 */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={20}
      />
      <MapController clusters={clusters} onBoundsChange={onBoundsChange} />
      
      {/* Render Dubai areas as polygons (if layer is enabled) - 现代化样式 */}
      {showDubaiLayer && Array.isArray(dubaiAreas) && dubaiAreas.map((area) => {
        // Convert GeoJSON coordinates to Leaflet format
        const coordinates = area.boundary?.type === 'Polygon' 
          ? (area.boundary as any).coordinates[0].map(([lng, lat]: [number, number]) => [lat, lng] as [number, number])
          : []
        
        if (coordinates.length === 0) {
          console.warn('⚠️ Area has no valid boundary:', area.name, area)
          return null
        }
        
        console.log('✅ Rendering area:', area.name, 'with', coordinates.length, 'points')
        
        return (
          <Polygon
            key={area.id}
            positions={coordinates}
            pathOptions={{
              color: area.color,
              fillColor: area.color,
              fillOpacity: area.opacity * 0.6, // 稍微降低不透明度，更柔和
              weight: 3,
              opacity: 0.8,
              dashArray: '5, 10', // 虚线边框，更现代
              lineCap: 'round',
              lineJoin: 'round',
            }}
            // 添加交互效果
            eventHandlers={{
              mouseover: (e) => {
                const layer = e.target
                layer.setStyle({
                  weight: 4,
                  fillOpacity: area.opacity * 1.2,
                  dashArray: '10, 5',
                })
              },
              mouseout: (e) => {
                const layer = e.target
                layer.setStyle({
                  weight: 3,
                  fillOpacity: area.opacity * 0.6,
                  dashArray: '5, 10',
                })
              },
            }}
          >
            <Popup>
              <div className="p-3 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <div 
                    className="w-4 h-4 rounded-full" 
                    style={{ backgroundColor: area.color }}
                  ></div>
                  <h3 className="font-bold text-lg text-slate-900">{area.name}</h3>
                </div>
                
                {area.description && (
                  <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                    {area.description}
                  </p>
                )}
                
                <div className="flex flex-wrap gap-2">
                  {area.areaType && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                      📍 {area.areaType}
                    </span>
                  )}
                  {area.wealthLevel && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      💎 {area.wealthLevel}
                    </span>
                  )}
                  {area.culturalAttribute && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      🏛️ {area.culturalAttribute}
                    </span>
                  )}
                </div>
              </div>
            </Popup>
          </Polygon>
        )
      })}

      {/* Render Dubai landmarks as markers (if layer is enabled) - 照片pin */}
      {showDubaiLayer && landmarkIcons.map(({ landmark, icon, position }) => (
        <Marker
          key={landmark.id}
          position={position}
          icon={icon}
        >
          <Popup maxWidth={300}>
            <div className="p-0 min-w-[280px]">
              {/* 顶部大图 */}
              <div className="w-full h-40 overflow-hidden rounded-t-lg">
                <img 
                  src={getImageForLandmark(landmark)}
                  alt={landmark.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 如果图片加载失败，使用默认背景色
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.style.background = landmark.color;
                  }}
                />
              </div>
              
              {/* 内容区域 */}
              <div className="p-4">
                <h3 className="font-bold text-xl text-slate-900 mb-2">{landmark.name}</h3>
                
                {landmark.landmarkType && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium mb-3"
                        style={{ 
                          backgroundColor: `${landmark.color}20`,
                          color: landmark.color 
                        }}>
                    {landmark.landmarkType}
                  </span>
                )}
                
                {landmark.description && (
                  <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                    {landmark.description}
                  </p>
                )}
                
                {landmark.yearBuilt && (
                  <div className="text-xs text-slate-500 pt-3 border-t border-slate-200">
                    Built in {landmark.yearBuilt}
                  </div>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
      
      {/* Render cluster markers */}
      {clusterMarkers.map(({ cluster, icon, position }) => (
        <Marker
          key={cluster.cluster_id}
          position={position}
          icon={icon}
          eventHandlers={{
            click: (e) => {
              // Prevent popup from opening
              e.target.closePopup()
              if (onClusterClick) {
                onClusterClick(cluster)
              }
            }
          }}
        />
      ))}
    </MapContainer>
  )
}

// Export memoized component to prevent unnecessary re-renders
export default memo(MapViewClustered)
