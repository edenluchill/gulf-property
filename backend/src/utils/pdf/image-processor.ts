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
