import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import projectsRouter from './routes/projects'
import propertiesRouter from './routes/properties'
import submissionsRouter from './routes/submissions'
import { createDeveloperRouter } from './routes/developer'
import { createResidentialProjectsRouter } from './routes/residential-projects'
import imagesRouter from './routes/images'
import langgraphRouter from './routes/langgraph-processor'
import langgraphProgressRouter from './routes/langgraph-progress'
import langgraphValidateRouter from './routes/langgraph-validate'
import langgraphImagesRouter from './routes/langgraph-images'
import dubaiAreasLandmarksRouter from './routes/dubai-areas-landmarks'
import pool from './db/pool'
import { ensureUploadDir } from './services/image-storage-local'

dotenv.config()

const app: Application = express()
const PORT = process.env.PORT || 3000

// Ensure upload directory exists
ensureUploadDir().catch(console.error)

// Middleware
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}))
app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

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
app.use('/api/images', imagesRouter)  // Image serving
app.use('/api/langgraph', langgraphRouter)  // LangGraph multi-agent PDF processor
app.use('/api/langgraph-progress', langgraphProgressRouter)  // LangGraph with real-time progress
app.use('/api/langgraph', langgraphValidateRouter)  // Result validation
app.use('/api/langgraph-images', langgraphImagesRouter)  // LangGraph extracted images
app.use('/api/dubai', dubaiAreasLandmarksRouter)  // Dubai areas and landmarks overlay

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
  console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`)
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
