/**
 * Image URL Helper
 * 
 * Converts file system paths to accessible URLs for frontend
 */

/**
 * Convert local file path to API URL
 * 
 * @param imagePath - Local file path (e.g., "uploads/langgraph-output/job_123/images/page_71.png")
 * @param jobId - Job ID
 * @returns API URL (e.g., "/api/langgraph-images/job_123/page_71.png")
 */
export function convertImagePathToUrl(imagePath: string, jobId: string): string {
  // Extract filename from path
  const parts = imagePath.split(/[/\\]/);
  const filename = parts[parts.length - 1];
  
  // Build full URL (include backend URL for cross-origin access)
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  return `${backendUrl}/api/langgraph-images/${jobId}/${filename}`;
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
