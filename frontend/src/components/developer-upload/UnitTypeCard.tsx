/**
 * Expandable Unit Type Card Component
 * 
 * Displays unit information with expand/collapse and optional images
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ChevronDown, ChevronUp, Home, Maximize2, DollarSign, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ImageCarousel } from './ImageCarousel';

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
  suiteArea?: number;       // ⭐ 室内面积
  balconyArea?: number;
  price?: number;
  pricePerSqft?: number;
  orientation?: string;
  features?: string[];
  description?: string;     // ⭐ 户型描述
  floorPlanImage?: string;
  floorPlanImages?: string[]; // Support multiple images
}

interface UnitTypeCardProps {
  unit: UnitType;
  index: number;
  isProcessing: boolean;
  onChange: (field: string, value: any) => void;
  onRemove: () => void;
}

export function UnitTypeCard({ unit, isProcessing, onChange, onRemove }: UnitTypeCardProps) {
  const { t } = useTranslation('upload');
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
                  📍 {t('unitTypeCard.unitCount', { count: unit.unitCount })}
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
              {/* Floor Plan Images with Carousel */}
              {(unit.floorPlanImages && unit.floorPlanImages.length > 0) || unit.floorPlanImage ? (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600 font-semibold">
                    {t('unitTypeCard.floorPlan')}
                    {unit.floorPlanImages && unit.floorPlanImages.length > 1 && (
                      <span className="text-amber-600 ml-1">({t('unitTypeCard.imageCount', { count: unit.floorPlanImages.length })})</span>
                    )}
                  </Label>
                  <ImageCarousel 
                    images={unit.floorPlanImages || (unit.floorPlanImage ? [unit.floorPlanImage] : [])}
                    aspectRatio="square"
                    showThumbnails={(unit.floorPlanImages && unit.floorPlanImages.length > 1) || false}
                    maxHeight="280px"
                  />
                  <p className="text-xs text-gray-500 text-center">{t('imageCarousel.clickToEnlarge')}</p>
                </div>
              ) : null}

              {/* Basic Fields */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 font-semibold">{t('unitTypeCard.typeName')}</Label>
                  <Input
                    value={unit.typeName || ''}
                    onChange={(e) => onChange('typeName', e.target.value)}
                    disabled={isProcessing}
                    placeholder={t('unitTypeCard.typeNamePlaceholder')}
                    className="font-medium"
                  />
                  <p className="text-xs text-gray-500">{t('unitTypeCard.typeNameHint')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">{t('unitTypeCard.displayName')}</Label>
                    <Input
                      value={unit.name}
                      onChange={(e) => onChange('name', e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">{t('unitTypeCard.category')}</Label>
                    <Input
                      value={unit.category || ''}
                      onChange={(e) => onChange('category', e.target.value)}
                      disabled={isProcessing}
                      placeholder="Studio/1BR/2BR..."
                    />
                  </div>
                </div>
                
                {/* Description Field */}
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 font-semibold">{t('unitTypeCard.description')}</Label>
                  <textarea
                    value={unit.description || ''}
                    onChange={(e) => onChange('description', e.target.value)}
                    disabled={isProcessing}
                    placeholder={t('unitTypeCard.descriptionPlaceholder')}
                    className="w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-gray-50 disabled:text-gray-500 resize-y"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500">
                    {unit.description
                      ? t('unitTypeCard.charCount', { count: unit.description.length })
                      : t('unitTypeCard.descriptionHint')}
                  </p>
                </div>
              </div>

              {/* Specifications */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1">
                    <Home className="h-3 w-3" />
                    {t('unitTypeCard.bedrooms')}
                  </Label>
                  <Input
                    type="number"
                    value={unit.bedrooms || ''}
                    onChange={(e) => onChange('bedrooms', parseInt(e.target.value) || 0)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.bathrooms')}</Label>
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
                    {t('unitTypeCard.totalArea')}
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

              {/* Area Details */}
              {(unit.suiteArea || unit.balconyArea) && (
                <div className="grid grid-cols-2 gap-3">
                  {unit.suiteArea && (
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-600">{t('unitTypeCard.suiteArea')}</Label>
                      <Input
                        type="number"
                        value={unit.suiteArea || ''}
                        onChange={(e) => onChange('suiteArea', parseFloat(e.target.value) || undefined)}
                        disabled={isProcessing}
                        placeholder="sqft"
                        className="bg-blue-50"
                      />
                    </div>
                  )}
                  {unit.balconyArea && (
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-600">{t('unitTypeCard.balconyArea')}</Label>
                      <Input
                        type="number"
                        value={unit.balconyArea || ''}
                        onChange={(e) => onChange('balconyArea', parseFloat(e.target.value) || undefined)}
                        disabled={isProcessing}
                        placeholder="sqft"
                        className="bg-green-50"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Price */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600 flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {t('unitTypeCard.price')}
                  </Label>
                  <Input
                    type="number"
                    value={unit.price || ''}
                    onChange={(e) => onChange('price', parseFloat(e.target.value) || undefined)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.pricePerSqft')}</Label>
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
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.unitNumbers')}</Label>
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
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.unitQuantity')}</Label>
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
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.facing')}</Label>
                  <Input
                    value={unit.orientation}
                    onChange={(e) => onChange('orientation', e.target.value)}
                    disabled={isProcessing}
                  />
                </div>
              )}

              {unit.features && unit.features.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">{t('unitTypeCard.features')}</Label>
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
