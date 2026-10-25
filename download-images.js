'use strict';
/**
 * Tải ảnh minh họa sản phẩm về thư mục public/images để website chạy được cả khi không có mạng.
 *   npm run images
 * Ảnh đã tải sẽ được bỏ qua; xóa file trong public/images để tải lại.
 */
const fs = require('fs');
const path = require('path');
const { PEXELS_IDS, pexelsUrl } = require('./image-sources');

const DIR = path.join(__dirname, 'public', 'images');
fs.mkdirSync(DIR, { recursive: true });

(async () => {
  let ok = 0;
  const failed = [];
  for (const [code, id] of Object.entries(PEXELS_IDS)) {
    const file = path.join(DIR, `${code}.jpg`);
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
      console.log(`  ${code}: đã có, bỏ qua`);
      ok += 1;
      continue;
    }
    try {
      const res = await fetch(pexelsUrl(id), { headers: { 'User-Agent': 'Mozilla/5.0 HealthyShop-image-downloader' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      console.log(`  ${code}: OK (${Math.round(buf.length / 1024)} KB)`);
      ok += 1;
    } catch (e) {
      console.log(`  ${code}: LỖI – ${e.message}`);
      failed.push(code);
    }
  }
  console.log(`\nHoàn tất: ${ok}/${Object.keys(PEXELS_IDS).length} ảnh.`);
  if (failed.length) console.log('Không tải được: ' + failed.join(', ') + ' (website sẽ hiển thị ảnh thay thế cho các sản phẩm này).');
})();
