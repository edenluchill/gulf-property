/**
 * Image Processing Utilities
 * 
 * Handles image cropping, resizing, and organization
 */

import sharp from 'sharp';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

/**
 * Bounding Box for cropping
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop an image based on bounding box coordinates
 * 
 * @param imagePath - Source image path
 * @param boundingBox - Crop coordinates
 * @param outputPath - Output file path
 * @returns Path to cropped image
 */
export async function cropImage(
  imagePath: string,
  boundingBox: BoundingBox,
  outputPath: string
): Promise<string> {
  try {
    await sharp(imagePath)
      .extract({
        left: Math.round(boundingBox.x),
        top: Math.round(boundingBox.y),
        width: Math.round(boundingBox.width),
        height: Math.round(boundingBox.height),
      })
      .toFile(outputPath);

    console.log(`Cropped image saved to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Error cropping image:', error);
    throw error;
  }
}

/**
 * Resize image while maintaining aspect ratio
 */
export async function resizeImage(
  imagePath: string,
  maxWidth: number,
  maxHeight: number,
  outputPath: string
): Promise<string> {
  try {
    await sharp(imagePath)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFile(outputPath);

    console.log(`Resized image saved to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Error resizing image:', error);
    throw error;
  }
}

/**
 * Organize images into categorized folders
 * 
 * @param imagePaths - Array of image paths to organize
 * @param categories - Category for each image (same length as imagePaths)
 * @param outputDir - Base output directory
 * @returns Map of category to organized image paths
 */
export async function organizeImages(
  imagePaths: string[],
  categories: string[],
  outputDir: string
): Promise<Record<string, string[]>> {
  if (imagePaths.length !== categories.length) {
    throw new Error('imagePaths and categories must have the same length');
  }

  const organized: Record<string, string[]> = {};

  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i];
    const category = categories[i];

    // Create category folder
    const categoryDir = join(outputDir, category.toLowerCase());
    if (!existsSync(categoryDir)) {
      mkdirSync(categoryDir, { recursive: true });
    }

    // Copy/move image to category folder
    const fileName = basename(imagePath);
    const newPath = join(categoryDir, fileName);
    
    try {
      copyFileSync(imagePath, newPath);
      
      if (!organized[category]) {
        organized[category] = [];
      }
      organized[category].push(newPath);
      
      console.log(`Organized ${fileName} into ${category}`);
    } catch (error) {
      console.error(`Error organizing ${fileName}:`, error);
    }
  }

  return organized;
}

/**
 * Convert image to base64 for API transmission
 */
export async function imageToBase64(imagePath: string): Promise<string> {
  try {
    const buffer = await sharp(imagePath).toBuffer();
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * Get image dimensions
 */
export async function getImageDimensions(
  imagePath: string
): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    throw error;
  }
}

/**
 * Optimize image for web (compress and convert to JPEG)
 */
export async function optimizeImage(
  imagePath: string,
  outputPath: string,
  quality: number = 85
): Promise<string> {
  try {
    await sharp(imagePath)
      .jpeg({ quality, progressive: true })
      .toFile(outputPath);

    console.log(`Optimized image saved to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Error optimizing image:', error);
    throw error;
  }
}

/**
 * Image size variant configuration
 */
export interface ImageVariant {
  name: 'original' | 'large' | 'medium' | 'thumbnail';
  width: number;
  height: number;
  quality: number;
}

export const IMAGE_VARIANTS: ImageVariant[] = [
  { name: 'original', width: 1920, height: 1080, quality: 90 },   // Full HD - detail pages
  { name: 'large', width: 1280, height: 720, quality: 85 },       // HD - desktop listings
  { name: 'medium', width: 800, height: 450, quality: 80 },       // Tablet/cards
  { name: 'thumbnail', width: 400, height: 225, quality: 75 },    // Mobile previews
];

/**
 * Generate multiple size variants of an image
 * Returns buffers for each variant (ready for R2 upload)
 * 
 * @param imagePath - Source image path
 * @returns Map of variant name to Buffer
 */
export async function generateImageVariants(
  imagePath: string
): Promise<Map<string, Buffer>> {
  const variants = new Map<string, Buffer>();

  try {
    console.log(`📐 Generating image variants for ${basename(imagePath)}...`);

    for (const variant of IMAGE_VARIANTS) {
      const buffer = await sharp(imagePath)
        .resize(variant.width, variant.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: variant.quality, progressive: true })
        .toBuffer();

      variants.set(variant.name, buffer);
      console.log(`   ✓ ${variant.name}: ${variant.width}×${variant.height} (${(buffer.length / 1024).toFixed(1)}KB)`);
    }

    console.log(`   ✅ Generated ${variants.size} variants`);
    return variants;
  } catch (error) {
    console.error('Error generating image variants:', error);
    throw error;
  }
}

/**
 * Generate variants from buffer (for in-memory processing)
 */
export async function generateImageVariantsFromBuffer(
  buffer: Buffer
): Promise<Map<string, Buffer>> {
  const variants = new Map<string, Buffer>();

  try {
    for (const variant of IMAGE_VARIANTS) {
      const resizedBuffer = await sharp(buffer)
        .resize(variant.width, variant.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: variant.quality, progressive: true })
        .toBuffer();

      variants.set(variant.name, resizedBuffer);
    }

    return variants;
  } catch (error) {
    console.error('Error generating image variants from buffer:', error);
    throw error;
  }
}