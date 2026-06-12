/**
 * Render specific pages of a PDF to JPEG for visual inspection.
 *
 * Usage:
 *   cd backend && npx ts-node --transpile-only scripts/render-pdf-pages.ts <pdf-path> <outDir> <page> [page...]
 */
import * as fs from 'fs';
import * as path from 'path';
import { pdfPageToImage } from '../src/utils/pdf/converter';

async function main() {
  const [pdfPath, outDir, ...pages] = process.argv.slice(2);
  if (!pdfPath || !outDir || pages.length === 0) {
    console.error('Usage: render-pdf-pages.ts <pdf-path> <outDir> <page> [page...]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const buffer = fs.readFileSync(pdfPath);
  for (const p of pages) {
    const out = path.join(outDir, `page-${p}.jpg`);
    await pdfPageToImage(buffer, parseInt(p, 10), out);
    console.log(`Rendered page ${p} -> ${out}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
