/**
 * Test pdf2pic conversion
 * Usage: node test-pdf2pic.js <path-to-pdf>
 */

const { fromPath } = require('pdf2pic');
const path = require('path');
const fs = require('fs');

async function testPdfConversion(pdfPath) {
  console.log('🧪 Testing pdf2pic...\n');
  
  // Check if PDF exists
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF file not found:', pdfPath);
    process.exit(1);
  }
  
  console.log('📄 PDF File:', pdfPath);
  console.log('📏 File Size:', (fs.statSync(pdfPath).size / 1024).toFixed(2), 'KB\n');
  
  // Check for GraphicsMagick or ImageMagick
  console.log('🔍 Checking dependencies...');
  const { execSync } = require('child_process');
  
  let hasGM = false;
  let hasIM = false;
  
  try {
    execSync('gm version', { stdio: 'pipe' });
    console.log('✅ GraphicsMagick found');
    hasGM = true;
  } catch (e) {
    console.log('❌ GraphicsMagick not found');
  }
  
  try {
    execSync('magick --version', { stdio: 'pipe' });
    console.log('✅ ImageMagick found');
    hasIM = true;
  } catch (e) {
    console.log('❌ ImageMagick not found');
  }
  
  if (!hasGM && !hasIM) {
    console.error('\n❌ Neither GraphicsMagick nor ImageMagick found!');
    console.log('\nInstall one of them:');
    console.log('  - GraphicsMagick: choco install graphicsmagick');
    console.log('  - ImageMagick: choco install imagemagick');
    process.exit(1);
  }
  
  console.log('');
  
  // Setup output directory
  const outputDir = path.join(__dirname, 'uploads', 'test-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('📁 Output Directory:', outputDir);
  console.log('');
  
  // Configure pdf2pic
  const options = {
    density: 150,           // 150 DPI (reasonable quality)
    saveFilename: 'test-page',
    savePath: outputDir,
    format: 'png',
    width: 1240,           // Half of 300 DPI A4
    height: 1754
  };
  
  console.log('⚙️  Conversion Options:');
  console.log('   - Density:', options.density, 'DPI');
  console.log('   - Format:', options.format);
  console.log('   - Size:', options.width, 'x', options.height);
  console.log('');
  
  try {
    console.log('🔄 Converting page 1...');
    const startTime = Date.now();
    
    const convert = fromPath(pdfPath, options);
    const result = await convert(1, { responseType: 'image' });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result && result.path) {
      const fileSize = (fs.statSync(result.path).size / 1024).toFixed(2);
      console.log('✅ Conversion successful!');
      console.log('');
      console.log('📊 Results:');
      console.log('   - Time:', duration, 'seconds');
      console.log('   - Output:', result.path);
      console.log('   - Size:', fileSize, 'KB');
      console.log('');
      console.log('🎉 pdf2pic is working correctly!');
      
      // Try to open the image
      if (process.platform === 'win32') {
        console.log('');
        console.log('📸 Opening image...');
        execSync(`start "" "${result.path}"`, { stdio: 'ignore' });
      }
      
      return result.path;
    } else {
      console.error('❌ Conversion failed: No result returned');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Conversion failed!');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Get PDF path from command line or use default
const pdfPath = process.argv[2] || 'C:\\Users\\lzp65\\Desktop\\The Edit at d3 Project Briefing.pdf';

testPdfConversion(pdfPath)
  .then(() => {
    console.log('');
    console.log('✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
