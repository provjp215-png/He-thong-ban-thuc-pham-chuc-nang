'use strict';
/**
 * Trình giám sát đơn giản: tự khởi động lại server.js khi tiến trình bị sập.
 * Dùng khi chạy demo/triển khai lâu dài để link sản phẩm không bị gián đoạn:
 *   npm run start:safe
 * Mỗi lần server sập sẽ được ghi vào crash.log (thời điểm + mã thoát) làm bằng chứng.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, 'crash.log');
let restarts = 0;

function start() {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: ['inherit', 'inherit', 'pipe'], env: process.env });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
    process.stderr.write(d);
  });
  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') return;
    restarts += 1;
    const line = `[${new Date().toISOString()}] server.js thoát (code=${code}, signal=${signal}). Khởi động lại lần ${restarts}.\n${stderr.slice(-2000)}\n`;
    fs.appendFileSync(LOG, line);
    console.error(`\n*** Server bị dừng (code=${code}). Tự khởi động lại sau 1 giây... ***\n`);
    setTimeout(start, 1000);
  });
}

process.on('SIGINT', () => process.exit(0));
start();
