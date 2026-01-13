/**
 * Property Form Component
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Building2, Sparkles, Loader2, CheckCircle, Trash2, TrendingUp, Home } from 'lucide-react';

interface UnitType {
  id: string;
  name: string;
  area: number;
  bedrooms: number;
  bathrooms: number;
  price?: number;
}

interface PaymentMilestone {
  milestone: string;
  percentage: number;
  date: string | null;
}

interface FormData {
  projectName: string;
  developer: string;
  address: string;
  area: string;
  completionDate: string;
  launchDate: string;
  description: string;
  amenities: string[];
  unitTypes: UnitType[];
  paymentPlan: PaymentMilestone[];
}

interface PropertyFormProps {
  formData: FormData;
  isProcessing: boolean;
  progress: number;
  onInputChange: (field: keyof FormData, value: any) => void;
  onUnitTypeChange: (index: number, field: keyof UnitType, value: any) => void;
  onPaymentPlanChange: (index: number, field: keyof PaymentMilestone, value: any) => void;
  onAmenityChange: (value: string) => void;
  onAddUnitType: () => void;
  onRemoveUnitType: (index: number) => void;
  onAddPaymentItem: () => void;
  onRemovePaymentItem: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function PropertyForm({
  formData,
  isProcessing,
  progress,
  onInputChange,
  onUnitTypeChange,
  onPaymentPlanChange,
  onAmenityChange,
  onAddUnitType,
  onRemoveUnitType,
  onAddPaymentItem,
  onRemovePaymentItem,
  onSubmit,
}: PropertyFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-amber-600" />
          项目信息
          {isProcessing && (
            <span className="ml-auto text-sm font-normal text-amber-600 flex items-center gap-1">
              <Sparkles className="h-4 w-4 animate-pulse" />
              AI 正在填充...
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {isProcessing 
            ? 'AI 正在实时提取数据，请稍候...'
            : progress === 100
            ? '✅ 提取完成！请检查并编辑信息，然后提交'
            : '上传 PDF 后，AI 会自动填充此表单'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2 flex items-center gap-2">
              <Home className="h-5 w-5 text-amber-600" />
              基本信息
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="projectName">项目名称 *</Label>
                <Input
                  id="projectName"
                  value={formData.projectName}
                  onChange={(e) => onInputChange('projectName', e.target.value)}
                  placeholder="AI 提取中..."
                  required
                  disabled={isProcessing}
                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="developer">开发商 *</Label>
                <Input
                  id="developer"
                  value={formData.developer}
                  onChange={(e) => onInputChange('developer', e.target.value)}
                  placeholder="AI 提取中..."
                  required
                  disabled={isProcessing}
                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">地址 *</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => onInputChange('address', e.target.value)}
                placeholder="AI 提取中..."
                required
                disabled={isProcessing}
                className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="area">区域</Label>
                <Input
                  id="area"
                  value={formData.area}
                  onChange={(e) => onInputChange('area', e.target.value)}
                  placeholder="例如：Business Bay"
                  disabled={isProcessing}
                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="completionDate">交付日期</Label>
                <Input
                  id="completionDate"
                  type="date"
                  value={formData.completionDate}
                  onChange={(e) => onInputChange('completionDate', e.target.value)}
                  disabled={isProcessing}
                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">项目描述</Label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => onInputChange('description', e.target.value)}
                placeholder="AI 提取中..."
                rows={3}
                disabled={isProcessing}
                className={`flex w-full rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isProcessing ? 'bg-amber-50 animate-pulse' : 'bg-background'}`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amenities">设施配套（逗号分隔）</Label>
              <Input
                id="amenities"
                value={formData.amenities.join(', ')}
                onChange={(e) => onAmenityChange(e.target.value)}
                placeholder="AI 提取中..."
                disabled={isProcessing}
                className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
              />
            </div>
          </div>

          {/* Unit Types */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-amber-600" />
                户型列表
                {formData.unitTypes.length > 0 && (
                  <span className="text-sm font-normal text-slate-500">
                    ({formData.unitTypes.length} 个户型)
                  </span>
                )}
              </h3>
              <Button 
                type="button" 
                onClick={onAddUnitType} 
                size="sm" 
                variant="outline"
                disabled={isProcessing}
              >
                + 添加户型
              </Button>
            </div>

            {formData.unitTypes.length === 0 && (
              <div className="text-center py-8 bg-slate-50 rounded-lg border-2 border-dashed">
                {isProcessing ? (
                  <div className="text-slate-500">
                    <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-amber-600" />
                    <p>AI 正在提取户型信息...</p>
                  </div>
                ) : (
                  <p className="text-slate-500">暂无户型信息</p>
                )}
              </div>
            )}

            {formData.unitTypes.map((unit, index) => (
              <Card key={unit.id} className={`p-4 ${isProcessing ? 'bg-amber-50 animate-pulse' : ''}`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="font-semibold">户型 {index + 1}</Label>
                    <Button
                      type="button"
                      onClick={() => onRemoveUnitType(index)}
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      disabled={isProcessing}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="名称"
                      value={unit.name}
                      onChange={(e) => onUnitTypeChange(index, 'name', e.target.value)}
                      disabled={isProcessing}
                    />
                    <Input
                      type="number"
                      placeholder="卧室数"
                      value={unit.bedrooms || ''}
                      onChange={(e) => onUnitTypeChange(index, 'bedrooms', e.target.value ? parseInt(e.target.value) : 0)}
                      disabled={isProcessing}
                    />
                    <Input
                      type="number"
                      placeholder="面积 (sqft)"
                      value={unit.area || ''}
                      onChange={(e) => onUnitTypeChange(index, 'area', e.target.value ? parseFloat(e.target.value) : 0)}
                      disabled={isProcessing}
                    />
                    <Input
                      type="number"
                      placeholder="价格 (AED)"
                      value={unit.price || ''}
                      onChange={(e) => onUnitTypeChange(index, 'price', e.target.value ? parseFloat(e.target.value) : undefined)}
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Payment Plan */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-lg font-semibold">付款计划</h3>
              <Button 
                type="button" 
                onClick={onAddPaymentItem} 
                size="sm" 
                variant="outline"
                disabled={isProcessing}
              >
                + 添加阶段
              </Button>
            </div>

            {formData.paymentPlan.length === 0 && (
              <div className="text-center py-6 bg-slate-50 rounded-lg border-2 border-dashed">
                {isProcessing ? (
                  <div className="text-slate-500">
                    <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-amber-600" />
                    <p className="text-sm">AI 正在提取付款计划...</p>
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm">暂无付款计划</p>
                )}
              </div>
            )}

            {formData.paymentPlan.map((item, index) => (
              <Card key={index} className={`p-4 ${isProcessing ? 'bg-amber-50 animate-pulse' : ''}`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="font-semibold">阶段 {index + 1}</Label>
                    <Button
                      type="button"
                      onClick={() => onRemovePaymentItem(index)}
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      disabled={isProcessing}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      placeholder="里程碑"
                      value={item.milestone}
                      onChange={(e) => onPaymentPlanChange(index, 'milestone', e.target.value)}
                      className="col-span-2"
                      disabled={isProcessing}
                    />
                    <Input
                      type="number"
                      placeholder="%"
                      value={item.percentage}
                      onChange={(e) => onPaymentPlanChange(index, 'percentage', parseFloat(e.target.value))}
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Submit Button */}
          <div className="pt-6 border-t">
            <Button 
              type="submit" 
              size="lg" 
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg"
              disabled={isProcessing || !formData.projectName || !formData.developer}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  处理中，请稍候...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  提交项目
                </>
              )}
            </Button>
            <p className="text-xs text-slate-500 text-center mt-3">
              提交后项目将立即显示在地图上
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
