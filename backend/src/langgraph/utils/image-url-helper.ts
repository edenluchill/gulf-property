/**
 * Image URL Helper
 * 
 * Converts R2 image paths to accessible URLs for frontend
 * ⚡ R2-ONLY: No legacy local file serving
 */

/**
 * Convert image path to R2 public URL
 * 
 * @param imagePath - R2 URL or local path (will be converted to R2 URL)
 * @param jobId - Job ID (used for R2 path construction if needed)
 * @returns R2 public URL
 */
export function convertImagePathToUrl(imagePath: string, jobId: string): string {
  // If already a full HTTPS URL (R2), return as-is
  if (imagePath.startsWith('https://')) {
    return imagePath;
  }
  
  // ⚠️ If it's still a local path or http://, it means R2 upload failed
  // This should not happen in production - log warning
  if (imagePath.startsWith('http://') || imagePath.includes('\\') || imagePath.includes('C:')) {
    console.warn(`⚠️ WARNING: Image path is not R2 URL: ${imagePath}`);
    console.warn(`   This means R2 upload failed. Image will not be accessible.`);
    
    // Return a placeholder or empty string (don't fallback to local API)
    return ''; // Frontend should handle empty image URLs gracefully
  }
  
  // If it's a relative path, assume it needs R2_PUBLIC_URL prefix
  const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
  if (!R2_PUBLIC_URL) {
    console.error('❌ ERROR: R2_PUBLIC_URL is not configured!');
    return '';
  }
  
  // Extract filename and construct R2 URL
  const parts = imagePath.split(/[/\\]/);
  const filename = parts[parts.length - 1];
  return `${R2_PUBLIC_URL}/temporary/${jobId}/images/${filename}`;
}

/**
 * Convert multiple image paths to URLs
 */
export function convertImagePathsToUrls(imagePaths: string[], jobId: string): string[] {
  return imagePaths.map(path => convertImagePathToUrl(path, jobId));
}

/**
 * Update building data with accessible image URLs
 * Converts file system paths to frontend-accessible URLs
 */
export function updateBuildingDataWithImageUrls(
  buildingData: any,
  jobId: string
): any {
  if (!buildingData) return buildingData;

  const updated = { ...buildingData };

  // Update images object if it exists
  if (updated.images) {
    if (updated.images.projectImages && Array.isArray(updated.images.projectImages)) {
      updated.images.projectImages = convertImagePathsToUrls(
        updated.images.projectImages,
        jobId
      );
    }

    if (updated.images.floorPlanImages && Array.isArray(updated.images.floorPlanImages)) {
      updated.images.floorPlanImages = convertImagePathsToUrls(
        updated.images.floorPlanImages,
        jobId
      );
    }

    if (updated.images.allImages && Array.isArray(updated.images.allImages)) {
      updated.images.allImages = updated.images.allImages.map((img: any) => {
        if (typeof img === 'string') {
          return convertImagePathToUrl(img, jobId);
        } else if (img.imagePath) {
          return {
            ...img,
            imagePath: convertImagePathToUrl(img.imagePath, jobId),
          };
        }
        return img;
      });
    }

    // Update byCategory if it exists
    if (updated.images.byCategory) {
      Object.keys(updated.images.byCategory).forEach(category => {
        const images = updated.images.byCategory[category];
        if (Array.isArray(images)) {
          updated.images.byCategory[category] = images.map((img: any) => {
            if (typeof img === 'string') {
              return convertImagePathToUrl(img, jobId);
            } else if (img.imagePath) {
              return {
                ...img,
                imagePath: convertImagePathToUrl(img.imagePath, jobId),
              };
            }
            return img;
          });
        }
      });
    }
  }

  // Update individual unit floor plan images
  if (updated.units && Array.isArray(updated.units)) {
    updated.units = updated.units.map((unit: any) => {
      if (unit.floorPlanImage && typeof unit.floorPlanImage === 'string') {
        return {
          ...unit,
          floorPlanImage: convertImagePathToUrl(unit.floorPlanImage, jobId),
        };
      }
      return unit;
    });
  }

  return updated;
}
