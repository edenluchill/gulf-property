/**
 * Success Card - Displayed after successful submission
 */

import { motion } from 'framer-motion'
import { Card, CardContent } from '../ui/card'
import { CheckCircle, Loader2 } from 'lucide-react'

interface SuccessCardProps {
  title?: string
  subtitle?: string
}

export function SuccessCard({
  title = 'Project Submitted!',
  subtitle = 'Redirecting...',
}: SuccessCardProps) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
      <Card className="text-center py-16 shadow-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
        <CardContent>
          <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-2 text-gray-900">{title}</h2>
          <p className="text-gray-600">{subtitle}</p>
          <Loader2 className="h-6 w-6 mx-auto mt-4 animate-spin text-teal-600" />
        </CardContent>
      </Card>
    </motion.div>
  )
}
