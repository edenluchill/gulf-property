import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getFavorites } from '../lib/favorites'
import { mockProjects } from '../data/mockProjects'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Heart, MapPin, Calendar, Building2 } from 'lucide-react'
import { formatPrice, formatDate } from '../lib/utils'
import { Project } from '../types'

export default function FavoritesPage() {
  const [favoriteProjects, setFavoriteProjects] = useState<Project[]>([])

  useEffect(() => {
    const favoriteIds = getFavorites()
    const projects = mockProjects.filter(p => favoriteIds.includes(p.id))
    setFavoriteProjects(projects)

    // Listen for storage changes
    const handleStorageChange = () => {
      const updatedIds = getFavorites()
      const updatedProjects = mockProjects.filter(p => updatedIds.includes(p.id))
      setFavoriteProjects(updatedProjects)
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

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
            <Heart className="h-8 w-8 fill-current" />
            <h1 className="text-4xl md:text-5xl font-bold">
              Your Favorites
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-3xl">
            Properties you've saved for later review. Keep track of your dream homes in Dubai.
          </p>
        </div>
      </motion.div>

      <div className="container mx-auto px-4 py-8">
        {favoriteProjects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center py-16"
          >
            <Heart className="h-24 w-24 text-slate-300 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-slate-700 mb-4">
              No favorites yet
            </h2>
            <p className="text-slate-600 mb-8">
              Start exploring properties and save your favorites for easy access later.
            </p>
            <Link to="/">
              <Button size="lg">
                Browse Properties
              </Button>
            </Link>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {favoriteProjects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Card className="h-full hover:shadow-xl transition-shadow overflow-hidden group">
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={project.images[0]}
                      alt={project.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute top-4 right-4">
                      <div className="bg-white rounded-full p-2 shadow-lg">
                        <Heart className="h-5 w-5 text-red-500 fill-current" />
                      </div>
                    </div>
                  </div>
                  <CardHeader>
                    <CardTitle className="text-xl">{project.name}</CardTitle>
                    <div className="flex items-center text-sm text-slate-600 mt-2">
                      <Building2 className="h-4 w-4 mr-1" />
                      <span>{project.developer}</span>
                    </div>
                    <div className="flex items-center text-sm text-slate-600 mt-1">
                      <MapPin className="h-4 w-4 mr-1" />
                      <span>{project.location.district}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="text-2xl font-bold text-primary">
                        {formatPrice(project.price.min)}
                      </div>
                      <div className="text-sm text-slate-600">
                        Starting price
                      </div>
                    </div>
                    
                    <div className="flex items-center text-sm text-slate-600">
                      <Calendar className="h-4 w-4 mr-1" />
                      <span>Completion: {formatDate(project.completionDate)}</span>
                    </div>

                    <div className="pt-4 border-t">
                      <Link to={`/project/${project.id}`}>
                        <Button className="w-full">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {favoriteProjects.length > 0 && (
          <div className="mt-8 text-center">
            <p className="text-slate-600 mb-4">
              You have {favoriteProjects.length} {favoriteProjects.length === 1 ? 'property' : 'properties'} saved
            </p>
            <Link to="/">
              <Button variant="outline">
                Browse More Properties
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
