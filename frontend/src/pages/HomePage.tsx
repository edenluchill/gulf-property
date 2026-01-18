import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { MapPin, Building2, TrendingUp, Shield, Search, Heart } from 'lucide-react'
import { Card } from '../components/ui/card'
import { useState, useEffect } from 'react'
import { fetchStats } from '../lib/api'

export default function HomePage() {
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalUnits: 0,
    developers: 0,
  })

  useEffect(() => {
    fetchStats().then((data) => {
      if (data) {
        setStats({
          totalProjects: parseInt(data.total_properties.toString()),
          totalUnits: 0, // Will calculate from properties if needed
          developers: parseInt(data.total_developers.toString()),
        })
      }
    })
  }, [])

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <motion.section
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white py-20 md:py-32 relative overflow-hidden"
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}></div>
        </div>

        {/* Dubai Skyline Silhouette */}
        <div className="absolute bottom-0 left-0 right-0 opacity-20">
          <svg viewBox="0 0 1200 200" className="w-full h-auto" preserveAspectRatio="none">
            <defs>
              <linearGradient id="building-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.2"/>
              </linearGradient>
            </defs>
            {/* Burj Khalifa inspired tower */}
            <polygon points="580,20 600,20 605,180 575,180" fill="url(#building-gradient)"/>
            <polygon points="585,10 595,10 600,20 580,20" fill="url(#building-gradient)"/>
            {/* Other buildings */}
            <rect x="100" y="100" width="60" height="80" fill="url(#building-gradient)"/>
            <rect x="180" y="80" width="50" height="100" fill="url(#building-gradient)"/>
            <rect x="250" y="110" width="45" height="70" fill="url(#building-gradient)"/>
            <rect x="320" y="90" width="55" height="90" fill="url(#building-gradient)"/>
            <rect x="400" y="70" width="48" height="110" fill="url(#building-gradient)"/>
            <rect x="470" y="100" width="52" height="80" fill="url(#building-gradient)"/>
            <rect x="650" y="95" width="50" height="85" fill="url(#building-gradient)"/>
            <rect x="720" y="85" width="55" height="95" fill="url(#building-gradient)"/>
            <rect x="800" y="105" width="45" height="75" fill="url(#building-gradient)"/>
            <rect x="870" y="75" width="50" height="105" fill="url(#building-gradient)"/>
            <rect x="945" y="90" width="48" height="90" fill="url(#building-gradient)"/>
            <rect x="1020" y="100" width="52" height="80" fill="url(#building-gradient)"/>
            <rect x="1090" y="110" width="45" height="70" fill="url(#building-gradient)"/>
            {/* Windows on buildings */}
            <g fill="#0ea5e9" opacity="0.6">
              <rect x="110" y="110" width="8" height="8"/>
              <rect x="125" y="110" width="8" height="8"/>
              <rect x="140" y="110" width="8" height="8"/>
              <rect x="110" y="125" width="8" height="8"/>
              <rect x="125" y="125" width="8" height="8"/>
              <rect x="140" y="125" width="8" height="8"/>
            </g>
          </svg>
        </div>

        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight"
            >
              Discover Dubai's Finest
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Off-Plan Properties
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-xl md:text-2xl text-slate-300 mb-12 max-w-3xl mx-auto"
            >
              Explore premium developments from the world's leading developers. 
              Make informed decisions with comprehensive project information and AI-powered insights.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            >
              <Link to="/map">
                <Button size="lg" className="text-lg px-8 py-6 bg-blue-600 hover:scale-110 hover:shadow-2xl transition-all duration-300">
                  <Search className="mr-2 h-5 w-5" />
                  Explore Properties
                </Button>
              </Link>
              <Link to="/developer/submit">
                <Button size="lg" className="text-lg px-8 py-6 bg-white/20 text-white border-2 border-white/50 backdrop-blur-sm hover:scale-110 hover:shadow-2xl transition-all duration-300">
                  <Building2 className="mr-2 h-5 w-5" />
                  For Developers
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* Stats Section */}
      <section className="py-12 bg-white border-b">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <div className="text-4xl font-bold text-slate-900 mb-2">{stats.totalProjects}</div>
              <div className="text-slate-600">Active Projects</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-center"
            >
              <div className="text-4xl font-bold text-slate-900 mb-2">{stats.totalProjects}+</div>
              <div className="text-slate-600">Available Properties</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-center"
            >
              <div className="text-4xl font-bold text-slate-900 mb-2">{stats.developers}</div>
              <div className="text-slate-600">Trusted Developers</div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
              Why Choose Nextway?
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Your trusted partner for finding the perfect off-plan property in Dubai
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <Card className="p-6 h-full hover:shadow-xl transition-shadow">
                <div className="bg-blue-100 rounded-full w-14 h-14 flex items-center justify-center mb-4">
                  <MapPin className="h-7 w-7 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-slate-900">Interactive Map</h3>
                <p className="text-slate-600">
                  Explore properties on an interactive map with detailed location information and pricing
                </p>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Card className="p-6 h-full hover:shadow-xl transition-shadow">
                <div className="bg-green-100 rounded-full w-14 h-14 flex items-center justify-center mb-4">
                  <TrendingUp className="h-7 w-7 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-slate-900">Market Insights</h3>
                <p className="text-slate-600">
                  Get AI-powered insights and comprehensive project information to make informed decisions
                </p>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card className="p-6 h-full hover:shadow-xl transition-shadow">
                <div className="bg-purple-100 rounded-full w-14 h-14 flex items-center justify-center mb-4">
                  <Shield className="h-7 w-7 text-purple-600" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-slate-900">Verified Listings</h3>
                <p className="text-slate-600">
                  All properties are from verified developers, ensuring authenticity and reliability
                </p>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <Card className="p-6 h-full hover:shadow-xl transition-shadow">
                <div className="bg-rose-100 rounded-full w-14 h-14 flex items-center justify-center mb-4">
                  <Heart className="h-7 w-7 text-rose-600" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-slate-900">Save Favorites</h3>
                <p className="text-slate-600">
                  Bookmark your favorite properties and compare them to find your perfect investment
                </p>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-cyan-600 text-white">
        <div className="container mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Ready to Find Your Dream Property?
            </h2>
            <p className="text-xl mb-8 text-blue-100 max-w-2xl mx-auto">
              Start exploring {stats.totalProjects} premium off-plan projects across Dubai today
            </p>
            <Link to="/map">
              <Button size="lg" variant="secondary" className="text-lg px-8 py-6">
                <MapPin className="mr-2 h-5 w-5" />
                View Interactive Map
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
