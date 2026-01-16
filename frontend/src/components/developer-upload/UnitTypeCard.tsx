/**
 * Expandable Unit Type Card Component
 * 
 * Displays unit information with expand/collapse and optional images
 */

import { useState } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ChevronDown, ChevronUp, Home, Maximize2, DollarSign, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface UnitType {
  id: string;
  name: string;
  category?: string;
  typeName?: string;
  unitNumbers?: string[];
  unitCount?: number;
  bedrooms: number;
  bathrooms: number;
  area: number;
  price?: number;
  pricePerSqft?: number;
  orientation?: string;
  balconyArea?: number;
  features?: string[];
  floorPlanImage?: string;
}

interface UnitTypeCardProps {
  unit: UnitType;
  index: number;
  isProcessing: boolean;
  onChange: (field: string, value: any) => void;
  onRemove: () => void;
}

export function UnitTypeCard({ unit, isProcessing, onChange, onRemove }: UnitTypeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className={`overflow-hidden ${isProcessing ? 'bg-amber-50 animate-pulse' : ''}`}>
      {/* Compact Header */}
      <div 
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Home className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-gray-900 flex items-center gap-2">
                {/* Unit Type Name - Most Prominent */}
                {unit.typeName ? (
                  <>
                    <span className="text-lg text-amber-700">{unit.typeName}</span>
                    <span className="text-sm text-gray-500">({unit.category || `${unit.bedrooms}BR`})</span>
                  </>
                ) : (
                  <span>{unit.category || unit.name || `${unit.bedrooms}BR`}</span>
                )}
              </div>
              <div className="text-sm text-gray-600 mt-0.5">
                {unit.area} sqft • {unit.bedrooms}BR • {unit.bathrooms}BA
                {unit.price && ` • AED ${unit.price.toLocaleString()}`}
              </div>
              {unit.unitCount && (
                <div className="text-xs text-amber-600 mt-1 font-medium">
                  📍 {unit.unitCount} 个单元
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-700"
              disabled={isProcessing}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Expandable Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="px-4 pb-4 pt-2 border-t space-y-4">
              {/* Floor Plan Image (if available) */}
              {unit.floorPlanImage && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600">户型图</Label>
                  <div className="w-full h-64 bg-gray-100 rounded-lg overflow-hidden border">
                    <img 
                      src={unit.floorPlanImage} 
                      alt={`${unit.category} floor plan`}
                      className="w-full h-full object-contain hover:object-scale-down cursor-zoom-in"
                      onClick={() => {
                        // Open in new tab for full view
                        window.open(unit.floorPlanImage, '_blank');
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center">点击查看大图</p>
                </div>
              )}

              {/* Basic Fields */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 font-semibold">户型名称 (Unit Type)</Label>
                  <Input
                    value={unit.typeName || ''}
                    onChange={(e) => onChange('typeName', e.target.value)}
                    disabled={isProcessing}
                    placeholder="例如: B-2BM-A.1, Type-A-1B-A.1"
                    className="font-medium"
                  />
                  <p className="text-xs text-gray-500">PDF 中的准确户型编号</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">显示名称</Label>
                    <Input
                      value={unit.name}
                      onChange={(e) => onChange('name', e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">类别</Label>
                    <Input
                      value={unit.category || ''}
                      onChange={(e) => onChange('category', e.target.value)}
                      disabled={isProcessing}
                      placeholder="Studio/1BR/2BR..."
                    />
                  </div>
                </div>
              </div>

              {/* Specifications */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1">
                    <Home className="h-3 w-3" />
                    卧室
                  </Label>
                  <Input
                    type="number"
                    value={unit.bedrooms || ''}
                    onChange={(e) => onChange('bedrooms', parseInt(e.target.value) || 0)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">浴室</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={unit.bathrooms || ''}
                    onChange={(e) => onChange('bathrooms', parseFloat(e.target.value) || 0)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1">
                    <Maximize2 className="h-3 w-3" />
                    面积
                  </Label>
                  <Input
                    type="number"
                    value={unit.area || ''}
                    onChange={(e) => onChange('area', parseFloat(e.target.value) || 0)}
                    disabled={isProcessing}
                    placeholder="sqft"
                  />
                </div>
              </div>

              {/* Price */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    价格 (AED)
                  </Label>
                  <Input
                    type="number"
                    value={unit.price || ''}
                    onChange={(e) => onChange('price', parseFloat(e.target.value) || undefined)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">单价/sqft</Label>
                  <Input
                    type="number"
                    value={unit.pricePerSqft || (unit.price && unit.area ? Math.round(unit.price / unit.area) : '')}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
              </div>

              {/* Optional Fields */}
              {(unit.unitNumbers && unit.unitNumbers.length > 0) && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">单元号</Label>
                  <div className="flex flex-wrap gap-1">
                    {unit.unitNumbers.map((num, idx) => (
                      <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        {num}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {unit.unitCount && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">单元数量</Label>
                  <Input
                    type="number"
                    value={unit.unitCount}
                    onChange={(e) => onChange('unitCount', parseInt(e.target.value) || 0)}
                    disabled={isProcessing}
                  />
                </div>
              )}

              {unit.orientation && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">朝向</Label>
                  <Input
                    value={unit.orientation}
                    onChange={(e) => onChange('orientation', e.target.value)}
                    disabled={isProcessing}
                  />
                </div>
              )}

              {unit.features && unit.features.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">特色</Label>
                  <div className="flex flex-wrap gap-1">
                    {unit.features.map((feature, idx) => (
                      <span key={idx} className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
