import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import dotenv from 'dotenv'
import projectsRouter from './routes/projects'
import propertiesRouter from './routes/properties'
import submissionsRouter from './routes/submissions'
import { createDeveloperRouter } from './routes/developer'
import { createResidentialProjectsRouter } from './routes/residential-projects'
import langgraphRouter from './routes/langgraph-processor'
import langgraphProgressRouter from './routes/langgraph-progress'
import langgraphValidateRouter from './routes/langgraph-validate'
import dubaiAreasLandmarksRouter from './routes/dubai-areas-landmarks'
import uploadRouter from './routes/upload'
import pool from './db/pool'

dotenv.config()

const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(helmet())

// CORS configuration - whitelisted origins
const allowedOrigins = [
  'https://gulf-property.com',
  'https://www.gulf-property.com',
  'http://localhost:5173',  // For local development
  'http://localhost:5174',  // Alternative local port
]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(morgan('dev'))
// Increase body size limit for large PDF uploads (up to 500MB)
// Note: If using Cloudflare proxy, Free plan limits to 100MB
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ extended: true, limit: '500mb' }))

// Rate limiting disabled - No restrictions
console.log('⚠️  Rate limiting disabled for all environments')

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected'
    })
  }
})

// Routes
app.use('/api/projects', projectsRouter)
app.use('/api/properties', propertiesRouter)  // New off-plan properties API with map search
app.use('/api/submissions', submissionsRouter)
app.use('/api/developer', createDeveloperRouter(pool))  // Developer property submission with AI PDF processing
app.use('/api/residential-projects', createResidentialProjectsRouter(pool))  // New residential projects API
app.use('/api/langgraph', langgraphRouter)  // LangGraph multi-agent PDF processor
app.use('/api/langgraph-progress', langgraphProgressRouter)  // LangGraph with real-time progress
app.use('/api/langgraph', langgraphValidateRouter)  // Result validation
app.use('/api/dubai', dubaiAreasLandmarksRouter)  // Dubai areas and landmarks overlay
app.use('/api/upload', uploadRouter)  // File upload to R2

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  })
})

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🌐 CORS enabled for: ${allowedOrigins.join(', ')}`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  await pool.end()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server')
  await pool.end()
  process.exit(0)
})

export default app
