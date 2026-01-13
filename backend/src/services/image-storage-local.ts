/**
 * Local Image Storage Service
 * 
 * Stores images on the local server filesystem
 * Quick to implement, good for development
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'

// Upload directory
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'images')

// Ensure upload directory exists
export async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    console.log('📁 Upload directory ready:', UPLOAD_DIR)
  } catch (error) {
    console.error('Failed to create upload directory:', error)
    throw error
  }
}

/**
 * Save image to local storage
 */
export async function saveImageLocal(
  imageBuffer: Buffer,
  originalName: string,
  category: 'showcase' | 'floorplan' | 'amenity' = 'showcase'
): Promise<string> {
  try {
    // Generate unique filename
    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg'
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8)
    const filename = `${category}_${Date.now()}_${hash}.${ext}`
    
    // Full path
    const filepath = join(UPLOAD_DIR, filename)
    
    // Save file
    await fs.writeFile(filepath, imageBuffer)
    
    console.log('✅ Image saved:', filename)
    
    // Return URL path (for frontend to access)
    return `/api/images/${filename}`
  } catch (error) {
    console.error('Failed to save image:', error)
    throw error
  }
}

/**
 * Save multiple images
 */
export async function saveImagesLocal(
  images: Array<{ buffer: Buffer; name: string; category?: 'showcase' | 'floorplan' | 'amenity' }>
): Promise<string[]> {
  const urls: string[] = []
  
  for (const image of images) {
    try {
      const url = await saveImageLocal(image.buffer, image.name, image.category)
      urls.push(url)
    } catch (error) {
      console.error('Failed to save image:', image.name, error)
      // Continue with other images
    }
  }
  
  return urls
}

/**
 * Get image from local storage
 */
export async function getImageLocal(filename: string): Promise<Buffer> {
  const filepath = join(UPLOAD_DIR, filename)
  
  try {
    const buffer = await fs.readFile(filepath)
    return buffer
  } catch (error) {
    console.error('Failed to read image:', filename, error)
    throw new Error('Image not found')
  }
}

/**
 * Delete image from local storage
 */
export async function deleteImageLocal(filename: string): Promise<void> {
  const filepath = join(UPLOAD_DIR, filename)
  
  try {
    await fs.unlink(filepath)
    console.log('🗑️ Image deleted:', filename)
  } catch (error) {
    console.error('Failed to delete image:', filename, error)
    throw error
  }
}

/**
 * Delete multiple images
 */
export async function deleteImagesLocal(filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    try {
      await deleteImageLocal(filename)
    } catch (error) {
      console.error('Failed to delete image:', filename, error)
      // Continue with other images
    }
  }
}

/**
 * Get image metadata
 */
export async function getImageMetadata(filename: string) {
  const filepath = join(UPLOAD_DIR, filename)
  
  try {
    const stats = await fs.stat(filepath)
    return {
      filename,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    }
  } catch (error) {
    throw new Error('Image not found')
  }
}

/**
 * List all images
 */
export async function listImagesLocal(): Promise<string[]> {
  try {
    const files = await fs.readdir(UPLOAD_DIR)
    return files.filter(file => {
      const ext = file.split('.').pop()?.toLowerCase()
      return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')
    })
  } catch (error) {
    console.error('Failed to list images:', error)
    return []
  }
}

/**
 * Clean up old images (older than specified days)
 */
export async function cleanupOldImages(daysOld: number = 30): Promise<number> {
  try {
    const files = await listImagesLocal()
    const now = Date.now()
    const maxAge = daysOld * 24 * 60 * 60 * 1000
    let deleted = 0
    
    for (const file of files) {
      const metadata = await getImageMetadata(file)
      const age = now - metadata.created.getTime()
      
      if (age > maxAge) {
        await deleteImageLocal(file)
        deleted++
      }
    }
    
    console.log(`🧹 Cleaned up ${deleted} old images`)
    return deleted
  } catch (error) {
    console.error('Failed to cleanup images:', error)
    return 0
  }
}
