/**
 * Cloudinary Image Storage Service
 * 
 * Stores images on Cloudinary CDN
 * Professional solution with automatic optimization
 * Free tier: 25GB storage + 25GB bandwidth/month
 */

import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'

// Configure Cloudinary (will use env variables)
let isConfigured = false

function configureCloudinary() {
  if (isConfigured) return
  
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  
  if (!cloudName || !apiKey || !apiSecret) {
    console.warn('⚠️ Cloudinary not configured. Set CLOUDINARY_* env variables.')
    return false
  }
  
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  })
  
  isConfigured = true
  console.log('☁️ Cloudinary configured successfully')
  return true
}

/**
 * Upload image to Cloudinary
 */
export async function uploadImageCloudinary(
  imageBuffer: Buffer,
  originalName: string,
  category: 'showcase' | 'floorplan' | 'amenity' = 'showcase'
): Promise<string> {
  
  if (!configureCloudinary()) {
    throw new Error('Cloudinary not configured')
  }
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `gulf-property/${category}`,
        resource_type: 'image',
        format: 'webp', // Auto convert to WebP for better performance
        transformation: [
          { quality: 'auto', fetch_format: 'auto' }, // Auto optimize
        ],
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error)
          reject(error)
        } else if (result) {
          console.log('✅ Image uploaded to Cloudinary:', result.secure_url)
          resolve(result.secure_url)
        } else {
          reject(new Error('Upload failed'))
        }
      }
    )
    
    // Convert buffer to stream and pipe to Cloudinary
    const readableStream = new Readable()
    readableStream.push(imageBuffer)
    readableStream.push(null)
    readableStream.pipe(uploadStream)
  })
}

/**
 * Upload multiple images to Cloudinary
 */
export async function uploadImagesCloudinary(
  images: Array<{ buffer: Buffer; name: string; category?: 'showcase' | 'floorplan' | 'amenity' }>
): Promise<string[]> {
  const urls: string[] = []
  
  for (const image of images) {
    try {
      const url = await uploadImageCloudinary(image.buffer, image.name, image.category)
      urls.push(url)
    } catch (error) {
      console.error('Failed to upload image:', image.name, error)
      // Continue with other images
    }
  }
  
  return urls
}

/**
 * Delete image from Cloudinary
 */
export async function deleteImageCloudinary(publicId: string): Promise<void> {
  if (!configureCloudinary()) {
    throw new Error('Cloudinary not configured')
  }
  
  try {
    await cloudinary.uploader.destroy(publicId)
    console.log('🗑️ Image deleted from Cloudinary:', publicId)
  } catch (error) {
    console.error('Failed to delete image:', publicId, error)
    throw error
  }
}

/**
 * Get optimized URL with transformations
 */
export function getOptimizedImageUrl(
  url: string,
  options: {
    width?: number
    height?: number
    crop?: 'fill' | 'fit' | 'scale' | 'thumb'
    quality?: 'auto' | number
  } = {}
): string {
  if (!url.includes('cloudinary.com')) {
    return url // Not a Cloudinary URL
  }
  
  const transformations: string[] = []
  
  if (options.width) transformations.push(`w_${options.width}`)
  if (options.height) transformations.push(`h_${options.height}`)
  if (options.crop) transformations.push(`c_${options.crop}`)
  if (options.quality) transformations.push(`q_${options.quality}`)
  
  // Add transformations to URL
  const parts = url.split('/upload/')
  if (parts.length === 2) {
    return `${parts[0]}/upload/${transformations.join(',')}/${parts[1]}`
  }
  
  return url
}

/**
 * Generate thumbnail URL
 */
export function getThumbnailUrl(url: string): string {
  return getOptimizedImageUrl(url, {
    width: 300,
    height: 300,
    crop: 'fill',
    quality: 'auto',
  })
}

/**
 * Generate multiple sizes
 */
export function getResponsiveUrls(url: string) {
  return {
    thumbnail: getOptimizedImageUrl(url, { width: 300, height: 300, crop: 'fill' }),
    small: getOptimizedImageUrl(url, { width: 640, quality: 'auto' }),
    medium: getOptimizedImageUrl(url, { width: 1024, quality: 'auto' }),
    large: getOptimizedImageUrl(url, { width: 1920, quality: 'auto' }),
    original: url,
  }
}

/**
 * Test Cloudinary connection
 */
export async function testCloudinaryConnection(): Promise<boolean> {
  try {
    if (!configureCloudinary()) {
      return false
    }
    
    await cloudinary.api.ping()
    console.log('✅ Cloudinary connection successful')
    return true
  } catch (error) {
    console.error('❌ Cloudinary connection failed:', error)
    return false
  }
}
