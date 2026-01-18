/**
 * Permanent Images Serving Routes
 * 
 * Serves images that have been moved to permanent storage
 * Path: uploads/permanent/{projectId}/images/{filename}
 */

import { Router, Request, Response } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const router = Router();

/**
 * GET /api/images/permanent/:projectId/:filename
 * Serve permanent image from project directory
 */
router.get('/permanent/:projectId/:filename', async (req: Request, res: Response) => {
  try {
    const { projectId, filename } = req.params;

    // Validate project ID (UUID format)
    if (!projectId.match(/^[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    // Validate filename (security)
    if (!filename.match(/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|gif|webp)$/)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Build file path
    const imagePath = join(
      process.cwd(),
      'uploads',
      'permanent',
      projectId,
      'images',
      filename
    );

    // Check if file exists
    if (!existsSync(imagePath)) {
      console.error(`Image not found: ${imagePath}`);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Read image
    const imageBuffer = readFileSync(imagePath);

    // Determine content type
    const ext = filename.split('.').pop()?.toLowerCase();
    const contentType = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    }[ext || 'png'] || 'image/png';

    // Get file stats for caching
    const stats = statSync(imagePath);
    const lastModified = stats.mtime.toUTCString();

    // Set headers for caching (longer cache for permanent images)
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'Last-Modified': lastModified,
      'ETag': `"${projectId}-${filename}-${stats.mtime.getTime()}"`,
    });

    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${projectId}-${filename}-${stats.mtime.getTime()}"`) {
      return res.status(304).end();
    }

    res.send(imageBuffer);
  } catch (error) {
    console.error('Error serving permanent image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

export default router;
