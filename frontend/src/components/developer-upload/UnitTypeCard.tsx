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
  renderingImages?: string[];  // ⭐ 户型外观效果图
  interiorImages?: string[];   // ⭐ 户型室内效果图
  balconyImages?: string[];    // ⭐ 阳台/露台图
  parkingSpaces?: number;   // ⭐ 车位配比（楼书文本层库存表）
}

interface UnitTypeCardProps {
  unit: UnitType;
  index: number;
  isProcessing: boolean;
  onChange: (field: string, value: any) => void;
  onRemove: () => void;
  /** 项目图库候选图（用于手动把误归类的图移进户型） */
  galleryImages?: string[];
  /** 从项目图库移除一张图（移入户型时调用，实现"移动"语义） */
  onTakeImageFromGallery?: (img: string) => void;
  /** 把一张图退回项目图库（从户型移除时调用） */
  onReturnImageToGallery?: (img: string) => void;
}

export function UnitTypeCard({
  unit,
  isProcessing,
  onChange,
  onRemove,
  galleryImages,
  onTakeImageFromGallery,
  onReturnImageToGallery,
}: UnitTypeCardProps) {
  const { t } = useTranslation('upload');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'photo' | 'floorplan'>('photo');

  const unitPhotos = [
    ...(unit.renderingImages || []),
    ...(unit.interiorImages || []),
    ...(unit.balconyImages || []),
  ];
  const floorPlans = unit.floorPlanImages || (unit.floorPlanImage ? [unit.floorPlanImage] : []);

  // 图库候选：排除已在本户型的图
  const pickerCandidates = (galleryImages || []).filter(
    img => !unitPhotos.includes(img) && !floorPlans.includes(img)
  );

  const addImageToUnit = (img: string) => {
    if (pickerTarget === 'floorplan') {
      onChange('floorPlanImages', [...floorPlans, img]);
    } else {
      onChange('renderingImages', [...(unit.renderingImages || []), img]);
    }
    onTakeImageFromGallery?.(img);
  };

  const removePhotoFromUnit = (img: string) => {
    if ((unit.renderingImages || []).includes(img)) {
      onChange('renderingImages', (unit.renderingImages || []).filter(i => i !== img));
    } else if ((unit.interiorImages || []).includes(img)) {
      onChange('interiorImages', (unit.interiorImages || []).filter(i => i !== img));
    } else if ((unit.balconyImages || []).includes(img)) {
      onChange('balconyImages', (unit.balconyImages || []).filter(i => i !== img));
    }
    onReturnImageToGallery?.(img);
  };

  const removeFloorPlanFromUnit = (img: string) => {
    const next = floorPlans.filter(i => i !== img);
    onChange('floorPlanImages', next);
    if (unit.floorPlanImage === img) {
      onChange('floorPlanImage', next[0] || '');
    }
    onReturnImageToGallery?.(img);
  };

  return (
    <Card className={`overflow-hidden ${isProcessing ? 'bg-teal-50 animate-pulse' : ''}`}>
      {/* Compact Header */}
      <div 
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center">
              <Home className="h-5 w-5 text-teal-600" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-gray-900 flex items-center gap-2">
                {/* Unit Type Name - Most Prominent */}
                {unit.typeName ? (
                  <>
                    <span className="text-lg text-teal-700">{unit.typeName}</span>
                    <span className="text-sm text-gray-500">({unit.category || `${unit.bedrooms}BR`})</span>
                  </>
                ) : (
                  <span>{unit.category || unit.name || `${unit.bedrooms}BR`}</span>
                )}
              </div>
              <div className="text-sm text-gray-600 mt-0.5">
                {unit.area} sqft • {unit.bedrooms}BR • {unit.bathrooms}BA
                {unit.price && ` • AED ${unit.price.toLocaleString()}`}
                {unit.parkingSpaces != null && ` • 🚗 ${unit.parkingSpaces}`}
              </div>
              {unit.unitCount && (
                <div className="text-xs text-teal-600 mt-1 font-medium">
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
            <div className="px-4 pb-4 pt-2 border-t space-y-4" onClick={(e) => e.stopPropagation()}>
              {/* Floor Plan Images with Carousel */}
              {(unit.floorPlanImages && unit.floorPlanImages.length > 0) || unit.floorPlanImage ? (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600 font-semibold">
                    {t('unitTypeCard.floorPlan')}
                    {unit.floorPlanImages && unit.floorPlanImages.length > 1 && (
                      <span className="text-teal-600 ms-1">({t('unitTypeCard.imageCount', { count: unit.floorPlanImages.length })})</span>
                    )}
                  </Label>
                  <ImageCarousel
                    images={unit.floorPlanImages || (unit.floorPlanImage ? [unit.floorPlanImage] : [])}
                    aspectRatio="square"
                    showThumbnails={(unit.floorPlanImages && unit.floorPlanImages.length > 1) || false}
                    maxHeight="280px"
                  />
                  <p className="text-xs text-gray-500 text-center">{t('imageCarousel.clickToEnlarge')}</p>

                  {/* 管理条：移除误归类的图（退回图库）/ 从图库补图 */}
                  {!isProcessing && (
                    <div className="flex flex-wrap gap-2">
                      {floorPlans.map(img => (
                        <div key={img} className="relative group">
                          <img src={img} className="h-14 w-20 object-cover rounded border" />
                          <button
                            type="button"
                            onClick={() => removeFloorPlanFromUnit(img)}
                            className="absolute -top-1.5 -end-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs shadow"
                            title={t('unitTypeCard.removeToGallery', { defaultValue: 'Remove (back to gallery)' })}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {pickerCandidates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setPickerTarget('floorplan'); setShowPicker(v => !v || pickerTarget !== 'floorplan'); }}
                          className="h-14 w-20 rounded border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 text-xl"
                          title={t('unitTypeCard.addFromGallery', { defaultValue: 'Add from gallery' })}
                        >
                          +
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {/* Unit Renderings (exterior + interior + balcony) */}
              {(unitPhotos.length > 0 || (!isProcessing && pickerCandidates.length > 0)) && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600 font-semibold">
                    {t('unitTypeCard.unitPhotos', { defaultValue: 'Unit Photos' })}
                    {unitPhotos.length > 0 && (
                      <span className="text-teal-600 ms-1">({t('unitTypeCard.imageCount', { count: unitPhotos.length })})</span>
                    )}
                  </Label>
                  {unitPhotos.length > 0 && (
                    <ImageCarousel
                      images={unitPhotos}
                      aspectRatio="video"
                      showThumbnails={unitPhotos.length > 1}
                      maxHeight="280px"
                    />
                  )}

                  {/* 管理条：每张图可移除（退回项目图库），"+"从图库移入 */}
                  {!isProcessing && (
                    <div className="flex flex-wrap gap-2">
                      {unitPhotos.map(img => (
                        <div key={img} className="relative group">
                          <img src={img} className="h-14 w-20 object-cover rounded border" />
                          <button
                            type="button"
                            onClick={() => removePhotoFromUnit(img)}
                            className="absolute -top-1.5 -end-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs shadow"
                            title={t('unitTypeCard.removeToGallery', { defaultValue: 'Remove (back to gallery)' })}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {pickerCandidates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setPickerTarget('photo'); setShowPicker(v => !v || pickerTarget !== 'photo'); }}
                          className="h-14 w-20 rounded border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 text-xl"
                          title={t('unitTypeCard.addFromGallery', { defaultValue: 'Add from gallery' })}
                        >
                          +
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 图库选择器（移入户型） */}
              {showPicker && pickerCandidates.length > 0 && (
                <div className="space-y-2 p-3 bg-teal-50/60 rounded-lg border border-teal-200">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-teal-800">
                      {t('unitTypeCard.pickFromGallery', { defaultValue: 'Pick images to move into this unit' })}
                      {pickerTarget === 'floorplan' && ` → ${t('unitTypeCard.floorPlan')}`}
                    </Label>
                    <button type="button" onClick={() => setShowPicker(false)} className="text-xs text-gray-500 hover:text-gray-700">
                      {t('unitTypeCard.closePicker', { defaultValue: 'Close' })}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto">
                    {pickerCandidates.map(img => (
                      <button
                        key={img}
                        type="button"
                        onClick={() => addImageToUnit(img)}
                        className="relative rounded overflow-hidden border hover:ring-2 hover:ring-teal-400"
                        title={t('unitTypeCard.clickToAdd', { defaultValue: 'Click to add' })}
                      >
                        <img src={img} className="h-16 w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                    className="w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-50 disabled:text-gray-500 resize-y"
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
