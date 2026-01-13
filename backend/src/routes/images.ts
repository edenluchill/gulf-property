/**
 * Image serving routes
 * Serves images from local storage
 */

import { Router, Request, Response } from 'express'
import { getImageLocal, getImageMetadata, listImagesLocal } from '../services/image-storage-local'

const router = Router()

// GET /api/images/:filename - Serve image
router.get('/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params
    
    // Validate filename (security)
    if (!filename.match(/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/)) {
      return res.status(400).json({ error: 'Invalid filename' })
    }
    
    const imageBuffer = await getImageLocal(filename)
    
    // Determine content type
    const ext = filename.split('.').pop()?.toLowerCase()
    const contentType = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    }[ext || 'jpg'] || 'image/jpeg'
    
    // Set headers for caching
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'ETag': filename, // Use filename as ETag for caching
    })
    
    res.send(imageBuffer)
  } catch (error) {
    console.error('Error serving image:', error)
    res.status(404).json({ error: 'Image not found' })
  }
})

// GET /api/images - List all images (admin only)
router.get('/', async (req: Request, res: Response) => {
  try {
    const images = await listImagesLocal()
    res.json({ images, total: images.length })
  } catch (error) {
    console.error('Error listing images:', error)
    res.status(500).json({ error: 'Failed to list images' })
  }
})

// GET /api/images/:filename/metadata - Get image metadata
router.get('/:filename/metadata', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params
    const metadata = await getImageMetadata(filename)
    res.json(metadata)
  } catch (error) {
    console.error('Error getting image metadata:', error)
    res.status(404).json({ error: 'Image not found' })
  }
})

export default router
