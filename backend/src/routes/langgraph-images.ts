/**
 * LangGraph Images Serving Routes
 * 
 * Serves temporary images from PDF processing
 * Path: uploads/langgraph-output/{jobId}/chunk_*_temp/{filename}
 */

import { Router, Request, Response } from 'express';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const router = Router();

/**
 * GET /api/langgraph-images/:jobId/:filename
 * Serve temporary image from job directory
 * 
 * Searches in:
 * - uploads/langgraph-output/{jobId}/images/{filename}
 * - uploads/langgraph-output/{jobId}/chunk_*_temp/{filename}
 */
router.get('/:jobId/:filename', (req: Request, res: Response) => {
  try {
    const { jobId, filename } = req.params;
    
    // Security validation
    if (!jobId.match(/^job_[a-zA-Z0-9_-]+$/)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    
    if (!filename.match(/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg)$/)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const jobDir = join(process.cwd(), 'uploads', 'langgraph-output', jobId);
    
    // Build search paths
    const searchPaths: string[] = [
      join(jobDir, 'images', filename),
      join(jobDir, filename),
    ];
    
    // Search in all chunk_*_temp directories
    if (existsSync(jobDir)) {
      try {
        const files = readdirSync(jobDir);
        files.forEach(file => {
          if (file.startsWith('chunk_') && file.endsWith('_temp')) {
            searchPaths.push(join(jobDir, file, filename));
          }
        });
      } catch (err) {
        console.warn(`Failed to read job directory: ${jobDir}`, err);
      }
    }
    
    // Find and serve the image
    for (const path of searchPaths) {
      if (existsSync(path)) {
        try {
          const buffer = readFileSync(path);
          
          // Determine content type
          const ext = filename.split('.').pop()?.toLowerCase();
          const contentType = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
          }[ext || 'png'] || 'image/png';
          
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(buffer);
        } catch (readError) {
          console.error(`Failed to read image file: ${path}`, readError);
          continue;
        }
      }
    }
    
    // Image not found in any location
    console.warn(`Image not found: ${filename} in job ${jobId}`);
    console.warn(`Searched paths:`, searchPaths.slice(0, 3));
    return res.status(404).json({ 
      error: 'Image not found',
      filename,
      jobId,
    });
    
  } catch (error) {
    console.error('Error serving langgraph image:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
