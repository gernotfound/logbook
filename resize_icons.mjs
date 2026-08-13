import sharp from 'sharp';


const inputPath = 'C:\\Users\\gerar\\.gemini\\antigravity\\brain\\4438415c-4022-4cdc-ae25-24e7c0dde945\\neon_diary_icon_outline_1785060407852.jpg';
const outDir = './public';

async function generateIcons() {
    try {
        console.log('Generating favicon.png (32x32)');
        await sharp(inputPath).resize(32, 32).png().toFile(`${outDir}/favicon.png`);
        
        console.log('Generating icon-192.png (192x192)');
        await sharp(inputPath).resize(192, 192).png().toFile(`${outDir}/icon-192.png`);
        
        console.log('Generating icon-512.png (512x512)');
        await sharp(inputPath).resize(512, 512).png().toFile(`${outDir}/icon-512.png`);
        
        console.log('Generating apple-touch-icon.png (180x180)');
        await sharp(inputPath).resize(180, 180).png().toFile(`${outDir}/apple-touch-icon.png`);
        
        console.log('Icons generated successfully.');
    } catch (error) {
        console.error('Error generating icons:', error);
    }
}

generateIcons();
