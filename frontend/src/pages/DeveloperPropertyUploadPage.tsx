import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Building2, Upload, FileText, Loader2, CheckCircle, XCircle, Image as ImageIcon, Trash2 } from 'lucide-react'

interface UnitType {
  id: string
  name: string
  minArea: number | null
  maxArea: number | null
  minPrice: number | null
  maxPrice: number | null
  bedrooms: number | null
  bathrooms: number | null
}

interface PaymentPlanItem {
  milestone: string
  percentage: number
  date: string | null
}

interface ExtractedData {
  projectName: string
  developer: string
  address: string
  minPrice: number | null
  maxPrice: number | null
  minArea: number | null
  maxArea: number | null
  minBedrooms: number | null
  maxBedrooms: number | null
  latitude: number | null
  longitude: number | null
  completionDate: string
  launchDate: string
  description: string
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: PaymentPlanItem[]
  images: {
    showcase: string[]
    floorplans: string[]
    amenities: string[]
  }
}

export default function DeveloperPropertyUploadPage() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Form state
  const [formData, setFormData] = useState<ExtractedData>({
    projectName: '',
    developer: '',
    address: '',
    minPrice: null,
    maxPrice: null,
    minArea: null,
    maxArea: null,
    minBedrooms: null,
    maxBedrooms: null,
    latitude: null,
    longitude: null,
    completionDate: '',
    launchDate: '',
    description: '',
    amenities: [],
    unitTypes: [],
    paymentPlan: [],
    images: {
      showcase: [],
      floorplans: [],
      amenities: []
    }
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/pdf') {
      setPdfFile(file)
      setError(null)
    } else {
      setError('Please select a valid PDF file')
    }
  }

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') {
      setPdfFile(file)
      setError(null)
    } else {
      setError('Please drop a valid PDF file')
    }
  }

  const handleProcessPdf = async () => {
    if (!pdfFile) return

    setIsProcessing(true)
    setError(null)

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('pdf', pdfFile)

      const response = await fetch('http://localhost:3000/api/developer/process-pdf', {
        method: 'POST',
        body: formDataToSend,
      })

      if (!response.ok) {
        throw new Error('Failed to process PDF')
      }

      const data = await response.json()
      setExtractedData(data)
      setFormData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process PDF')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleInputChange = (field: keyof ExtractedData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleUnitTypeChange = (index: number, field: keyof UnitType, value: any) => {
    const updatedUnitTypes = [...formData.unitTypes]
    updatedUnitTypes[index] = { ...updatedUnitTypes[index], [field]: value }
    setFormData(prev => ({ ...prev, unitTypes: updatedUnitTypes }))
  }

  const addUnitType = () => {
    setFormData(prev => ({
      ...prev,
      unitTypes: [...prev.unitTypes, {
        id: Date.now().toString(),
        name: '',
        minArea: null,
        maxArea: null,
        minPrice: null,
        maxPrice: null,
        bedrooms: null,
        bathrooms: null
      }]
    }))
  }

  const removeUnitType = (index: number) => {
    setFormData(prev => ({
      ...prev,
      unitTypes: prev.unitTypes.filter((_, i) => i !== index)
    }))
  }

  const handlePaymentPlanChange = (index: number, field: keyof PaymentPlanItem, value: any) => {
    const updatedPlan = [...formData.paymentPlan]
    updatedPlan[index] = { ...updatedPlan[index], [field]: value }
    setFormData(prev => ({ ...prev, paymentPlan: updatedPlan }))
  }

  const addPaymentPlanItem = () => {
    setFormData(prev => ({
      ...prev,
      paymentPlan: [...prev.paymentPlan, {
        milestone: '',
        percentage: 0,
        date: null
      }]
    }))
  }

  const removePaymentPlanItem = (index: number) => {
    setFormData(prev => ({
      ...prev,
      paymentPlan: prev.paymentPlan.filter((_, i) => i !== index)
    }))
  }

  const handleAmenityChange = (value: string) => {
    const amenities = value.split(',').map(a => a.trim()).filter(a => a)
    setFormData(prev => ({ ...prev, amenities }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch('http://localhost:3000/api/developer/submit-property', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error('Failed to submit property')
      }

      setSubmitted(true)
      
      // Reset after 5 seconds
      setTimeout(() => {
        setSubmitted(false)
        setPdfFile(null)
        setExtractedData(null)
        setFormData({
          projectName: '',
          developer: '',
          address: '',
          minPrice: null,
          maxPrice: null,
          minArea: null,
          maxArea: null,
          minBedrooms: null,
          maxBedrooms: null,
          latitude: null,
          longitude: null,
          completionDate: '',
          launchDate: '',
          description: '',
          amenities: [],
          unitTypes: [],
          paymentPlan: [],
          images: {
            showcase: [],
            floorplans: [],
            amenities: []
          }
        })
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit property')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 text-white py-16"
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center space-x-3 mb-4">
            <Building2 className="h-8 w-8" />
            <h1 className="text-4xl md:text-5xl font-bold">
              Submit Your Property
            </h1>
          </div>
          <p className="text-xl text-amber-50 max-w-3xl">
            Upload your project PDF and our AI will automatically extract all the details. 
            Review and fill in any missing information before submission.
          </p>
        </div>
      </motion.div>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="text-center py-12">
                <CardContent>
                  <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-6" />
                  <h2 className="text-3xl font-bold text-slate-800 mb-4">
                    Property Submitted Successfully!
                  </h2>
                  <p className="text-lg text-slate-600 mb-2">
                    Your property has been added to our database.
                  </p>
                  <p className="text-slate-600">
                    It will be visible on the map and available for search immediately.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - PDF Upload */}
              <div className="lg:col-span-1">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <Card className="sticky top-24">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Upload PDF
                      </CardTitle>
                      <CardDescription>
                        Upload your project brochure or floor plan PDF
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* PDF Upload Area */}
                      <div
                        onDrop={handleFileDrop}
                        onDragOver={(e) => e.preventDefault()}
                        className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-amber-500 transition-colors cursor-pointer"
                      >
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={handleFileChange}
                          className="hidden"
                          id="pdf-upload"
                        />
                        <label htmlFor="pdf-upload" className="cursor-pointer">
                          <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                          <p className="text-slate-600 mb-2 font-medium">
                            {pdfFile ? pdfFile.name : 'Upload PDF Document'}
                          </p>
                          <p className="text-sm text-slate-500">
                            Drag and drop or click to browse
                          </p>
                        </label>
                      </div>

                      {/* Process Button */}
                      {pdfFile && !extractedData && (
                        <Button
                          onClick={handleProcessPdf}
                          disabled={isProcessing}
                          className="w-full"
                          size="lg"
                        >
                          {isProcessing ? (
                            <>
                              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                              Processing PDF...
                            </>
                          ) : (
                            <>
                              <FileText className="mr-2 h-5 w-5" />
                              Extract Data with AI
                            </>
                          )}
                        </Button>
                      )}

                      {/* Status Messages */}
                      <AnimatePresence>
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg"
                          >
                            <XCircle className="h-5 w-5 text-red-500" />
                            <p className="text-sm text-red-700">{error}</p>
                          </motion.div>
                        )}

                        {extractedData && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"
                          >
                            <CheckCircle className="h-5 w-5 text-green-500" />
                            <p className="text-sm text-green-700">
                              Data extracted successfully! Review and edit as needed.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Extracted Images Preview */}
                      {extractedData && (
                        <div className="space-y-3 pt-4 border-t">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">Extracted Images</span>
                            <ImageIcon className="h-4 w-4 text-slate-400" />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {extractedData.images.showcase.slice(0, 6).map((img, idx) => (
                              <div key={idx} className="aspect-square bg-slate-100 rounded border">
                                <img src={img} alt={`Extracted ${idx}`} className="w-full h-full object-cover rounded" />
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-slate-500 text-center">
                            {extractedData.images.showcase.length + extractedData.images.floorplans.length} images extracted
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </div>

              {/* Right Column - Form */}
              <div className="lg:col-span-2">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Property Details</CardTitle>
                      <CardDescription>
                        Review and complete the extracted information
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleSubmit} className="space-y-8">
                        {/* Basic Information */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold border-b pb-2">Basic Information</h3>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="projectName">Project Name *</Label>
                              <Input
                                id="projectName"
                                value={formData.projectName}
                                onChange={(e) => handleInputChange('projectName', e.target.value)}
                                placeholder="e.g., Binghatti Skyrise"
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="developer">Developer *</Label>
                              <Input
                                id="developer"
                                value={formData.developer}
                                onChange={(e) => handleInputChange('developer', e.target.value)}
                                placeholder="e.g., Binghatti"
                                required
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="address">Full Address *</Label>
                            <Input
                              id="address"
                              value={formData.address}
                              onChange={(e) => handleInputChange('address', e.target.value)}
                              placeholder="e.g., Business Bay, Dubai"
                              required
                            />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="latitude">Latitude</Label>
                              <Input
                                id="latitude"
                                type="number"
                                step="any"
                                value={formData.latitude || ''}
                                onChange={(e) => handleInputChange('latitude', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="25.1972"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="longitude">Longitude</Label>
                              <Input
                                id="longitude"
                                type="number"
                                step="any"
                                value={formData.longitude || ''}
                                onChange={(e) => handleInputChange('longitude', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="55.2744"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <textarea
                              id="description"
                              value={formData.description}
                              onChange={(e) => handleInputChange('description', e.target.value)}
                              placeholder="Project description..."
                              rows={4}
                              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                          </div>
                        </div>

                        {/* Pricing & Size */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold border-b pb-2">Pricing & Size</h3>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="minPrice">Min Price (AED)</Label>
                              <Input
                                id="minPrice"
                                type="number"
                                value={formData.minPrice || ''}
                                onChange={(e) => handleInputChange('minPrice', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="1000000"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="maxPrice">Max Price (AED)</Label>
                              <Input
                                id="maxPrice"
                                type="number"
                                value={formData.maxPrice || ''}
                                onChange={(e) => handleInputChange('maxPrice', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="5000000"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="minArea">Min Area (sqft)</Label>
                              <Input
                                id="minArea"
                                type="number"
                                value={formData.minArea || ''}
                                onChange={(e) => handleInputChange('minArea', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="422"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="maxArea">Max Area (sqft)</Label>
                              <Input
                                id="maxArea"
                                type="number"
                                value={formData.maxArea || ''}
                                onChange={(e) => handleInputChange('maxArea', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="1991"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="minBedrooms">Min Bedrooms</Label>
                              <Input
                                id="minBedrooms"
                                type="number"
                                value={formData.minBedrooms || ''}
                                onChange={(e) => handleInputChange('minBedrooms', e.target.value ? parseInt(e.target.value) : null)}
                                placeholder="0 (Studio)"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="maxBedrooms">Max Bedrooms</Label>
                              <Input
                                id="maxBedrooms"
                                type="number"
                                value={formData.maxBedrooms || ''}
                                onChange={(e) => handleInputChange('maxBedrooms', e.target.value ? parseInt(e.target.value) : null)}
                                placeholder="3"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Dates */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold border-b pb-2">Project Timeline</h3>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="launchDate">Launch Date</Label>
                              <Input
                                id="launchDate"
                                type="date"
                                value={formData.launchDate}
                                onChange={(e) => handleInputChange('launchDate', e.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="completionDate">Completion Date</Label>
                              <Input
                                id="completionDate"
                                type="date"
                                value={formData.completionDate}
                                onChange={(e) => handleInputChange('completionDate', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Amenities */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold border-b pb-2">Amenities</h3>
                          <div className="space-y-2">
                            <Label htmlFor="amenities">Amenities (comma-separated)</Label>
                            <Input
                              id="amenities"
                              value={formData.amenities.join(', ')}
                              onChange={(e) => handleAmenityChange(e.target.value)}
                              placeholder="e.g., Swimming Pool, Gym, Parking, Security"
                            />
                          </div>
                        </div>

                        {/* Unit Types */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b pb-2">
                            <h3 className="text-lg font-semibold">Unit Types</h3>
                            <Button type="button" onClick={addUnitType} size="sm" variant="outline">
                              + Add Unit Type
                            </Button>
                          </div>

                          {formData.unitTypes.map((unit, index) => (
                            <Card key={unit.id} className="p-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                  <Label className="font-semibold">Unit Type {index + 1}</Label>
                                  <Button
                                    type="button"
                                    onClick={() => removeUnitType(index)}
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-500 hover:text-red-700"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <Input
                                    placeholder="Name (e.g., Studio)"
                                    value={unit.name}
                                    onChange={(e) => handleUnitTypeChange(index, 'name', e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Bedrooms"
                                    value={unit.bedrooms || ''}
                                    onChange={(e) => handleUnitTypeChange(index, 'bedrooms', e.target.value ? parseInt(e.target.value) : null)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Min Area (sqft)"
                                    value={unit.minArea || ''}
                                    onChange={(e) => handleUnitTypeChange(index, 'minArea', e.target.value ? parseFloat(e.target.value) : null)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Max Area (sqft)"
                                    value={unit.maxArea || ''}
                                    onChange={(e) => handleUnitTypeChange(index, 'maxArea', e.target.value ? parseFloat(e.target.value) : null)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Min Price (AED)"
                                    value={unit.minPrice || ''}
                                    onChange={(e) => handleUnitTypeChange(index, 'minPrice', e.target.value ? parseFloat(e.target.value) : null)}
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Max Price (AED)"
                                    value={unit.maxPrice || ''}
                                    onChange={(e) => handleUnitTypeChange(index, 'maxPrice', e.target.value ? parseFloat(e.target.value) : null)}
                                  />
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>

                        {/* Payment Plan */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b pb-2">
                            <h3 className="text-lg font-semibold">Payment Plan</h3>
                            <Button type="button" onClick={addPaymentPlanItem} size="sm" variant="outline">
                              + Add Milestone
                            </Button>
                          </div>

                          {formData.paymentPlan.map((item, index) => (
                            <Card key={index} className="p-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                  <Label className="font-semibold">Milestone {index + 1}</Label>
                                  <Button
                                    type="button"
                                    onClick={() => removePaymentPlanItem(index)}
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-500 hover:text-red-700"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                  <Input
                                    placeholder="Milestone (e.g., Down Payment)"
                                    value={item.milestone}
                                    onChange={(e) => handlePaymentPlanChange(index, 'milestone', e.target.value)}
                                    className="col-span-2"
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Percentage"
                                    value={item.percentage}
                                    onChange={(e) => handlePaymentPlanChange(index, 'percentage', parseFloat(e.target.value))}
                                  />
                                  <Input
                                    type="date"
                                    placeholder="Date"
                                    value={item.date || ''}
                                    onChange={(e) => handlePaymentPlanChange(index, 'date', e.target.value)}
                                    className="col-span-3"
                                  />
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>

                        {/* Submit Button */}
                        <div className="pt-6 border-t">
                          <Button type="submit" size="lg" className="w-full">
                            Submit Property
                          </Button>
                          <p className="text-sm text-slate-600 text-center mt-4">
                            By submitting, you confirm that all information is accurate and you have rights to use the provided images.
                          </p>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
