/**
 * PDF Text Layer Extraction
 *
 * Most developer brochures carry an embedded text layer. Extracting it is
 * nearly free (<1.5s, zero AI calls) and provides:
 * - Anti-hallucination evidence (developer name must appear in text)
 * - Data vision misses: completion dates, payment milestone dates,
 *   inventory tables, parking ratios, service charges, landmark distances
 * - Per-page assist text appended to extraction prompts
 *
 * Text must be extracted BEFORE chunking (workflow-executor clears
 * pdfBuffers after splitAllPdfsIntoChunks to free memory).
 */

async function getMupdf() {
  // Prevent TS from converting import() to require() (mupdf is ESM)
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  return dynamicImport('mupdf');
}

/**
 * Extract per-page text from a PDF buffer. Returns array indexed by page-1.
 * Never throws — pages that fail yield empty strings.
 */
export async function extractPdfTextPages(pdfBuffer: Buffer): Promise<string[]> {
  const pages: string[] = [];
  try {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const numPages = doc.countPages();

    for (let i = 0; i < numPages; i++) {
      try {
        const page = doc.loadPage(i);
        let text = '';
        const st = page.toStructuredText('preserve-whitespace');
        if (typeof st.asText === 'function') {
          text = st.asText();
        } else {
          const json = JSON.parse(st.asJSON());
          for (const block of json.blocks || []) {
            for (const line of block.lines || []) {
              text += (line.text || (line.spans || []).map((s: any) => s.text).join('')) + '\n';
            }
          }
        }
        st.destroy?.();
        page.destroy?.();
        pages.push(text.replace(/\s+\n/g, '\n').trim());
      } catch {
        pages.push('');
      }
    }
    doc.destroy?.();
  } catch (error) {
    console.warn(`   ⚠️  Text layer extraction failed: ${(error as Error).message}`);
  }
  return pages;
}

export interface PdfTextLayer {
  pdfHash: string;
  pdfName: string;
  pages: string[];
}

/**
 * Per-job registry so agents deep in the pipeline can read page text
 * without threading it through every call site.
 */
class TextLayerRegistryClass {
  private jobs = new Map<string, PdfTextLayer[]>();

  set(jobId: string, layers: PdfTextLayer[]): void {
    this.jobs.set(jobId, layers);
  }

  /** Page text for a specific PDF page (pageNum is 1-based within that PDF). */
  getPageText(jobId: string, pdfHash: string, pageNum: number): string | undefined {
    const layers = this.jobs.get(jobId);
    if (!layers) return undefined;
    const layer = layers.find(l => l.pdfHash === pdfHash);
    const text = layer?.pages[pageNum - 1];
    return text && text.length > 5 ? text : undefined;
  }

  /** Full labeled text across all PDFs of the job (for the project-level pass). */
  getFullText(jobId: string): string {
    const layers = this.jobs.get(jobId) || [];
    const parts: string[] = [];
    for (const layer of layers) {
      layer.pages.forEach((text, idx) => {
        if (text && text.length > 5) {
          parts.push(`[${layer.pdfName} | Page ${idx + 1}]\n${text}`);
        }
      });
    }
    return parts.join('\n\n');
  }

  delete(jobId: string): void {
    this.jobs.delete(jobId);
  }
}

export const TextLayerRegistry = new TextLayerRegistryClass();

/**
 * Normalized haystack check: does `needle` appear in the text layer?
 * Used as hallucination guard (e.g. developer names).
 */
export function appearsInText(fullText: string, needle: string): boolean {
  if (!needle || needle.length < 3) return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9一-鿿]+/g, ' ').trim();
  const hay = norm(fullText);
  const n = norm(needle);
  if (!n) return false;
  if (hay.includes(n)) return true;
  // Tolerate suffix differences ("IMAN DEVELOPERS" vs "Iman"): match first
  // significant word if it's distinctive enough
  const firstWord = n.split(' ')[0];
  const GENERIC = new Set(['THE', 'AL', 'DUBAI', 'EMAAR_PLACEHOLDER']);
  if (firstWord.length >= 4 && !GENERIC.has(firstWord)) {
    return new RegExp(`\\b${firstWord}\\b`).test(hay);
  }
  return false;
}

/** Trim page text for prompt embedding. */
export function clipForPrompt(text: string | undefined, maxChars = 1200): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (t.length === 0) return undefined;
  return t.length > maxChars ? t.slice(0, maxChars) + '\n…(truncated)' : t;
}
