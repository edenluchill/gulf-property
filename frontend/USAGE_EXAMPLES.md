# 前端使用示例 - Dubai Off-Plan Properties API

## 🎯 概述

本文档展示如何在React组件中使用新的Dubai期房数据API。

## 📦 可用的工具

### 1. API客户端 (`lib/api.ts`)
直接调用API的函数

### 2. React Hooks (`hooks/useProperties.ts`)
简化数据获取的自定义Hooks

### 3. TypeScript类型 (`types/index.ts`)
完整的类型定义

## 🚀 使用示例

### 示例 1: 地图视图组件

```typescript
import { useState } from 'react';
import { useMapProperties } from '../hooks/useProperties';
import { MapBounds, PropertyFilters } from '../types';

function MapView() {
  // 地图边界（用户当前查看的区域）
  const [bounds, setBounds] = useState<MapBounds>({
    minLng: 55.1,
    minLat: 25.0,
    maxLng: 55.4,
    maxLat: 25.3,
  });

  // 过滤条件
  const [filters, setFilters] = useState<PropertyFilters>({
    minPrice: 1000000,
    maxPrice: 5000000,
    minBedrooms: 2,
  });

  // 使用Hook获取数据
  const { properties, loading, error } = useMapProperties(bounds, filters);

  if (loading) return <div>加载中...</div>;
  if (error) return <div>错误: {error}</div>;

  return (
    <div>
      <h2>找到 {properties.length} 个房源</h2>
      {properties.map(property => (
        <MapMarker
          key={property.id}
          lat={property.location.lat}
          lng={property.location.lng}
          property={property}
        />
      ))}
    </div>
  );
}
```

### 示例 2: 房源列表页面

```typescript
import { useState } from 'react';
import { useProperties } from '../hooks/useProperties';
import { PropertyFilters } from '../types';

function PropertyListPage() {
  const [filters, setFilters] = useState<PropertyFilters>({
    developer: 'DAMAC',
    area: 'Dubai Marina',
    minPrice: 1000000,
    maxPrice: 3000000,
    limit: 20,
    offset: 0,
  });

  const { properties, total, loading } = useProperties(filters);

  return (
    <div>
      <h1>Dubai Marina - DAMAC 房源</h1>
      <p>共找到 {total} 个房源</p>
      
      {loading ? (
        <div>加载中...</div>
      ) : (
        <div className="grid">
          {properties.map(property => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      )}

      <Pagination
        current={filters.offset! / filters.limit!}
        total={total}
        pageSize={filters.limit!}
        onChange={(page) => {
          setFilters({
            ...filters,
            offset: page * filters.limit!,
          });
        }}
      />
    </div>
  );
}
```

### 示例 3: 房源详情页

```typescript
import { useParams } from 'react-router-dom';
import { useProperty } from '../hooks/useProperties';

function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { property, loading, error } = useProperty(id);

  if (loading) return <div>加载中...</div>;
  if (error) return <div>未找到房源</div>;
  if (!property) return <div>房源不存在</div>;

  return (
    <div>
      <h1>{property.buildingName}</h1>
      <h2>{property.projectName}</h2>
      
      <div className="details">
        <p>开发商: {property.developer}</p>
        <p>区域: {property.areaName}</p>
        <p>起价: AED {property.startingPrice?.toLocaleString()}</p>
        <p>户型: {property.minBedrooms} - {property.maxBedrooms} 卧室</p>
        <p>完工进度: {property.completionPercent}%</p>
        <p>状态: {property.status}</p>
      </div>

      <div className="images">
        {property.images.map((img, idx) => (
          <img key={idx} src={img} alt={property.buildingName} />
        ))}
      </div>

      <div className="amenities">
        <h3>配套设施</h3>
        {property.amenities.map((amenity, idx) => (
          <span key={idx} className="badge">{amenity}</span>
        ))}
      </div>
    </div>
  );
}
```

### 示例 4: 高级过滤器组件

```typescript
import { useState } from 'react';
import { PropertyFilters } from '../types';
import { fetchDevelopers, fetchAreas } from '../lib/api';

function AdvancedFilters({ onFilterChange }: { onFilterChange: (filters: PropertyFilters) => void }) {
  const [developers, setDevelopers] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  
  const [localFilters, setLocalFilters] = useState<PropertyFilters>({});

  // 加载选项
  useEffect(() => {
    fetchDevelopers().then(devs => 
      setDevelopers(devs.map(d => d.developer))
    );
    fetchAreas().then(areas => 
      setAreas(areas.map(a => a.area_name))
    );
  }, []);

  const handleApply = () => {
    onFilterChange(localFilters);
  };

  return (
    <div className="filters">
      {/* 价格范围 */}
      <div>
        <label>价格范围</label>
        <input
          type="number"
          placeholder="最低价"
          onChange={(e) => setLocalFilters({
            ...localFilters,
            minPrice: Number(e.target.value)
          })}
        />
        <input
          type="number"
          placeholder="最高价"
          onChange={(e) => setLocalFilters({
            ...localFilters,
            maxPrice: Number(e.target.value)
          })}
        />
      </div>

      {/* 卧室数量 */}
      <div>
        <label>卧室数量</label>
        <select
          onChange={(e) => setLocalFilters({
            ...localFilters,
            minBedrooms: Number(e.target.value)
          })}
        >
          <option value="">任意</option>
          <option value="0">Studio</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
        </select>
      </div>

      {/* 开发商 */}
      <div>
        <label>开发商</label>
        <select
          onChange={(e) => setLocalFilters({
            ...localFilters,
            developer: e.target.value
          })}
        >
          <option value="">全部</option>
          {developers.map(dev => (
            <option key={dev} value={dev}>{dev}</option>
          ))}
        </select>
      </div>

      {/* 区域 */}
      <div>
        <label>区域</label>
        <select
          onChange={(e) => setLocalFilters({
            ...localFilters,
            area: e.target.value
          })}
        >
          <option value="">全部</option>
          {areas.map(area => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
      </div>

      {/* 项目状态 */}
      <div>
        <label>项目状态</label>
        <select
          onChange={(e) => setLocalFilters({
            ...localFilters,
            status: e.target.value as any
          })}
        >
          <option value="">全部</option>
          <option value="upcoming">即将开盘</option>
          <option value="under-construction">建设中</option>
          <option value="completed">已完工</option>
        </select>
      </div>

      <button onClick={handleApply}>应用过滤</button>
    </div>
  );
}
```

### 示例 5: 统计仪表板

```typescript
import { useEffect, useState } from 'react';
import { fetchStats, fetchAreas } from '../lib/api';

function StatsDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [topAreas, setTopAreas] = useState<any[]>([]);

  useEffect(() => {
    // 加载全局统计
    fetchStats().then(setStats);
    
    // 加载热门区域
    fetchAreas().then(areas => {
      const sorted = areas.sort((a, b) => b.property_count - a.property_count);
      setTopAreas(sorted.slice(0, 10));
    });
  }, []);

  if (!stats) return <div>加载中...</div>;

  return (
    <div className="dashboard">
      <h1>Dubai 期房市场概览</h1>
      
      <div className="stats-grid">
        <StatCard
          title="总房源"
          value={stats.total_properties.toLocaleString()}
          icon="🏢"
        />
        <StatCard
          title="开发商"
          value={stats.total_developers.toLocaleString()}
          icon="🏗️"
        />
        <StatCard
          title="区域覆盖"
          value={stats.total_areas.toLocaleString()}
          icon="📍"
        />
        <StatCard
          title="平均价格"
          value={`AED ${stats.avg_price.toLocaleString()}`}
          icon="💰"
        />
      </div>

      <div className="status-breakdown">
        <h2>项目状态分布</h2>
        <PieChart data={[
          { name: '即将开盘', value: stats.upcoming_count },
          { name: '建设中', value: stats.under_construction_count },
          { name: '已完工', value: stats.completed_count },
        ]} />
      </div>

      <div className="top-areas">
        <h2>热门区域 Top 10</h2>
        <table>
          <thead>
            <tr>
              <th>区域</th>
              <th>房源数量</th>
              <th>平均价格</th>
              <th>价格范围</th>
            </tr>
          </thead>
          <tbody>
            {topAreas.map(area => (
              <tr key={area.area_name}>
                <td>{area.area_name}</td>
                <td>{area.property_count}</td>
                <td>AED {Math.round(area.avg_price).toLocaleString()}</td>
                <td>
                  {Math.round(area.min_price).toLocaleString()} - 
                  {Math.round(area.max_price).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### 示例 6: 搜索功能

```typescript
import { useState, useEffect } from 'react';
import { useProperties } from '../hooks/useProperties';
import { PropertyFilters } from '../types';

function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<PropertyFilters>({
    searchQuery: '',
    limit: 20,
  });

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({ ...filters, searchQuery });
    }, 500); // 500ms延迟

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { properties, total, loading } = useProperties(filters);

  return (
    <div>
      <input
        type="text"
        placeholder="搜索项目、开发商、区域..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="search-input"
      />

      {loading ? (
        <div>搜索中...</div>
      ) : (
        <div>
          <p>找到 {total} 个结果</p>
          {properties.map(property => (
            <SearchResult key={property.id} property={property} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 示例 7: 地图事件处理

```typescript
import { useState, useCallback } from 'react';
import { useMapProperties } from '../hooks/useProperties';
import { MapBounds } from '../types';

function InteractiveMap() {
  const [bounds, setBounds] = useState<MapBounds>({
    minLng: 55.1,
    minLat: 25.0,
    maxLng: 55.4,
    maxLat: 25.3,
  });

  const { properties, loading } = useMapProperties(bounds);

  // 地图移动时更新边界
  const handleMapMove = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  // 点击标记时显示详情
  const handleMarkerClick = useCallback((propertyId: string) => {
    // 导航到详情页或显示弹窗
    window.location.href = `/properties/${propertyId}`;
  }, []);

  return (
    <div className="map-container">
      {loading && <div className="loading-overlay">加载中...</div>}
      
      <Map
        bounds={bounds}
        onBoundsChange={handleMapMove}
      >
        {properties.map(property => (
          <Marker
            key={property.id}
            position={[property.location.lat, property.location.lng]}
            onClick={() => handleMarkerClick(property.id)}
          >
            <Popup>
              <h4>{property.buildingName}</h4>
              <p>{property.areaName}</p>
              <p>AED {property.startingPrice?.toLocaleString()}</p>
            </Popup>
          </Marker>
        ))}
      </Map>

      <div className="map-overlay">
        <p>{properties.length} 个房源在此区域</p>
      </div>
    </div>
  );
}
```

## 🎨 实用工具函数

### 价格格式化

```typescript
export function formatPrice(price: number | undefined): string {
  if (!price) return 'N/A';
  return `AED ${price.toLocaleString()}`;
}

export function formatPriceShort(price: number | undefined): string {
  if (!price) return 'N/A';
  if (price >= 1000000) {
    return `AED ${(price / 1000000).toFixed(1)}M`;
  }
  return `AED ${(price / 1000).toFixed(0)}K`;
}
```

### 状态显示

```typescript
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'upcoming': '即将开盘',
    'under-construction': '建设中',
    'completed': '已完工',
  };
  return labels[status] || status;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    'upcoming': 'blue',
    'under-construction': 'orange',
    'completed': 'green',
  };
  return colors[status] || 'gray';
}
```

### 卧室显示

```typescript
export function getBedroomLabel(min: number, max: number): string {
  if (min === 0 && max === 0) return 'Studio';
  if (min === max) return `${min} 卧室`;
  return `${min}-${max} 卧室`;
}
```

## 📱 响应式设计示例

```typescript
import { useMediaQuery } from './hooks/useMediaQuery';

function ResponsivePropertyGrid() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { properties, loading } = useProperties({ limit: 20 });

  if (loading) return <Skeleton />;

  return (
    <div className={isMobile ? 'grid-mobile' : 'grid-desktop'}>
      {properties.map(property => (
        <PropertyCard
          key={property.id}
          property={property}
          compact={isMobile}
        />
      ))}
    </div>
  );
}
```

## 🔄 实时更新示例

```typescript
import { useEffect } from 'react';

function LivePropertyFeed() {
  const { properties, refetch } = useProperties({ limit: 10 });

  // 每30秒刷新一次
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);

    return () => clearInterval(interval);
  }, [refetch]);

  return (
    <div>
      <h2>最新房源</h2>
      {properties.map(property => (
        <PropertyItem key={property.id} property={property} />
      ))}
    </div>
  );
}
```

## 🎯 最佳实践

### 1. 使用Hooks而不是直接API调用
```typescript
// ✅ 好
const { properties, loading } = useMapProperties(bounds);

// ❌ 避免
const [properties, setProperties] = useState([]);
useEffect(() => {
  fetchPropertiesForMap(bounds).then(setProperties);
}, [bounds]);
```

### 2. 正确处理加载和错误状态
```typescript
const { properties, loading, error } = useProperties(filters);

if (loading) return <Spinner />;
if (error) return <ErrorMessage message={error} />;
if (properties.length === 0) return <EmptyState />;

return <PropertyList properties={properties} />;
```

### 3. 优化地图性能
```typescript
// 使用防抖避免频繁请求
const debouncedBounds = useDebounce(bounds, 300);
const { properties } = useMapProperties(debouncedBounds);
```

### 4. 类型安全
```typescript
// 总是使用TypeScript类型
import { OffPlanProperty, PropertyFilters } from '../types';

function MyComponent() {
  const [filters, setFilters] = useState<PropertyFilters>({});
  const handlePropertyClick = (property: OffPlanProperty) => {
    // TypeScript会提供自动完成
    console.log(property.buildingName);
  };
}
```

## 📚 更多资源

- API文档: `backend/src/routes/properties.ts`
- 类型定义: `frontend/src/types/index.ts`
- Hooks源码: `frontend/src/hooks/useProperties.ts`
- 完整示例: 查看现有页面组件

---

这些示例应该能帮你快速上手使用新的Dubai期房数据API！
