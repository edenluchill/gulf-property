/**
 * PDF to Image Conversion using Poppler (pdftoppm)
 *
 * Poppler is the most reliable PDF rendering library.
 * Native C++ with excellent memory management - handles large JPEG2000 without issues.
 *
 * Install on Windows: choco install poppler
 * Install on macOS: brew install poppler
 * Install on Linux: apt install poppler-utils
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

/**
 * Check if Poppler (pdftoppm) is installed
 */
export async function isPopplerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('pdftoppm', ['-v'], { shell: true });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 || code === 1)); // -v returns 1 on some versions

    // Timeout after 3 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 3000);
  });
}

/**
 * Convert PDF buffer to images using Poppler (pdftoppm)
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param outputDir - Directory to save images
 * @param options - Conversion options
 * @returns Array of image file paths
 */
export async function pdfToImagesPoppler(
  pdfBuffer: Buffer,
  outputDir: string,
  options: {
    dpi?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    prefix?: string;
  } = {}
): Promise<string[]> {
  const {
    dpi = 96,
    format = 'jpeg',
    quality = 80,
    prefix = 'page'
  } = options;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write PDF to temp file (pdftoppm requires file input)
  const tempPdfPath = join(tmpdir(), `pdf-${randomUUID()}.pdf`);
  await writeFile(tempPdfPath, pdfBuffer);

  console.log(`Converting PDF to images using Poppler (dpi: ${dpi}, format: ${format})...`);
  const startTime = Date.now();

  try {
    // Build pdftoppm arguments
    const outputPrefix = join(outputDir, prefix);
    const args: string[] = [
      '-r', String(dpi),  // Resolution (DPI)
    ];

    if (format === 'jpeg') {
      args.push('-jpeg');
      args.push('-jpegopt', `quality=${quality}`);
    } else {
      args.push('-png');
    }

    // Add input and output
    args.push(tempPdfPath, outputPrefix);

    // Execute pdftoppm
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('pdftoppm', args, { shell: true });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start pdftoppm: ${err.message}. Is Poppler installed?`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pdftoppm exited with code ${code}: ${stderr}`));
        }
      });
    });

    // Collect output files
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const files = readdirSync(outputDir)
      .filter(f => f.startsWith(prefix) && f.endsWith(`.${ext}`))
      .sort((a, b) => {
        // Sort by page number
        const numA = parseInt(a.match(/-(\d+)\./)?.[1] || '0');
        const numB = parseInt(b.match(/-(\d+)\./)?.[1] || '0');
        return numA - numB;
      });

    // Rename files to consistent format (page.1.jpeg, page.2.jpeg, ...)
    const imagePaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const oldPath = join(outputDir, files[i]);
      const newName = `${prefix}.${i + 1}.${format}`;
      const newPath = join(outputDir, newName);

      // Rename if needed
      if (oldPath !== newPath) {
        const { rename } = await import('fs/promises');
        await rename(oldPath, newPath);
      }

      imagePaths.push(newPath);
    }

    const totalTime = Date.now() - startTime;
    console.log(`   ✅ Poppler converted ${imagePaths.length} pages in ${(totalTime / 1000).toFixed(2)}s`);

    return imagePaths;

  } finally {
    // Clean up temp PDF
    try {
      await unlink(tempPdfPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get PDF page count using Poppler (pdfinfo)
 */
export async function getPdfPageCountPoppler(pdfBuffer: Buffer): Promise<number> {
  // Write PDF to temp file
  const tempPdfPath = join(tmpdir(), `pdf-${randomUUID()}.pdf`);
  await writeFile(tempPdfPath, pdfBuffer);

  try {
    return await new Promise<number>((resolve, reject) => {
      const proc = spawn('pdfinfo', [tempPdfPath], { shell: true });

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start pdfinfo: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const match = stdout.match(/Pages:\s*(\d+)/);
          if (match) {
            resolve(parseInt(match[1]));
          } else {
            reject(new Error('Could not parse page count from pdfinfo output'));
          }
        } else {
          reject(new Error(`pdfinfo exited with code ${code}`));
        }
      });
    });
  } finally {
    try {
      await unlink(tempPdfPath);
    } catch (e) {
      // Ignore
    }
  }
}
