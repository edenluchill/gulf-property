/**
 * Image Utilities
 * 
 * Helper functions for responsive image loading
 */

/**
 * Image size variants available
 */
export type ImageSize = 'original' | 'large' | 'medium' | 'thumbnail';

/**
 * Get responsive image URL for different sizes
 * 
 * Backend stores images in format:
 * - filename_original.jpg (1920×1080) - Full quality
 * - filename_large.jpg (1280×720) - Desktop
 * - filename_medium.jpg (800×450) - Tablet
 * - filename_thumbnail.jpg (400×225) - Mobile
 * 
 * @param originalUrl - Original image URL
 * @param size - Desired size variant
 * @returns URL for the requested size
 * 
 * @example
 * ```ts
 * const url = "https://cdn.example.com/images/project_123_original.jpg"
 * getImageUrl(url, 'medium') // returns .../project_123_medium.jpg
 * getImageUrl(url, 'thumbnail') // returns .../project_123_thumbnail.jpg
 * ```
 */
export function getImageUrl(originalUrl: string, size: ImageSize = 'original'): string {
  if (!originalUrl) return '';
  
  // If already requesting original, or URL doesn't have _original suffix, return as-is
  if (size === 'original' || !originalUrl.includes('_original.')) {
    return originalUrl;
  }
  
  // Replace _original with the requested size
  return originalUrl.replace('_original.', `_${size}.`);
}

/**
 * Get srcset string for responsive images
 * 
 * @param originalUrl - Original image URL
 * @returns srcset string for <img> tag
 * 
 * @example
 * ```tsx
 * <img 
 *   src={getImageUrl(url, 'medium')} 
 *   srcSet={getImageSrcSet(url)}
 *   sizes="(max-width: 640px) 400px, (max-width: 1024px) 800px, 1280px"
 * />
 * ```
 */
export function getImageSrcSet(originalUrl: string): string {
  if (!originalUrl || !originalUrl.includes('_original.')) {
    return originalUrl;
  }
  
  return [
    `${getImageUrl(originalUrl, 'thumbnail')} 400w`,
    `${getImageUrl(originalUrl, 'medium')} 800w`,
    `${getImageUrl(originalUrl, 'large')} 1280w`,
    `${getImageUrl(originalUrl, 'original')} 1920w`,
  ].join(', ');
}

/**
 * Preload critical images for faster page loads
 * 
 * @param urls - Array of image URLs to preload
 * @param size - Size variant to preload (default: 'medium')
 */
export function preloadImages(urls: string[], size: ImageSize = 'medium'): void {
  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = getImageUrl(url, size);
    document.head.appendChild(link);
  });
}

/**
 * Get optimal image size based on container width
 * 
 * @param containerWidth - Width of the container in pixels
 * @returns Optimal image size variant
 */
export function getOptimalImageSize(containerWidth: number): ImageSize {
  if (containerWidth <= 400) return 'thumbnail';
  if (containerWidth <= 800) return 'medium';
  if (containerWidth <= 1280) return 'large';
  return 'original';
}

/**
 * Hook to get responsive image based on window width
 * Use with React components
 */
export function useResponsiveImage(originalUrl: string): string {
  // For SSR/initial render, default to medium
  if (typeof window === 'undefined') {
    return getImageUrl(originalUrl, 'medium');
  }
  
  const size = getOptimalImageSize(window.innerWidth);
  return getImageUrl(originalUrl, size);
}
