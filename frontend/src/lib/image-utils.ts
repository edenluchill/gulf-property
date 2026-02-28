/**
 * Image Utilities
 *
 * Helper functions for responsive image loading
 *
 * Image variants:
 * - original: Full resolution (for lightbox/fullscreen)
 * - large: 1280x720 (detail pages & desktop)
 * - medium: 800x450 (tablet/cards)
 * - thumbnail: 400x225 (mobile previews)
 */

/**
 * Image size variants available
 */
export type ImageSize = 'original' | 'large' | 'medium' | 'thumbnail';

/**
 * Get responsive image URL for different sizes
 *
 * Backend stores images in format:
 * - filename_large.jpg (1280×720) - Detail pages & desktop
 * - filename_medium.jpg (800×450) - Tablet/cards
 * - filename_thumbnail.jpg (400×225) - Mobile previews
 *
 * @param imageUrl - Any image URL (any variant)
 * @param size - Desired size variant (default: 'large')
 * @returns URL for the requested size
 *
 * @example
 * ```ts
 * const url = "https://cdn.example.com/images/page_1_large.jpg"
 * getImageUrl(url, 'medium') // returns .../page_1_medium.jpg
 * getImageUrl(url, 'thumbnail') // returns .../page_1_thumbnail.jpg
 * ```
 */
export function getImageUrl(imageUrl: string, size: ImageSize = 'large'): string {
  if (!imageUrl) return '';

  // Replace any variant suffix with the requested size
  // Handles: _large, _medium, _thumbnail, _original (legacy)
  const variantPattern = /_(large|medium|thumbnail|original)\.(jpg|jpeg|png|webp)$/i;

  if (variantPattern.test(imageUrl)) {
    return imageUrl.replace(variantPattern, `_${size}.$2`);
  }

  // URL doesn't have variant suffix, return as-is
  return imageUrl;
}

/**
 * Get srcset string for responsive images
 *
 * @param imageUrl - Any image URL
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
export function getImageSrcSet(imageUrl: string): string {
  if (!imageUrl) return '';

  return [
    `${getImageUrl(imageUrl, 'thumbnail')} 400w`,
    `${getImageUrl(imageUrl, 'medium')} 800w`,
    `${getImageUrl(imageUrl, 'large')} 1280w`,
  ].join(', ');
}

/**
 * Get srcset string including original for high-res displays (lightbox)
 * Falls back gracefully if original doesn't exist (browser will use large)
 */
export function getImageSrcSetWithOriginal(imageUrl: string): string {
  if (!imageUrl) return '';

  return [
    `${getImageUrl(imageUrl, 'thumbnail')} 400w`,
    `${getImageUrl(imageUrl, 'medium')} 800w`,
    `${getImageUrl(imageUrl, 'large')} 1280w`,
    `${getImageUrl(imageUrl, 'original')} 2560w`,
  ].join(', ');
}

/**
 * Get the best available image URL with fallback
 * Tries original first, falls back to large
 * Use this for lightbox/fullscreen where you want highest quality
 */
export function getBestQualityUrl(imageUrl: string): string {
  // For now, return large as the safe default
  // The srcset will try to load original if available
  return getImageUrl(imageUrl, 'large');
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
  return 'large';
}

/**
 * Hook to get responsive image based on window width
 * Use with React components
 */
export function useResponsiveImage(imageUrl: string): string {
  // For SSR/initial render, default to medium
  if (typeof window === 'undefined') {
    return getImageUrl(imageUrl, 'medium');
  }

  const size = getOptimalImageSize(window.innerWidth);
  return getImageUrl(imageUrl, size);
}
