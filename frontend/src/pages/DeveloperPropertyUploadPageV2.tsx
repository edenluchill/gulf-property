/**
 * Developer Property Upload Page V2 - Enhanced
 * 
 * Features:
 * - Multi-document upload support
 * - Expandable unit type cards with images
 * - Unit grouping by category
 * - Clean, minimal header
 * - Form appears after upload starts
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Sparkles, Loader2, Upload, FileText, X, MapPin } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { UnitTypeCard } from '../components/developer-upload/UnitTypeCard'
import LocationMapPickerModal from '../components/LocationMapPicker'
import { API_ENDPOINTS } from '../lib/config'

interface UnitType {
  id: string
  name: string
  category?: string
  typeName?: string
  unitNumbers?: string[]
  unitCount?: number
  bedrooms: number
  bathrooms: number
  area: number
  price?: number
  pricePerSqft?: number
  orientation?: string
  balconyArea?: number
  features?: string[]
  floorPlanImage?: string
}

interface Document {
  id: string
  file: File
  label: string
}

interface FormData {
  projectName: string
  developer: string
  address: string
  area: string
  completionDate: string
  launchDate?: string
  handoverDate?: string
  constructionProgress?: string
  description: string
  latitude?: number
  longitude?: number
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: any[]
  projectImages?: string[]
  floorPlanImages?: string[]
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
}

interface ProgressEvent {
  stage: string
  message: string
  progress: number
  data?: any
  timestamp: number
}

export default function DeveloperPropertyUploadPageV2() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStage, setCurrentStage] = useState('')
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [showMapPicker, setShowMapPicker] = useState(false)

  const eventSourceRef = useRef<EventSource | null>(null)

  const [formData, setFormData] = useState<FormData>({
    projectName: '',
    developer: '',
    address: '',
    area: '',
    completionDate: '',
    description: '',
    amenities: [],
    unitTypes: [],
    paymentPlan: [],
  })

  // Add document
  const handleAddDocument = (file: File, label: string) => {
    setDocuments(prev => [...prev, {
      id: Date.now().toString(),
      file,
      label,
    }])
    setError(null)
  }

  // Remove document
  const handleRemoveDocument = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id))
  }

  // File selection - support multiple files
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach((file, idx) => {
      if (file.type === 'application/pdf') {
        const label = idx === 0 ? '主手册' : `文档 ${idx + 1}`
        handleAddDocument(file, label)
      }
    })
  }

  // Process all documents
  const handleProcessPdfs = async () => {
    if (documents.length === 0) return

    setHasStarted(true)
    setIsProcessing(true)
    setProgress(0)
    setCurrentStage('Starting...')
    setProgressEvents([])
    setError(null)

    try {
      const formDataToSend = new FormData()
      documents.forEach(doc => {
        formDataToSend.append('files', doc.file)
      })

      const response = await fetch(API_ENDPOINTS.langgraphProgressStart, {
        method: 'POST',
        body: formDataToSend,
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to start processing')
      }

      const jobId = data.jobId

      const eventSource = new EventSource(API_ENDPOINTS.langgraphProgressStream(jobId))
      eventSourceRef.current = eventSource

      eventSource.onmessage = (event) => {
        const progressEvent: ProgressEvent = JSON.parse(event.data)
        
        setProgressEvents(prev => [...prev, progressEvent])
        setProgress(progressEvent.progress)
        setCurrentStage(progressEvent.message)

        if (progressEvent.data?.buildingData) {
          const { buildingData } = progressEvent.data
          
          // Debug: Check if images and payment plan are received
          if (buildingData.images) {
            console.log('📸 Images received:', {
              projectImages: buildingData.images.projectImages?.length || 0,
              floorPlanImages: buildingData.images.floorPlanImages?.length || 0,
            });
          }
          if (buildingData.paymentPlans) {
            console.log('💰 Payment plans received:', buildingData.paymentPlans.length);
            console.log('   Milestones:', buildingData.paymentPlans[0]?.milestones?.length || 0);
          }
          
          setFormData(prev => ({
            ...prev,
            projectName: buildingData.name || prev.projectName,
            developer: buildingData.developer || prev.developer,
            address: buildingData.address || prev.address,
            area: buildingData.area || prev.area,
            completionDate: buildingData.completionDate || prev.completionDate,
            launchDate: buildingData.launchDate || prev.launchDate,
            handoverDate: buildingData.handoverDate || prev.handoverDate,
            constructionProgress: buildingData.constructionProgress || prev.constructionProgress,
            description: buildingData.description || prev.description,
            amenities: buildingData.amenities || prev.amenities,
            unitTypes: buildingData.units || prev.unitTypes,
            paymentPlan: buildingData.paymentPlans?.[0]?.milestones || prev.paymentPlan,
            projectImages: buildingData.images?.projectImages || prev.projectImages,
            floorPlanImages: buildingData.images?.floorPlanImages || prev.floorPlanImages,
            visualContent: buildingData.visualContent || prev.visualContent,
          }))
        }

        if (progressEvent.stage === 'complete') {
          setIsProcessing(false)
          eventSource.close()
        }

        if (progressEvent.stage === 'error') {
          setError(progressEvent.message)
          setIsProcessing(false)
          eventSource.close()
        }
      }

      eventSource.onerror = () => {
        setError('Connection lost. Please try again.')
        setIsProcessing(false)
        eventSource.close()
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process PDFs')
      setIsProcessing(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Transform formData to match backend API format
      const submitData = {
        projectName: formData.projectName,
        developer: formData.developer,
        address: formData.address,
        area: formData.area,
        description: formData.description,
        latitude: formData.latitude,
        longitude: formData.longitude,
        launchDate: formData.launchDate,
        completionDate: formData.completionDate,
        handoverDate: formData.handoverDate,
        constructionProgress: formData.constructionProgress,
        projectImages: formData.projectImages || [],
        floorPlanImages: formData.floorPlanImages || [],
        amenities: formData.amenities || [],
        visualContent: formData.visualContent,
        unitTypes: formData.unitTypes.map(unit => ({
          name: unit.name,
          typeName: unit.typeName,
          category: unit.category,
          tower: (unit as any).tower,
          unitNumbers: unit.unitNumbers,
          unitCount: unit.unitCount || 1,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          area: unit.area,
          balconyArea: unit.balconyArea,
          price: unit.price,
          pricePerSqft: unit.pricePerSqft,
          orientation: unit.orientation,
          features: unit.features,
          floorPlanImage: unit.floorPlanImage,
        })),
        paymentPlan: formData.paymentPlan || [],
      }

      console.log('📤 Submitting project:', submitData)

      const response = await fetch(API_ENDPOINTS.residentialProjectsSubmit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to submit property')
      }

      console.log('✅ Project submitted successfully:', result.projectId)
      setSubmitted(true)
      setTimeout(() => { window.location.href = '/map' }, 3000)
    } catch (err) {
      console.error('❌ Submit error:', err)
      setError(err instanceof Error ? err.message : 'Failed to submit')
    }
  }

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // Group units by building prefix (A-, DSTH-, DS-V, DSTW, etc.)
  const groupedUnits = formData.unitTypes.reduce((acc, unit) => {
    let buildingGroup = (unit as any).tower;
    
    // Frontend fallback: extract prefix from typeName
    if (!buildingGroup && unit.typeName) {
      // Try to extract prefix:
      // 1. Letters before hyphen: "DSTH-M1" -> "DSTH", "A-101" -> "A"
      // 2. All leading letters: "DSTW" -> "DSTW", "DS" -> "DS"
      // 3. Letters before digits/parentheses: "DSTW5BR" -> "DSTW", "DSTH(4BR)" -> "DSTH"
      const matchWithHyphen = unit.typeName.match(/^([A-Z]+)-/);
      const matchLettersOnly = unit.typeName.match(/^([A-Z]+)$/);
      const matchBeforeDigits = unit.typeName.match(/^([A-Z]+)[\d\(]/);
      
      if (matchWithHyphen) {
        buildingGroup = matchWithHyphen[1];
      } else if (matchLettersOnly) {
        buildingGroup = matchLettersOnly[1];
      } else if (matchBeforeDigits) {
        buildingGroup = matchBeforeDigits[1];
      }
    }
    
    // Use prefix as group key, or "未分类" if no prefix found
    const groupKey = buildingGroup || '未分类';
    
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(unit);
    return acc;
  }, {} as Record<string, UnitType[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple Header */}
      <div className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7 text-amber-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">智能 PDF 提取系统</h1>
              <p className="text-sm text-gray-600">上传 PDF → AI 提取 → 审核 → 提交</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="max-w-7xl mx-auto">
          {submitted ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card className="text-center py-12">
                <CardContent>
                  <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold mb-2">✅ 提交成功！</h2>
                  <p className="text-gray-600">正在跳转...</p>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Upload Column */}
              <div className="space-y-4">
                {/* Multi-document upload */}
                <Card>
                  <CardContent className="pt-6 space-y-3">
                    {/* Document List */}
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center gap-2 p-2 bg-amber-50 rounded border">
                        <FileText className="h-4 w-4 text-amber-600" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{doc.file.name}</div>
                          <div className="text-xs text-gray-500">{(doc.file.size / 1024 / 1024).toFixed(2)} MB</div>
                        </div>
                        <button
                          onClick={() => handleRemoveDocument(doc.id)}
                          disabled={isProcessing}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    {/* Upload Area */}
                    <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 text-center hover:border-amber-500 transition-colors">
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileChange}
                        className="hidden"
                        id="pdf-upload"
                        disabled={isProcessing}
                        multiple
                      />
                      <label htmlFor="pdf-upload" className="cursor-pointer">
                        <Upload className="h-10 w-10 mx-auto mb-2 text-amber-500" />
                        <p className="text-sm font-medium">点击上传 PDF（可多选）</p>
                        <p className="text-xs text-gray-500 mt-1">Ctrl+点击选多个，每个最大20MB</p>
                      </label>
                    </div>

                    {documents.length > 0 && !isProcessing && (
                      <Button
                        onClick={handleProcessPdfs}
                        className="w-full bg-gradient-to-r from-amber-600 to-orange-600"
                        size="lg"
                      >
                        <Sparkles className="mr-2 h-5 w-5" />
                        AI 智能提取 ({documents.length} 个文档)
                      </Button>
                    )}

                    {/* Progress */}
                    {isProcessing && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>{currentStage}</span>
                          <span>{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-amber-600 to-orange-600 h-2 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-600 max-h-32 overflow-y-auto space-y-1">
                          {progressEvents.slice(-4).map((e, i) => (
                            <div key={i}>{e.message}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                        {error}
                      </div>
                    )}

                    {!isProcessing && progress === 100 && (
                      <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700">
                        ✅ 提取完成！请检查并编辑表单
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Form Column - Only shows after upload starts */}
              <AnimatePresence>
                {hasStarted && (
                  <motion.div
                    className="lg:col-span-2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Card>
                      <CardContent className="pt-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                          {/* Basic Info */}
                          <div className="space-y-4">
                            <h3 className="font-semibold border-b pb-2">基本信息</h3>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">项目名称 *</Label>
                                <Input
                                  value={formData.projectName}
                                  onChange={(e) => setFormData(prev => ({ ...prev, projectName: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  required
                                />
                              </div>
                              <div>
                                <Label className="text-sm">开发商 *</Label>
                                <Input
                                  value={formData.developer}
                                  onChange={(e) => setFormData(prev => ({ ...prev, developer: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  required
                                />
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">地址 *</Label>
                              <Input
                                value={formData.address}
                                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                                disabled={isProcessing}
                                className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                required
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">区域</Label>
                                <Input
                                  value={formData.area}
                                  onChange={(e) => setFormData(prev => ({ ...prev, area: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  placeholder="例如: Dubai Marina"
                                />
                              </div>
                              <div>
                                <Label className="text-sm">交付日期</Label>
                                <Input
                                  value={formData.completionDate || ''}
                                  onChange={(e) => setFormData(prev => ({ ...prev, completionDate: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  placeholder="2026-Q4 或 2026-12-31"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">发布日期</Label>
                                <Input
                                  value={formData.launchDate || ''}
                                  onChange={(e) => setFormData(prev => ({ ...prev, launchDate: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  placeholder="2025-01-01"
                                />
                              </div>
                              <div>
                                <Label className="text-sm">建设进度</Label>
                                <Input
                                  value={formData.constructionProgress || ''}
                                  onChange={(e) => setFormData(prev => ({ ...prev, constructionProgress: e.target.value }))}
                                  disabled={isProcessing}
                                  className={isProcessing ? 'bg-amber-50 animate-pulse' : ''}
                                  placeholder="例如: 75% Complete"
                                />
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">项目描述</Label>
                              <textarea
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                disabled={isProcessing}
                                rows={2}
                                className={`w-full rounded-md border px-3 py-2 text-sm ${isProcessing ? 'bg-amber-50 animate-pulse' : ''}`}
                              />
                            </div>

                            {/* Location Coordinates */}
                            <div className="space-y-3">
                              <Label className="text-sm font-semibold flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-amber-600" />
                                地图位置坐标
                              </Label>
                              
                              {formData.latitude && formData.longitude ? (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 text-sm">
                                        <span className="font-medium text-gray-700">纬度:</span>
                                        <span className="font-mono font-bold text-green-700">
                                          {formData.latitude.toFixed(6)}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 text-sm">
                                        <span className="font-medium text-gray-700">经度:</span>
                                        <span className="font-mono font-bold text-green-700">
                                          {formData.longitude.toFixed(6)}
                                        </span>
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setShowMapPicker(true)}
                                      disabled={isProcessing}
                                    >
                                      <MapPin className="h-3 w-3 mr-1" />
                                      重新选择
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full border-dashed border-2 border-amber-300 hover:border-amber-500 hover:bg-amber-50"
                                  onClick={() => setShowMapPicker(true)}
                                  disabled={isProcessing}
                                >
                                  <MapPin className="mr-2 h-4 w-4 text-amber-600" />
                                  点击地图选择项目位置
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Visual Content Section */}
                          <div className="space-y-3">
                            <h3 className="font-semibold border-b pb-2 flex items-center gap-2">
                              🖼️ 视觉内容
                            </h3>

                            {/* Extracted Images */}
                            {formData.projectImages && formData.projectImages.length > 0 ? (
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-green-700">✅ 已提取 {formData.projectImages.length} 张图片</p>
                                <div className="grid grid-cols-3 gap-3">
                                  {formData.projectImages.slice(0, 6).map((img, idx) => (
                                    <div 
                                      key={idx} 
                                      className="aspect-video bg-gray-100 rounded-lg overflow-hidden border hover:border-amber-400 transition-all cursor-pointer group"
                                      onClick={() => window.open(img, '_blank')}
                                    >
                                      <img 
                                        src={img} 
                                        alt={`Project ${idx + 1}`} 
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                        crossOrigin="anonymous"
                                        referrerPolicy="no-referrer"
                                        onError={(e) => {
                                          console.error('Image load failed:', img.substring(0, 50));
                                          e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>
                                {formData.projectImages.length > 6 && (
                                  <p className="text-xs text-gray-500 text-center">
                                    +{formData.projectImages.length - 6} 张图片（点击查看大图）
                                  </p>
                                )}
                              </div>
                            ) : formData.visualContent && (formData.visualContent.hasRenderings || formData.visualContent.hasFloorPlans) ? (
                              <div className="space-y-3 bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <p className="text-sm font-medium text-blue-800">
                                  ℹ️ AI 检测到 PDF 中包含以下视觉内容（无法直接提取）：
                                </p>
                                <div className="space-y-2 text-sm">
                                  {formData.visualContent.hasRenderings && (
                                    <div>
                                      <p className="font-medium text-blue-700">📐 效果图渲染:</p>
                                      {formData.visualContent.renderingDescriptions && formData.visualContent.renderingDescriptions.length > 0 ? (
                                        <ul className="list-disc list-inside ml-2 text-gray-700 space-y-1">
                                          {formData.visualContent.renderingDescriptions.map((desc, idx) => (
                                            <li key={idx}>{desc}</li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="ml-2 text-gray-600">已检测到项目效果图</p>
                                      )}
                                    </div>
                                  )}
                                  {formData.visualContent.hasFloorPlans && (
                                    <div>
                                      <p className="font-medium text-blue-700">🏠 户型平面图:</p>
                                      {formData.visualContent.floorPlanDescriptions && formData.visualContent.floorPlanDescriptions.length > 0 ? (
                                        <ul className="list-disc list-inside ml-2 text-gray-700 space-y-1">
                                          {formData.visualContent.floorPlanDescriptions.map((desc, idx) => (
                                            <li key={idx}>{desc}</li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="ml-2 text-gray-600">已检测到户型平面图</p>
                                      )}
                                    </div>
                                  )}
                                  {formData.visualContent.hasLocationMaps && (
                                    <div>
                                      <p className="font-medium text-blue-700">🗺️ 位置地图:</p>
                                      <p className="ml-2 text-gray-600">已检测到位置/区域地图</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 bg-gray-50 rounded-lg border-2 border-dashed">
                                <p className="text-sm text-gray-500">
                                  {isProcessing ? '🖼️ 正在分析视觉内容...' : '暂无图片或视觉内容'}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Unit Types - Grouped by Tower/Building */}
                          <div className="space-y-3">
                            <h3 className="font-semibold border-b pb-2">
                              户型列表 ({formData.unitTypes.length} 个)
                            </h3>

                            {isProcessing && formData.unitTypes.length === 0 && (
                              <div className="text-center py-8 bg-amber-50 rounded-lg">
                                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-amber-600" />
                                <p className="text-sm text-gray-600">AI 正在提取户型...</p>
                              </div>
                            )}

                            {/* Group by prefix */}
                            {Object.entries(groupedUnits).map(([groupKey, units]) => {
                              const isUncategorized = groupKey === '未分类';
                              return (
                                <div key={groupKey} className="space-y-2">
                                  <div className={`text-sm font-semibold px-4 py-2 rounded-lg ${
                                    isUncategorized 
                                      ? 'text-gray-700 bg-gray-100 border-l-4 border-gray-400' 
                                      : 'text-blue-800 bg-blue-100 border-l-4 border-blue-500 text-base'
                                  }`}>
                                    {isUncategorized ? `📋 ${groupKey}` : `🏢 ${groupKey} 系列`} ({units.length} 种户型)
                                  </div>
                                  {units.map((unit, idx) => (
                                    <UnitTypeCard
                                      key={unit.id}
                                      unit={unit}
                                      index={idx}
                                      isProcessing={isProcessing}
                                      onChange={(field, value) => {
                                        const globalIdx = formData.unitTypes.findIndex(u => u.id === unit.id);
                                        const updated = [...formData.unitTypes];
                                        updated[globalIdx] = { ...updated[globalIdx], [field]: value };
                                        setFormData(prev => ({ ...prev, unitTypes: updated }));
                                      }}
                                      onRemove={() => {
                                        setFormData(prev => ({
                                          ...prev,
                                          unitTypes: prev.unitTypes.filter(u => u.id !== unit.id)
                                        }));
                                      }}
                                    />
                                  ))}
                                </div>
                              );
                            })}
                          </div>

                          {/* Payment Plan */}
                          <div className="space-y-3">
                            <h3 className="font-semibold border-b pb-2 flex items-center gap-2">
                              💰 付款计划
                              {formData.paymentPlan && formData.paymentPlan.length > 0 && (
                                <span className="text-sm font-normal text-gray-500">
                                  ({formData.paymentPlan.length} 个阶段)
                                </span>
                              )}
                            </h3>

                            {formData.paymentPlan && formData.paymentPlan.length > 0 ? (
                              <div className="space-y-2">
                                {formData.paymentPlan.map((milestone: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                                    <div className="flex-1">
                                      <div className="font-medium text-sm text-gray-900">
                                        {milestone.milestone || `阶段 ${idx + 1}`}
                                      </div>
                                      {milestone.date && (
                                        <div className="text-xs text-gray-500 mt-1">
                                          {milestone.date}
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      <div className="text-lg font-bold text-amber-600">
                                        {milestone.percentage}%
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                <div className="text-xs text-gray-500 text-center pt-2">
                                  总计: {formData.paymentPlan.reduce((sum: number, m: any) => sum + (m.percentage || 0), 0)}%
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed">
                                {isProcessing ? (
                                  <div className="text-gray-500">
                                    <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-amber-600" />
                                    <p className="text-sm">AI 正在提取付款计划...</p>
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-500">暂无付款计划</p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Submit */}
                          <Button
                            type="submit"
                            size="lg"
                            className="w-full bg-gradient-to-r from-green-600 to-emerald-600"
                            disabled={isProcessing || !formData.projectName}
                          >
                            {isProcessing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                处理中...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="mr-2 h-4 w-4" />
                                提交项目
                              </>
                            )}
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Location Map Picker Modal */}
      <LocationMapPickerModal
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng) => {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }))
        }}
        initialPosition={
          formData.latitude && formData.longitude
            ? { lat: formData.latitude, lng: formData.longitude }
            : undefined
        }
      />
    </div>
  )
}
