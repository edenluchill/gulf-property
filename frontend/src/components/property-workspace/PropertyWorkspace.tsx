/**
 * PropertyWorkspace — the sectioned review/edit workspace shared by:
 * - /developer/upload          (extract → review → submit)
 * - /admin/tasks/:id/review    (review stored task → submit)
 * - /admin/property/edit/:id   (edit existing project → update)
 *
 * Owns: section nav + active section panel, readiness computation,
 * sticky submit bar, submit review dialog, map picker (with coordinate →
 * area auto-resolution) and the submitting overlay.
 *
 * Pages own: data loading, network submission (onConfirmSubmit) and any
 * extras above the workspace (e.g. the upload/progress banner).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../ui/card'
import { Loader2, AlertTriangle, FileText, Download } from 'lucide-react'
import { UnitTypeCard } from '../developer-upload/UnitTypeCard'
import { ProjectBasicInfoSection } from '../developer-upload/ProjectBasicInfoSection'
import { DateTimeProgressSection } from '../developer-upload/DateTimeProgressSection'
import { VisualContentSection } from '../developer-upload/VisualContentSection'
import { PaymentPlanSection } from '../developer-upload/PaymentPlanSection'
import { AmenitiesSection } from '../developer-upload/AmenitiesSection'
import { ExtractedPricingSection } from '../developer-upload/ExtractedPricingSection'
import { SubmitReviewDialog, type ClientReadiness } from '../developer-upload/SubmitReviewDialog'
import { SectionNav, type SectionItem } from '../developer-upload/SectionNav'
import { SubmitBar, type ReadinessChip } from '../developer-upload/SubmitBar'
import LocationMapPickerModal from '../LocationMapPicker'
import { API_BASE_URL } from '../../lib/config'
import { PropertyFormData, groupUnitsByBuilding } from '../property-editor/types'

type SectionId = 'basic' | 'dates' | 'images' | 'units' | 'amenities' | 'payment' | 'pricing' | 'pdfs'

export interface PropertyWorkspaceProps {
  formData: PropertyFormData
  setFormData: React.Dispatch<React.SetStateAction<PropertyFormData>>
  /** Live extraction in progress — disables inputs, shows loading states */
  isProcessing?: boolean
  isSubmitting: boolean
  hasReviewed: boolean
  setHasReviewed: (value: boolean) => void
  /** Called when the user confirms in the review dialog */
  onConfirmSubmit: () => void | Promise<void>
  /** Possible duplicate project names (shown in basic info + dialog) */
  duplicateNames?: string[]
  /** Guidance shown when processing finished with zero units (marketing-only brochure) */
  emptyUnitsMessage?: string
  /** Submit button label override (e.g. 更新项目 for the edit page) */
  submitLabel?: string
  /** 源 PDF 下载链接(任务审核页传入)→ 作为独立「源 PDF」分区,不再顶部横幅占空间 */
  pdfLinks?: { name: string; url: string }[]
}

export function PropertyWorkspace({
  formData,
  setFormData,
  isProcessing = false,
  isSubmitting,
  hasReviewed,
  setHasReviewed,
  onConfirmSubmit,
  duplicateNames = [],
  emptyUnitsMessage,
  submitLabel,
  pdfLinks = [],
}: PropertyWorkspaceProps) {
  const { t } = useTranslation('upload')
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)

  const handleFormChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // ⭐ area 由坐标自动解析（区域是手动维护的图层：坐标落在某区域内就带上，
  // 不在任何区域内则置空——空值是合法状态，不阻塞提交）
  const resolveAreaFromCoords = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/residential-projects/meta/resolve-area?lat=${lat}&lng=${lng}`)
      if (!res.ok) return
      const json = await res.json()
      setFormData(prev => ({ ...prev, area: json.area || '' }))
    } catch (err) {
      console.warn('Area resolve failed (non-fatal):', err)
    }
  }

  // ⭐ 提交就绪状态（随表单编辑实时更新，规则与后端一致）
  const computeReadiness = (): ClientReadiness => {
    const missingProjectFields: string[] = []
    if (!formData.projectName) missingProjectFields.push(t('readiness.fieldName'))
    if (!formData.developer) missingProjectFields.push(t('readiness.fieldDeveloper'))
    if (!formData.address) missingProjectFields.push(t('readiness.fieldAddress'))
    // area 不是必填：手动维护的图层，坐标在区域外时合法留空

    const blockedUnits: { name: string; issues: string[] }[] = []
    const warningUnits: { name: string; issues: string[] }[] = []
    for (const u of formData.unitTypes) {
      const blockers: string[] = []
      const warnings: string[] = []
      if (!u.area || u.area <= 0) blockers.push(t('readiness.issueArea'))
      if (u.bedrooms == null) blockers.push(t('readiness.issueBedrooms'))
      if (!u.price) warnings.push(t('readiness.issuePrice'))
      if (!u.floorPlanImage && (!u.floorPlanImages || u.floorPlanImages.length === 0)) {
        warnings.push(t('readiness.issueFloorPlan'))
      }
      const name = u.name || u.typeName || 'Unknown'
      if (blockers.length > 0) blockedUnits.push({ name, issues: blockers })
      else if (warnings.length > 0) warningUnits.push({ name, issues: warnings })
    }

    return {
      missingProjectFields,
      blockedUnits,
      warningUnits,
      unitsCount: formData.unitTypes.length,
      // No unit types is allowed (info can be added later) — the submit dialog
      // shows an explicit "暂无户型" reminder. Only missing project fields or
      // hard-broken units block submission.
      submittable: missingProjectFields.length === 0
        && blockedUnits.length === 0,
    }
  }

  const readiness = computeReadiness()
  const groupedUnits = groupUnitsByBuilding(formData.unitTypes)
  const visibleImageCount = (formData.projectImages || []).filter(
    img => !(formData.hiddenProjectImages || []).includes(img)
  ).length
  // 合计用「每期总贡献」:按月分期行 = 每月% × 月数,普通行 = percentage。
  // (percentage 本身已存总贡献,这里对 monthly 行做同样口径以防旧数据 percentage 缺失。)
  const paymentTotal = (formData.paymentPlan || []).reduce(
    (sum, m: any) => sum + (m?.monthlyCount
      ? (parseFloat(String(m.monthlyPct)) || 0) * (parseFloat(String(m.monthlyCount)) || 0)
      : (parseFloat(String(m.percentage)) || 0)), 0
  )
  const hasExtraInfo = formData.serviceCharge != null || (formData.landmarks?.length || 0) > 0

  const sections: SectionItem[] = [
    {
      id: 'basic',
      label: t('basicInfo.title'),
      status: readiness.missingProjectFields.length > 0
        ? (isProcessing ? 'loading' : 'error')
        : duplicateNames.length > 0 ? 'warn' : 'ok',
    },
    {
      id: 'dates',
      label: t('dateProgress.title'),
      status: formData.completionDate || formData.handoverDate ? 'ok' : isProcessing ? 'loading' : 'warn',
    },
    {
      id: 'images',
      label: t('visualContent.title'),
      badge: visibleImageCount,
      status: visibleImageCount > 0 ? 'ok' : isProcessing ? 'loading' : 'muted',
    },
    {
      id: 'units',
      label: t('unitTypesList'),
      badge: formData.unitTypes.length,
      status: isProcessing && formData.unitTypes.length === 0
        ? 'loading'
        : readiness.blockedUnits.length > 0 || (!isProcessing && formData.unitTypes.length === 0)
          ? 'error'
          : readiness.warningUnits.length > 0 ? 'warn' : 'ok',
    },
    {
      id: 'amenities',
      label: t('amenities.title'),
      badge: formData.amenities.length,
      status: formData.amenities.length > 0 ? 'ok' : isProcessing ? 'loading' : 'muted',
    },
    {
      id: 'payment',
      label: t('paymentPlan.title'),
      status: formData.paymentPlan.length === 0
        ? (isProcessing ? 'loading' : 'muted')
        : Math.abs(paymentTotal - 100) < 0.01 ? 'ok' : 'warn',
    },
    {
      id: 'pricing',
      label: t('workspace.sectionPricing'),
      badge: formData.extractedPricing?.length || 0,
      status: (formData.extractedPricing?.length || 0) > 0 ? 'ok' : 'muted',
    },
    // 源 PDF(仅任务审核页有):下载原件对比 AI 提取
    ...(pdfLinks.length > 0
      ? [{
          id: 'pdfs' as const,
          label: t('workspace.sectionPdfs', '源 PDF'),
          badge: pdfLinks.length,
          status: 'muted' as const,
        }]
      : []),
  ]

  const submitChips: ReadinessChip[] = [
    ...readiness.missingProjectFields.map(f => ({ label: f, tone: 'error' as const })),
    {
      label: formData.latitude && formData.longitude ? t('reviewDialog.coordSet') : t('reviewDialog.coordNotSet'),
      tone: formData.latitude && formData.longitude ? 'ok' as const : 'warn' as const,
    },
    readiness.blockedUnits.length > 0
      ? { label: t('readiness.blockedUnits', { count: readiness.blockedUnits.length }), tone: 'error' as const }
      : { label: t('reviewDialog.unitCount', { count: readiness.unitsCount }), tone: readiness.unitsCount > 0 ? 'ok' as const : 'error' as const },
    ...(readiness.warningUnits.length > 0
      ? [{ label: t('readiness.warningUnits', { count: readiness.warningUnits.length }), tone: 'warn' as const }]
      : []),
    ...(duplicateNames.length > 0
      ? [{ label: t('readiness.duplicate.title'), tone: 'warn' as const }]
      : []),
  ]

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'basic':
        return (
          <div className="space-y-5">
            {duplicateNames.length > 0 && !isProcessing && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold text-amber-900">{t('readiness.duplicate.title')}</span>
                  <p className="text-amber-800 mt-0.5">
                    {t('readiness.duplicate.desc', { names: duplicateNames.slice(0, 3).join('、') })}
                  </p>
                </div>
              </div>
            )}
            <ProjectBasicInfoSection
              formData={formData}
              isProcessing={isProcessing}
              onChange={handleFormChange}
              onOpenMapPicker={() => setShowMapPicker(true)}
            />
            {/* ⭐ 文本层附加信息：服务费 + 地标距离 */}
            {hasExtraInfo && (
              <div className="space-y-3 pt-5 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700">{t('readiness.extraInfoTitle')}</h4>
                {formData.serviceCharge != null && (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-600">{t('readiness.serviceCharge')}:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.serviceCharge}
                      onChange={(e) => handleFormChange('serviceCharge', e.target.value ? parseFloat(e.target.value) : undefined)}
                      disabled={isProcessing}
                      className="w-28 px-3 py-1.5 border rounded-lg text-sm"
                    />
                    <span className="text-gray-400">AED/sqft</span>
                  </div>
                )}
                {formData.landmarks && formData.landmarks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {formData.landmarks.map((lm, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700">
                        📍 {lm.name} · {lm.distanceKm} km
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      case 'dates':
        return (
          <DateTimeProgressSection
            formData={{
              launchDate: formData.launchDate,
              completionDate: formData.completionDate,
              handoverDate: formData.handoverDate,
              constructionProgress: formData.constructionProgress,
              status: formData.status,
            }}
            isProcessing={isProcessing}
            onChange={handleFormChange}
          />
        )
      case 'images':
        return (
          <VisualContentSection
            projectImages={formData.projectImages}
            hiddenProjectImages={formData.hiddenProjectImages}
            visualContent={formData.visualContent}
            isProcessing={isProcessing}
            primaryImage={formData.primaryImage}
            onPrimaryImageChange={(img) => handleFormChange('primaryImage', img)}
            onProjectImagesChange={(imgs) => handleFormChange('projectImages', imgs)}
            onHiddenProjectImagesChange={(hidden) => handleFormChange('hiddenProjectImages', hidden)}
          />
        )
      case 'units':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">{t('unitTypesList')}</h3>
              <span className="text-sm text-gray-500">{t('totalUnitTypes', { count: formData.unitTypes.length })}</span>
            </div>

            {/* 会被过滤的户型警示（与后端提交规则一致） */}
            {!isProcessing && readiness.blockedUnits.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-red-900 mb-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  {t('workspace.blockedBanner')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {readiness.blockedUnits.map(u => (
                    <span key={u.name} className="px-2 py-0.5 bg-white border border-red-200 rounded text-xs text-red-700">
                      {u.name} — {u.issues.join('、')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {isProcessing && formData.unitTypes.length === 0 && (
              <div className="text-center py-14 bg-teal-50/60 rounded-xl border border-dashed border-teal-200">
                <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-teal-600" />
                <p className="text-sm text-gray-700 font-semibold">{t('aiAnalyzing')}</p>
                <p className="text-xs text-gray-500 mt-1">{t('extractingUnitTypes')}</p>
              </div>
            )}

            {/* ⭐ 0户型空态：营销画册引导 */}
            {!isProcessing && formData.unitTypes.length === 0 && emptyUnitsMessage && (
              <div className="py-10 px-8 bg-amber-50 rounded-xl border border-amber-200 text-center">
                <div className="text-3xl mb-2">📖</div>
                <h4 className="text-base font-bold text-amber-900 mb-1.5">{t('readiness.noUnits.title')}</h4>
                <p className="text-sm text-amber-800 max-w-xl mx-auto">{emptyUnitsMessage}</p>
                <p className="text-xs text-amber-700 mt-2">{t('readiness.noUnits.hint')}</p>
              </div>
            )}

            {/* Grouped Units */}
            {Object.entries(groupedUnits).map(([groupKey, units]) => {
              const isUncategorized = groupKey === 'Uncategorized'
              return (
                <div key={groupKey} className="space-y-3">
                  {!isUncategorized && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <span className="h-5 w-1 bg-teal-400 rounded-full" />
                      {t('series', { key: groupKey })}
                      <span className="text-xs font-normal text-gray-400">{t('unitTypeCount', { count: units.length })}</span>
                    </div>
                  )}
                  <div className="space-y-3">
                    {units.map((unit, idx) => (
                      <UnitTypeCard
                        key={unit.id}
                        unit={unit}
                        index={idx}
                        isProcessing={isProcessing}
                        onChange={(field, value) => {
                          setFormData(prev => {
                            const globalIdx = prev.unitTypes.findIndex(u => u.id === unit.id)
                            if (globalIdx === -1) return prev
                            const updated = [...prev.unitTypes]
                            updated[globalIdx] = { ...updated[globalIdx], [field]: value }
                            return { ...prev, unitTypes: updated }
                          })
                        }}
                        onRemove={() => {
                          setFormData(prev => ({
                            ...prev,
                            unitTypes: prev.unitTypes.filter(u => u.id !== unit.id)
                          }))
                        }}
                        galleryImages={(formData.projectImages || []).filter(
                          img => !(formData.hiddenProjectImages || []).includes(img)
                        )}
                        onTakeImageFromGallery={(img) => {
                          // 移入户型 = 从项目图库摘除（真"移动"）
                          setFormData(prev => ({
                            ...prev,
                            projectImages: (prev.projectImages || []).filter(i => i !== img),
                          }))
                        }}
                        onReturnImageToGallery={(img) => {
                          // 从户型移除 = 退回项目图库
                          setFormData(prev => (prev.projectImages || []).includes(img)
                            ? prev
                            : { ...prev, projectImages: [...(prev.projectImages || []), img] })
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      case 'amenities':
        return (
          <AmenitiesSection
            amenities={formData.amenities}
            isProcessing={isProcessing}
          />
        )
      case 'payment':
        return (
          <PaymentPlanSection
            paymentPlan={formData.paymentPlan}
            isProcessing={isProcessing}
            onChange={(plan) => handleFormChange('paymentPlan', plan)}
          />
        )
      case 'pricing':
        return (
          <ExtractedPricingSection
            pricing={formData.extractedPricing}
            isProcessing={isProcessing}
          />
        )
      case 'pdfs':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{t('workspace.sectionPdfs', '源 PDF')}</h3>
                <p className="text-sm text-gray-600">{t('workspace.pdfHint', '点击下载原件,与 AI 提取结果对比')}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {pdfLinks.map((pdf, i) => (
                <a
                  key={i}
                  href={pdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 transition-colors hover:border-teal-300 hover:bg-teal-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-teal-600 shadow-sm">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{pdf.name}</span>
                  <Download className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-teal-600" />
                </a>
              ))}
            </div>
          </div>
        )
    }
  }

  return (
    <>
      {/* Nav + active section panel */}
      <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl w-full flex-1">
        <div className="flex flex-col md:flex-row gap-4 md:gap-5">
          <SectionNav
            sections={sections}
            activeId={activeSection}
            onSelect={(id) => setActiveSection(id as SectionId)}
          />
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <Card className="border border-gray-200 shadow-sm">
                  <CardContent className="p-4 sm:p-6">
                    {renderActiveSection()}
                  </CardContent>
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Sticky bottom submit bar */}
      <SubmitBar
        chips={submitChips}
        hasReviewed={hasReviewed}
        onReviewedChange={setHasReviewed}
        canSubmit={!!formData.projectName}
        isProcessing={isProcessing}
        isSubmitting={isSubmitting}
        onSubmit={() => {
          if (!isProcessing && !isSubmitting) setShowReviewDialog(true)
        }}
        submitLabel={submitLabel}
      />

      {/* Location Map Picker Modal */}
      <LocationMapPickerModal
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng) => {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }))
          // ⭐ 坐标变更 → 自动重算区域（可能为空）
          resolveAreaFromCoords(lat, lng)
        }}
        initialPosition={
          formData.latitude && formData.longitude
            ? { lat: formData.latitude, lng: formData.longitude }
            : undefined
        }
        address={formData.address}
      />

      {/* Submit Review Dialog */}
      <SubmitReviewDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        onConfirm={async () => {
          try {
            await onConfirmSubmit()
            setShowReviewDialog(false)
          } catch {
            // submission failed — keep the dialog open so the user can retry
          }
        }}
        isSubmitting={isSubmitting}
        projectName={formData.projectName}
        developer={formData.developer}
        readiness={readiness}
        hasCoordinates={!!(formData.latitude && formData.longitude)}
        duplicateNames={duplicateNames}
      />

      {/* Submitting Overlay */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-12 max-w-md mx-4"
            >
              <div className="text-center">
                <Loader2 className="h-20 w-20 mx-auto mb-6 animate-spin text-green-600" />
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{t('overlay.submittingProject')}</h3>
                <p className="text-gray-600 mb-2">{t('overlay.savingToDb')}</p>
                <p className="text-sm text-gray-500">{t('overlay.pleaseWait')}</p>
                <div className="mt-6 flex items-center justify-center gap-1">
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
