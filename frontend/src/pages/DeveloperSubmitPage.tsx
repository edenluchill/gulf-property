import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Building2, Upload, CheckCircle } from 'lucide-react'

export default function DeveloperSubmitPage() {
  const { t } = useTranslation('developer')
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    projectName: '',
    developerName: '',
    location: '',
    district: '',
    minPrice: '',
    maxPrice: '',
    completionDate: '',
    contactEmail: '',
    contactPhone: '',
    description: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Here you would send the data to your backend
    console.log('Form submitted:', formData)
    setSubmitted(true)
    
    // Reset form after 3 seconds
    setTimeout(() => {
      setSubmitted(false)
      setFormData({
        projectName: '',
        developerName: '',
        location: '',
        district: '',
        minPrice: '',
        maxPrice: '',
        completionDate: '',
        contactEmail: '',
        contactPhone: '',
        description: '',
      })
    }, 3000)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-16"
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center space-x-3 mb-4">
            <Building2 className="h-8 w-8" />
            <h1 className="text-4xl md:text-5xl font-bold">
              {t('title')}
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-3xl">
            {t('subtitle')}
          </p>
        </div>
      </motion.div>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
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
                    {t('success.title')}
                  </h2>
                  <p className="text-lg text-slate-600 mb-2">
                    {t('success.received')}
                  </p>
                  <p className="text-slate-600">
                    {t('success.review')}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">{t('form.projectInfo')}</CardTitle>
                  <CardDescription>
                    {t('form.projectInfoDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Project Details */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">{t('form.projectDetails')}</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="projectName">{t('form.projectName')}</Label>
                          <Input
                            id="projectName"
                            name="projectName"
                            value={formData.projectName}
                            onChange={handleChange}
                            placeholder={t('form.projectNamePlaceholder')}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="developerName">{t('form.developerName')}</Label>
                          <Input
                            id="developerName"
                            name="developerName"
                            value={formData.developerName}
                            onChange={handleChange}
                            placeholder={t('form.developerNamePlaceholder')}
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="location">{t('form.fullAddress')}</Label>
                          <Input
                            id="location"
                            name="location"
                            value={formData.location}
                            onChange={handleChange}
                            placeholder={t('form.fullAddressPlaceholder')}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="district">{t('form.district')}</Label>
                          <Input
                            id="district"
                            name="district"
                            value={formData.district}
                            onChange={handleChange}
                            placeholder={t('form.districtPlaceholder')}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Pricing */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">{t('form.pricing')}</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="minPrice">{t('form.minPrice')}</Label>
                          <Input
                            id="minPrice"
                            name="minPrice"
                            type="number"
                            value={formData.minPrice}
                            onChange={handleChange}
                            placeholder="1500000"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="maxPrice">{t('form.maxPrice')}</Label>
                          <Input
                            id="maxPrice"
                            name="maxPrice"
                            type="number"
                            value={formData.maxPrice}
                            onChange={handleChange}
                            placeholder="8000000"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">{t('form.timeline')}</h3>
                      
                      <div className="space-y-2">
                        <Label htmlFor="completionDate">{t('form.expectedCompletion')}</Label>
                        <Input
                          id="completionDate"
                          name="completionDate"
                          type="date"
                          value={formData.completionDate}
                          onChange={handleChange}
                          required
                        />
                      </div>
                    </div>

                    {/* Contact Information */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">{t('form.contactInfo')}</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="contactEmail">{t('form.email')}</Label>
                          <Input
                            id="contactEmail"
                            name="contactEmail"
                            type="email"
                            value={formData.contactEmail}
                            onChange={handleChange}
                            placeholder={t('form.emailPlaceholder')}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contactPhone">{t('form.phone')}</Label>
                          <Input
                            id="contactPhone"
                            name="contactPhone"
                            type="tel"
                            value={formData.contactPhone}
                            onChange={handleChange}
                            placeholder={t('form.phonePlaceholder')}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="description">{t('form.projectDescription')}</Label>
                      <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        placeholder={t('form.projectDescriptionPlaceholder')}
                        required
                        rows={6}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>

                    {/* File Upload Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="text-lg font-semibold">{t('form.additionalMaterials')}</h3>
                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-slate-400 transition-colors cursor-pointer">
                        <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-600 mb-2">
                          {t('form.uploadPrompt')}
                        </p>
                        <p className="text-sm text-slate-500">
                          {t('form.dragDrop')}
                        </p>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-6">
                      <Button type="submit" size="lg" className="w-full">
                        {t('form.submitBtn')}
                      </Button>
                      <p className="text-sm text-slate-600 text-center mt-4">
                        {t('form.submitDisclaimer')}
                      </p>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
