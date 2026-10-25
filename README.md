# Healthy Shop – Website bán thực phẩm chức năng

Dự án học phần Đánh giá hiệu năng – Phần 1 (Chủ hệ thống).
Link web: https://he-thong-ban-thuc-pham-chuc-nang.onrender.com/

## Cấu trúc
```
server.js          Backend Node.js + Express (REST API + phục vụ giao diện)
supervisor.js      Tự khởi động lại server khi bị dừng (dùng khi demo/triển khai)
image-sources.js   Danh sách ảnh minh họa sản phẩm (Pexels)
download-images.js Tải ảnh sản phẩm về public/images
public/            Frontend HTML/CSS/JS thuần (index.html, style.css, app.js)
package.json
```

## Chạy dự án
Yêu cầu: Node.js ≥ 18.
```bash
npm install
npm start            # chạy thường: http://localhost:3000
npm run start:safe   # chạy kèm tự khởi động lại khi server dừng
npm run images       # (khuyến nghị, chạy 1 lần) tải 21 ảnh sản phẩm về public/images
```
Đổi cổng: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).

## Tài khoản mẫu
| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | admin@healthyshop.vn | Admin@123 |
| Khách hàng | customer01@healthyshop.vn | Test@123 |
| Khách hàng | customer02@healthyshop.vn | Test@123 |

OTP ví điện tử thử nghiệm: `123456`. Dữ liệu lưu trong bộ nhớ và trở về dữ liệu mẫu mỗi khi khởi động lại.

