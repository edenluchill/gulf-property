/**
 * File Management Utilities
 * 
 * Handles file system operations for the PDF processing workflow
 */

import { mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Create output directory structure for a PDF processing job
 * 
 * @param baseDir - Base output directory
 * @param jobId - Unique job identifier
 * @returns Object with paths to various output directories
 */
export function createOutputStructure(baseDir: string, jobId: string) {
  const jobDir = join(baseDir, jobId);
  const pagesDir = join(jobDir, 'pages');
  const categorizedDir = join(jobDir, 'categorized');
  const floorPlansDir = join(categorizedDir, 'floorplans');
  const renderingsDir = join(categorizedDir, 'renderings');
  const amenitiesDir = join(categorizedDir, 'amenities');
  const mapsDir = join(categorizedDir, 'maps');
  const coverDir = join(categorizedDir, 'cover');

  // Create all directories
  const dirs = [
    jobDir,
    pagesDir,
    categorizedDir,
    floorPlansDir,
    renderingsDir,
    amenitiesDir,
    mapsDir,
    coverDir,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return {
    jobDir,
    pagesDir,
    categorizedDir,
    floorPlansDir,
    renderingsDir,
    amenitiesDir,
    mapsDir,
    coverDir,
  };
}

/**
 * Clean up temporary files and directories
 * 
 * @param dirPath - Directory to clean
 * @param keepFiles - Whether to keep files (only remove if false)
 */
export function cleanupDirectory(dirPath: string, keepFiles: boolean = true) {
  if (!keepFiles && existsSync(dirPath)) {
    try {
      // Recursively delete directory and contents
      deleteFolderRecursive(dirPath);
      console.log(`Cleaned up directory: ${dirPath}`);
    } catch (error) {
      console.error(`Error cleaning up ${dirPath}:`, error);
    }
  }
}

/**
 * Recursively delete a directory and its contents
 */
function deleteFolderRecursive(dirPath: string) {
  if (existsSync(dirPath)) {
    readdirSync(dirPath).forEach((file) => {
      const curPath = join(dirPath, file);
      if (statSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        unlinkSync(curPath);
      }
    });
    rmdirSync(dirPath);
  }
}

/**
 * Get list of files in a directory
 * 
 * @param dirPath - Directory path
 * @param extension - Optional file extension filter (e.g., '.png')
 * @returns Array of file paths
 */
export function getFilesInDirectory(
  dirPath: string,
  extension?: string
): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const files = readdirSync(dirPath);
  const filePaths = files
    .filter((file) => {
      if (extension) {
        return file.toLowerCase().endsWith(extension.toLowerCase());
      }
      return true;
    })
    .map((file) => join(dirPath, file));

  return filePaths;
}

/**
 * Get file size in bytes
 */
export function getFileSize(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  const stats = statSync(filePath);
  return stats.size;
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Generate a unique job ID
 */
export function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}
