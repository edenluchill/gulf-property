/**
 * PDF Image Extraction Utilities
 * 
 * Extracts embedded images from PDF using pdf-lib
 * No canvas required!
 */

// @ts-nocheck - Complex pdf-lib internal API usage
import { PDFDocument } from 'pdf-lib';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface ExtractedImage {
  index: number;
  pageNumber: number;
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  base64: string;
  size: number; // Size in bytes
  savedPath?: string; // Path if saved to disk
}

/**
 * Extract all images from PDF
 * 
 * @param pdfBuffer - PDF file buffer
 * @param outputDir - Directory to save images (optional)
 * @returns Array of extracted images with base64 data
 */
export async function extractImagesFromPdf(
  pdfBuffer: Buffer,
  outputDir?: string
): Promise<ExtractedImage[]> {
  try {
    console.log('\n🖼️  Extracting images from PDF...');

    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const extractedImages: ExtractedImage[] = [];

    let imageIndex = 0;

    // Iterate through all pages
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      
      try {
        // Get page resources
        const resources = page.node.Resources();
        if (!resources) continue;

        const xObjects = resources.lookup(page.doc.context.obj({ Type: 'XObject' })) as any;
        if (!xObjects) continue;

        // Extract images from XObjects
        const xObjectKeys = xObjects.keys();
        
        for (const key of xObjectKeys) {
          try {
            const xObject = xObjects.lookup(key);
            
            // Check if it's an image
            if (xObject && xObject.lookup && xObject.lookup(page.doc.context.obj({ Subtype: 'Image' }))) {
              // This is an image!
              const imageData = xObject.contents();
              
              if (!imageData || imageData.length === 0) continue;

              const buffer = Buffer.from(imageData);
              const base64 = buffer.toString('base64');

              // Determine MIME type (basic detection)
              let mimeType = 'image/jpeg';
              if (buffer[0] === 0x89 && buffer[1] === 0x50) {
                mimeType = 'image/png';
              } else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
                mimeType = 'image/jpeg';
              }

              // Always save to disk for URL serving
              let savedPath: string | undefined;
              if (outputDir) {
                if (!existsSync(outputDir)) {
                  mkdirSync(outputDir, { recursive: true });
                }
                
                const ext = mimeType === 'image/png' ? 'png' : 'jpg';
                const filename = `image_${imageIndex + 1}_page${pageIndex + 1}.${ext}`;
                const filepath = join(outputDir, filename);
                
                writeFileSync(filepath, buffer);
                savedPath = filepath;
                console.log(`   ✓ Saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
              }

              const extractedImage: ExtractedImage = {
                index: imageIndex,
                pageNumber: pageIndex + 1,
                buffer,
                mimeType,
                size: buffer.length,
                base64: `data:${mimeType};base64,${base64}`,
                savedPath,
              };

              extractedImages.push(extractedImage);
              imageIndex++;
            }
          } catch (xObjectError) {
            // Skip problematic images
            continue;
          }
        }
      } catch (pageError) {
        // Skip problematic pages
        continue;
      }
    }

    console.log(`   ✅ Extracted ${extractedImages.length} images from ${pages.length} pages\n`);

    return extractedImages;
  } catch (error) {
    console.error('Error extracting images from PDF:', error);
    return [];
  }
}

/**
 * Classify extracted images using Gemini Vision
 * 
 * Categories: floorplan, rendering, amenity, location, cover, other
 */
export async function classifyExtractedImages(
  images: ExtractedImage[],
  genAI: any
): Promise<Map<string, ExtractedImage[]>> {
  const classified = new Map<string, ExtractedImage[]>();
  
  console.log(`\n🔍 Classifying ${images.length} images...`);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  for (const image of images) {
    try {
      const prompt = `Classify this image into ONE category:
- floorplan: Floor plan, unit layout, architectural diagram
- rendering: 3D rendering, building exterior/interior visualization
- amenity: Facilities, pool, gym, amenities
- location: Map, location diagram, area plan
- cover: Cover page, logo, title
- other: Other images

Respond with ONLY the category name, nothing else.`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.base64.split(',')[1], // Remove data:image/... prefix
          },
        },
      ]);

      const category = (await result.response).text().trim().toLowerCase();
      
      if (!classified.has(category)) {
        classified.set(category, []);
      }
      classified.get(category)!.push(image);

      console.log(`   ✓ Image ${image.index + 1}: ${category}`);

    } catch (error) {
      console.error(`   ✗ Failed to classify image ${image.index + 1}:`, error);
      
      // Default to 'other'
      if (!classified.has('other')) {
        classified.set('other', []);
      }
      classified.get('other')!.push(image);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n📊 Classification complete:`);
  classified.forEach((images, category) => {
    console.log(`   ${category}: ${images.length} images`);
  });

  return classified;
}

/**
 * Extract images and save organized by category
 */
export async function extractAndOrganizeImages(
  pdfBuffer: Buffer,
  outputBaseDir: string,
  genAI: any
): Promise<{
  floorPlans: string[];
  renderings: string[];
  amenities: string[];
  location: string[];
  cover: string[];
  other: string[];
}> {
  try {
    // Extract all images
    const images = await extractImagesFromPdf(pdfBuffer, join(outputBaseDir, 'raw'));

    if (images.length === 0) {
      console.log('⚠️  No images found in PDF');
      return {
        floorPlans: [],
        renderings: [],
        amenities: [],
        location: [],
        cover: [],
        other: [],
      };
    }

    // Classify images
    const classified = await classifyExtractedImages(images, genAI);

    // Organize into folders
    const organized = {
      floorPlans: (classified.get('floorplan') || []).map(img => img.base64),
      renderings: (classified.get('rendering') || []).map(img => img.base64),
      amenities: (classified.get('amenity') || []).map(img => img.base64),
      location: (classified.get('location') || []).map(img => img.base64),
      cover: (classified.get('cover') || []).map(img => img.base64),
      other: (classified.get('other') || []).map(img => img.base64),
    };

    console.log('\n✅ Images organized by category\n');

    return organized;
  } catch (error) {
    console.error('Error extracting and organizing images:', error);
    return {
      floorPlans: [],
      renderings: [],
      amenities: [],
      location: [],
      cover: [],
      other: [],
    };
  }
}
