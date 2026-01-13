import { useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { Building2, Upload, CheckCircle } from 'lucide-react'

export default function DeveloperSubmitPage() {
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
              List Your Project
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-3xl">
            Are you a developer with an off-plan project in Dubai? Submit your project details 
            and reach international buyers looking for premium properties.
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
                    Thank You!
                  </h2>
                  <p className="text-lg text-slate-600 mb-2">
                    Your project submission has been received.
                  </p>
                  <p className="text-slate-600">
                    Our team will review your submission and contact you within 2-3 business days.
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
                  <CardTitle className="text-2xl">Project Information</CardTitle>
                  <CardDescription>
                    Please provide detailed information about your off-plan project. 
                    All fields are required unless marked as optional.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Project Details */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">Project Details</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="projectName">Project Name *</Label>
                          <Input
                            id="projectName"
                            name="projectName"
                            value={formData.projectName}
                            onChange={handleChange}
                            placeholder="e.g., Marina Heights Tower"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="developerName">Developer Name *</Label>
                          <Input
                            id="developerName"
                            name="developerName"
                            value={formData.developerName}
                            onChange={handleChange}
                            placeholder="e.g., Emaar Properties"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="location">Full Address *</Label>
                          <Input
                            id="location"
                            name="location"
                            value={formData.location}
                            onChange={handleChange}
                            placeholder="e.g., Dubai Marina, Dubai"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="district">District *</Label>
                          <Input
                            id="district"
                            name="district"
                            value={formData.district}
                            onChange={handleChange}
                            placeholder="e.g., Dubai Marina"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Pricing */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold">Pricing (AED)</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="minPrice">Minimum Price *</Label>
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
                          <Label htmlFor="maxPrice">Maximum Price *</Label>
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
                      <h3 className="text-lg font-semibold">Timeline</h3>
                      
                      <div className="space-y-2">
                        <Label htmlFor="completionDate">Expected Completion Date *</Label>
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
                      <h3 className="text-lg font-semibold">Contact Information</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="contactEmail">Email Address *</Label>
                          <Input
                            id="contactEmail"
                            name="contactEmail"
                            type="email"
                            value={formData.contactEmail}
                            onChange={handleChange}
                            placeholder="contact@developer.com"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contactPhone">Phone Number *</Label>
                          <Input
                            id="contactPhone"
                            name="contactPhone"
                            type="tel"
                            value={formData.contactPhone}
                            onChange={handleChange}
                            placeholder="+971 4 XXX XXXX"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="description">Project Description *</Label>
                      <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        placeholder="Provide a detailed description of your project, including key features, amenities, and unique selling points..."
                        required
                        rows={6}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>

                    {/* File Upload Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="text-lg font-semibold">Additional Materials (Optional)</h3>
                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-slate-400 transition-colors cursor-pointer">
                        <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-600 mb-2">
                          Upload project images, floor plans, or brochures
                        </p>
                        <p className="text-sm text-slate-500">
                          Drag and drop files here, or click to browse
                        </p>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-6">
                      <Button type="submit" size="lg" className="w-full">
                        Submit Project for Review
                      </Button>
                      <p className="text-sm text-slate-600 text-center mt-4">
                        By submitting this form, you agree to our terms and conditions. 
                        We will review your submission and contact you within 2-3 business days.
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
