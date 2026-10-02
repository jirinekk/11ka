const fs = require('fs');
const path = require('path');
const { optimizeUploadImage } = require('../lib/optimize-upload-image');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'articles');

async function main() {
  if (!fs.existsSync(uploadsDir)) {
    console.log('No article uploads directory.');
    return;
  }

  const files = fs.readdirSync(uploadsDir).filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
  let optimized = 0;
  let skipped = 0;
  let savedBytes = 0;

  for (const name of files) {
    const absolutePath = path.join(uploadsDir, name);
    const result = await optimizeUploadImage(absolutePath);
    if (!result.ok) continue;
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    optimized += 1;
    savedBytes += Math.max(0, (result.beforeBytes || 0) - (result.afterBytes || 0));
    console.log(
      `${name}: ${Math.round((result.beforeBytes || 0) / 1024)} KB -> ${Math.round((result.afterBytes || 0) / 1024)} KB`
    );
  }

  console.log(
    `Done. Optimized ${optimized} files, skipped ${skipped}, saved ${Math.round(savedBytes / 1024 / 1024)} MB.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
