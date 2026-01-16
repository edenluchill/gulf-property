/**
 * LangGraph Image Serving Routes
 * 
 * Serves images extracted from PDF processing
 * Path: uploads/langgraph-output/{jobId}/images/{filename}
 */

import { Router, Request, Response } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const router = Router();

/**
 * GET /api/langgraph-images/:jobId/:filename
 * Serve image from specific job's output directory
 */
router.get('/:jobId/:filename', async (req: Request, res: Response) => {
  try {
    const { jobId, filename } = req.params;

    // Validate job ID format
    if (!jobId.match(/^[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    // Validate filename (security) - allow dots in filename
    if (!filename.match(/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|gif|webp)$/)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Build file path
    const imagePath = join(
      process.cwd(),
      'uploads',
      'langgraph-output',
      jobId,
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

    // Set headers for caching
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400', // Cache for 1 day
      'Last-Modified': lastModified,
      'ETag': `"${jobId}-${filename}-${stats.mtime.getTime()}"`,
    });

    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${jobId}-${filename}-${stats.mtime.getTime()}"`) {
      return res.status(304).end();
    }

    res.send(imageBuffer);
  } catch (error) {
    console.error('Error serving langgraph image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

/**
 * GET /api/langgraph-images/:jobId
 * List all images for a specific job
 */
router.get('/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Validate job ID format
    if (!jobId.match(/^[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const imagesDir = join(
      process.cwd(),
      'uploads',
      'langgraph-output',
      jobId,
      'images'
    );

    if (!existsSync(imagesDir)) {
      return res.json({ images: [], total: 0 });
    }

    // List all images
    const fs = require('fs');
    const files = fs.readdirSync(imagesDir);
    const imageFiles = files.filter((file: string) => 
      file.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );

    const images = imageFiles.map((file: string) => ({
      filename: file,
      url: `/api/langgraph-images/${jobId}/${file}`,
      pageNumber: extractPageNumber(file),
    }));

    res.json({ 
      jobId,
      images, 
      total: images.length 
    });
  } catch (error) {
    console.error('Error listing langgraph images:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

/**
 * Extract page number from filename (e.g., "page_71.png" -> 71)
 */
function extractPageNumber(filename: string): number | undefined {
  const match = filename.match(/page[_-]?(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

export default router;
