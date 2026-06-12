/**
 * Experiment: what does the PDF text layer contain that vision extraction misses?
 *
 * Dumps per-page text for each PDF and scans for high-value patterns:
 * dates (handover/completion), developer mentions, service charge,
 * payment plan splits, prices, areas.
 *
 * Usage:
 *   cd backend && npx ts-node --transpile-only scripts/extract-text-layer.ts <pdf-or-dir> [outDir]
 */
import * as fs from 'fs';
import * as path from 'path';

async function getMupdf() {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  return dynamicImport('mupdf');
}

interface PageText { page: number; chars: number; text: string }

async function extractPdfText(pdfPath: string): Promise<PageText[]> {
  const mupdf = await getMupdf();
  const buffer = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const numPages = doc.countPages();
  const pages: PageText[] = [];

  for (let i = 0; i < numPages; i++) {
    const page = doc.loadPage(i);
    let text = '';
    try {
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
    } catch (e) {
      text = `<<text extraction failed: ${(e as Error).message}>>`;
    }
    page.destroy?.();
    pages.push({ page: i + 1, chars: text.trim().length, text: text.trim() });
  }
  doc.destroy?.();
  return pages;
}

const PATTERNS: Record<string, RegExp> = {
  handoverDate: /(handover|completion|possession|delivery)[^.\n]{0,60}(q[1-4][\s'-]*20\d{2}|20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  quarterDate: /\bQ[1-4][\s'-]*20\d{2}\b/i,
  developer: /\b(by\s+[A-Z][A-Za-z]+|developer|developed by|a development by)\b/i,
  serviceCharge: /service\s*charge/i,
  paymentSplit: /\b\d{1,2}\s*[\/|]\s*\d{1,2}\b.{0,30}(payment|plan|construction|handover)|((down\s*payment|booking)[^.\n]{0,40}\d{1,2}\s*%)/i,
  percent: /\b\d{1,3}\s*%/,
  aedPrice: /AED\s*[\d,.]+|[\d,.]+\s*AED/i,
  area: /[\d,.]+\s*(sq\.?\s*ft|sqft|sqm|sq\.?\s*m)/i,
  unitTableRow: /\b(studio|[1-5]\s*BR|[1-5]\s*bed)/i,
};

async function main() {
  const input = process.argv[2];
  const outDir = process.argv[3] || path.join(process.env.TEMP || '/tmp', 'pdf-text-layer');
  if (!input) {
    console.error('Usage: extract-text-layer.ts <pdf-or-dir> [outDir]');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const pdfs = fs.statSync(input).isDirectory()
    ? fs.readdirSync(input).filter(f => f.toLowerCase().endsWith('.pdf')).map(f => path.join(input, f))
    : [input];

  for (const pdfPath of pdfs) {
    const name = path.basename(pdfPath, '.pdf');
    console.log(`\n${'='.repeat(70)}\n📄 ${name}`);
    const t0 = Date.now();
    const pages = await extractPdfText(pdfPath);
    const ms = Date.now() - t0;

    const withText = pages.filter(p => p.chars > 20);
    const totalChars = pages.reduce((s, p) => s + p.chars, 0);
    console.log(`   ${pages.length} pages, ${withText.length} with real text, ${totalChars} chars total, extracted in ${ms}ms`);

    // Dump full text for manual inspection
    const dump = pages.map(p => `\n----- PAGE ${p.page} (${p.chars} chars) -----\n${p.text}`).join('\n');
    const dumpPath = path.join(outDir, `${name}.txt`);
    fs.writeFileSync(dumpPath, dump, 'utf-8');

    // Pattern scan
    console.log(`   🔍 Pattern hits:`);
    for (const [label, re] of Object.entries(PATTERNS)) {
      const hits: string[] = [];
      for (const p of pages) {
        const m = p.text.match(re);
        if (m) hits.push(`p${p.page}: "${m[0].replace(/\s+/g, ' ').slice(0, 80)}"`);
      }
      if (hits.length > 0) {
        console.log(`      ${label}: ${hits.length} pages → ${hits.slice(0, 3).join(' | ')}`);
      }
    }
    console.log(`   📝 Full dump: ${dumpPath}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
