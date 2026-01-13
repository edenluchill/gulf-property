/**
 * Unified Image Storage Service
 * 
 * Automatically chooses the best storage method:
 * 1. Cloudinary (if configured) - Production
 * 2. Local storage (fallback) - Development
 */

import { saveImageLocal, saveImagesLocal, deleteImageLocal, deleteImagesLocal } from './image-storage-local'
import { uploadImageCloudinary, uploadImagesCloudinary, deleteImageCloudinary } from './image-storage-cloudinary'

// Check if Cloudinary is configured
function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  )
}

// Get preferred storage method
function getStorageMethod(): 'cloudinary' | 'local' {
  // Prefer Cloudinary in production if configured
  if (process.env.NODE_ENV === 'production' && isCloudinaryConfigured()) {
    return 'cloudinary'
  }
  
  // Use Cloudinary in development if configured
  if (isCloudinaryConfigured()) {
    return 'cloudinary'
  }
  
  // Fallback to local storage
  return 'local'
}

/**
 * Save single image - automatically chooses best method
 */
export async function saveImage(
  imageBuffer: Buffer,
  originalName: string,
  category: 'showcase' | 'floorplan' | 'amenity' = 'showcase'
): Promise<string> {
  const method = getStorageMethod()
  
  console.log(`📸 Using ${method} storage for: ${originalName}`)
  
  try {
    if (method === 'cloudinary') {
      return await uploadImageCloudinary(imageBuffer, originalName, category)
    } else {
      return await saveImageLocal(imageBuffer, originalName, category)
    }
  } catch (error) {
    console.error(`Failed to save image with ${method}, trying fallback...`, error)
    
    // Fallback to local if Cloudinary fails
    if (method === 'cloudinary') {
      console.log('Falling back to local storage')
      return await saveImageLocal(imageBuffer, originalName, category)
    }
    
    throw error
  }
}

/**
 * Save multiple images - automatically chooses best method
 */
export async function saveImages(
  images: Array<{ 
    buffer: Buffer
    name: string
    category?: 'showcase' | 'floorplan' | 'amenity' 
  }>
): Promise<string[]> {
  const method = getStorageMethod()
  
  console.log(`📸 Using ${method} storage for ${images.length} images`)
  
  try {
    if (method === 'cloudinary') {
      return await uploadImagesCloudinary(images)
    } else {
      return await saveImagesLocal(images)
    }
  } catch (error) {
    console.error(`Failed to save images with ${method}, trying fallback...`, error)
    
    // Fallback to local if Cloudinary fails
    if (method === 'cloudinary') {
      console.log('Falling back to local storage')
      return await saveImagesLocal(images)
    }
    
    throw error
  }
}

/**
 * Delete image - handles both storage methods
 */
export async function deleteImage(url: string): Promise<void> {
  if (url.includes('cloudinary.com')) {
    // Extract public_id from Cloudinary URL
    const parts = url.split('/')
    const filename = parts[parts.length - 1].split('.')[0]
    const folder = parts[parts.length - 2]
    const publicId = `${folder}/${filename}`
    
    await deleteImageCloudinary(publicId)
  } else {
    // Local storage - extract filename from URL
    const filename = url.split('/').pop()
    if (filename) {
      await deleteImageLocal(filename)
    }
  }
}

/**
 * Delete multiple images
 */
export async function deleteImages(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await deleteImage(url)
    } catch (error) {
      console.error('Failed to delete image:', url, error)
      // Continue with other images
    }
  }
}

/**
 * Get storage info
 */
export function getStorageInfo() {
  const method = getStorageMethod()
  const configured = isCloudinaryConfigured()
  
  return {
    method,
    cloudinaryConfigured: configured,
    nodeEnv: process.env.NODE_ENV || 'development',
    recommendation: configured ? 'Using Cloudinary (recommended)' : 'Using local storage (configure Cloudinary for production)',
  }
}

/**
 * Test storage connection
 */
export async function testStorage(): Promise<boolean> {
  const method = getStorageMethod()
  
  console.log(`Testing ${method} storage...`)
  
  try {
    // Create a test image buffer (1x1 transparent PNG)
    const testBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
    
    const url = await saveImage(testBuffer, 'test.png', 'showcase')
    console.log('✅ Storage test successful:', url)
    
    // Optionally delete test image
    // await deleteImage(url)
    
    return true
  } catch (error) {
    console.error('❌ Storage test failed:', error)
    return false
  }
}
