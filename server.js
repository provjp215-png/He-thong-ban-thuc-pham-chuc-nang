'use strict';
/**
 * Healthy Shop – Website thương mại điện tử bán thực phẩm chức năng
 * Backend: Node.js + Express. Dữ liệu lưu trong bộ nhớ (reset về dữ liệu mẫu mỗi lần khởi động).
 *
 * LƯU Ý NỘI BỘ (chủ hệ thống): các dòng "BUG CỐ TÌNH" là lỗi cài sẵn cho đồ án,
 * KHÔNG sửa trước buổi demo. Không chia sẻ mã nguồn này cho bạn cặp (tester).
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { PEXELS_IDS, pexelsUrl } = require('./image-sources');

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'healthyshop-dev-secret-2026';
const TOKEN_TTL_SECONDS = 60 * 60; // 60 phút
const SHIPPING_FEE = 30000;
const FREE_SHIP_THRESHOLD = 500000;
const MAX_QTY_PER_ITEM = 10;
const MAX_LOGIN_FAILS = 5;
const LOCK_MINUTES = 15;
const EWALLET_TEST_OTP = '123456';
const DISCLAIMER = 'Thực phẩm này không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh.';

/* =========================================================================
 * TIỆN ÍCH
 * ========================================================================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toVN = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000);
const nowISO = (d = new Date()) => toVN(d).toISOString().replace(/\.\d{3}Z$/, '+07:00');
const ymd = (d = new Date()) => toVN(d).toISOString().slice(0, 10).replace(/-/g, '');
const pad = (n, len) => String(n).padStart(len, '0');
const normalize = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const isStr = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function sendError(res, status, error, message, extra) {
  const body = { error };
  if (message) body.message = message;
  if (extra) Object.assign(body, extra);
  return res.status(status).json(body);
}
const validationError = (res, fields, message = 'Dữ liệu gửi lên không hợp lệ') =>
  sendError(res, 400, 'VALIDATION_ERROR', message, { fields });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
  return { salt, hash };
}
function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.hash));
}

/** Đọc page/size từ query. Trả về null (và đã gửi lỗi 400) nếu không hợp lệ. */
function parsePaging(req, res, defaultSize = 12) {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const size = req.query.size === undefined ? defaultSize : Number(req.query.size);
  const fields = {};
  if (!isInt(page, 1, 100000)) fields.page = 'page là số nguyên ≥ 1';
  if (!isInt(size, 1, 50)) fields.size = 'size là số nguyên từ 1 đến 50';
  if (Object.keys(fields).length) {
    validationError(res, fields);
    return null;
  }
  return { page, size };
}
function paginate(list, { page, size }) {
  const total = list.length;
  return {
    items: list.slice((page - 1) * size, page * size),
    pagination: { page, size, total, totalPages: Math.max(1, Math.ceil(total / size)) },
  };
}

/* =========================================================================
 * DỮ LIỆU MẪU (MOCK DATA)
 * ========================================================================= */
const categories = [
  { id: 'vitamin', name: 'Vitamin & Khoáng chất' },
  { id: 'xuong-khop', name: 'Xương khớp' },
  { id: 'tieu-hoa', name: 'Tiêu hóa' },
  { id: 'lam-dep', name: 'Làm đẹp' },
  { id: 'tim-mach', name: 'Tim mạch' },
  { id: 'than-kinh', name: 'Thần kinh & Giấc ngủ' },
  { id: 'me-be', name: 'Mẹ & Bé' },
];

const products = [
  {
    id: 'P001', name: 'Vitamin C 1000mg VitaPlus', category: 'vitamin', brand: 'VitaPlus',
    price: 250000, originalPrice: 290000, stock: 120, unit: 'Hộp 100 viên', origin: 'Việt Nam',
    sold: 342,
    shortDescription: 'Bổ sung vitamin C liều cao, hỗ trợ tăng sức đề kháng.',
    ingredients: 'Vitamin C (Acid ascorbic) 1000 mg, chiết xuất tầm xuân (Rose hips) 25 mg, tá dược vừa đủ 1 viên.',
    uses: 'Bổ sung vitamin C cho cơ thể, hỗ trợ tăng cường sức đề kháng, hỗ trợ chống oxy hóa.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa ăn sáng.',
    warning: 'Người có tiền sử sỏi thận nên hỏi ý kiến bác sĩ trước khi dùng. Không dùng quá liều khuyến cáo.',
  },
  {
    id: 'P002', name: 'Vitamin D3 1000 IU NutriLife', category: 'vitamin', brand: 'NutriLife',
    price: 220000, originalPrice: null, stock: 80, unit: 'Lọ 60 viên nang mềm', origin: 'Úc',
    sold: 198,
    shortDescription: 'Vitamin D3 dạng nang mềm, hỗ trợ hấp thu canxi.',
    ingredients: 'Vitamin D3 (Cholecalciferol) 1000 IU (25 mcg), dầu ô liu, vỏ nang gelatin.',
    uses: 'Bổ sung vitamin D3, hỗ trợ hấp thu canxi, hỗ trợ xương và răng chắc khỏe.',
    // BUG CỐ TÌNH 10: Content - Sai đơn vị liều dùng: ghi "1000 mg" trong khi hàm lượng đúng là 1000 IU (25 mcg), sai lệch thông tin y tế
    dosage: 'Người lớn: uống 1 viên (1000 mg vitamin D3) mỗi ngày trong bữa ăn.',
    warning: 'Không dùng cho người tăng canxi máu. Không dùng chung với các sản phẩm khác chứa vitamin D.',
  },
  {
    id: 'P003', name: 'Dầu cá Omega-3 1000mg HealthyDay', category: 'tim-mach', brand: 'HealthyDay',
    price: 450000, originalPrice: 520000, stock: 60, unit: 'Lọ 120 viên', origin: 'Na Uy',
    sold: 276,
    shortDescription: 'Dầu cá tinh khiết giàu EPA, DHA hỗ trợ tim mạch.',
    ingredients: 'Dầu cá tinh khiết 1000 mg (EPA 180 mg, DHA 120 mg), Vitamin E 1 IU.',
    uses: 'Hỗ trợ tim mạch, hỗ trợ giảm mỡ máu, hỗ trợ thị lực và trí não.',
    dosage: 'Người lớn: uống 1 viên x 2 lần/ngày sau bữa ăn.',
    warning: 'Người đang dùng thuốc chống đông máu cần hỏi ý kiến bác sĩ trước khi dùng.',
  },
  {
    id: 'P004', name: 'Canxi Nano + Vitamin K2', category: 'xuong-khop', brand: 'BoneMax',
    price: 320000, originalPrice: null, stock: 75, unit: 'Hộp 60 viên', origin: 'Mỹ',
    sold: 154,
    shortDescription: 'Canxi nano kết hợp K2 và D3 giúp hấp thu canxi tốt hơn.',
    ingredients: 'Canxi carbonat nano 500 mg, Vitamin K2 (MK-7) 45 mcg, Vitamin D3 400 IU.',
    uses: 'Bổ sung canxi, hỗ trợ xương, răng chắc khỏe, hỗ trợ giảm nguy cơ loãng xương.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa sáng, uống cùng nhiều nước.',
    warning: 'Không dùng cho người tăng canxi máu, sỏi thận.',
  },
  {
    id: 'P005', name: 'Glucosamine 1500mg JointCare', category: 'xuong-khop', brand: 'JointCare',
    price: 520000, originalPrice: 600000, stock: 40, unit: 'Lọ 90 viên', origin: 'Mỹ',
    sold: 211,
    shortDescription: 'Glucosamine kết hợp Chondroitin và MSM cho sụn khớp.',
    ingredients: 'Glucosamine sulfate 1500 mg, Chondroitin sulfate 400 mg, MSM 300 mg.',
    // BUG CỐ TÌNH 09: Content - Quảng cáo TPCN như thuốc chữa bệnh ("đặc trị", "chữa khỏi hoàn toàn", "thay thế thuốc"), trái quy định nội dung
    uses: 'Đặc trị thoái hóa khớp, chữa khỏi hoàn toàn đau nhức xương khớp chỉ sau 30 ngày, có thể thay thế thuốc điều trị xương khớp.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa ăn.',
    warning: 'Người dị ứng hải sản (tôm, cua) cần thận trọng. Phụ nữ có thai không nên dùng.',
  },
  {
    id: 'P006', name: 'Men vi sinh Probiotic 10 tỷ CFU BioGut', category: 'tieu-hoa', brand: 'BioGut',
    price: 280000, originalPrice: null, stock: 90, unit: 'Hộp 30 gói', origin: 'Hàn Quốc',
    sold: 305,
    shortDescription: '10 tỷ lợi khuẩn mỗi gói, hỗ trợ cân bằng hệ vi sinh đường ruột.',
    ingredients: 'Lactobacillus acidophilus, Bifidobacterium bifidum, Lactobacillus rhamnosus (tổng 10 tỷ CFU), chất xơ FOS.',
    uses: 'Bổ sung lợi khuẩn, hỗ trợ cân bằng hệ vi sinh đường ruột, hỗ trợ tiêu hóa tốt.',
    dosage: 'Người lớn: 1–2 gói/ngày; trẻ em trên 2 tuổi: 1 gói/ngày. Pha với nước ấm dưới 40°C.',
    warning: 'Không pha với nước nóng. Uống cách kháng sinh ít nhất 2 giờ.',
  },
  {
    id: 'P007', name: 'Collagen thủy phân + Vitamin C BeautyLab', category: 'lam-dep', brand: 'BeautyLab',
    price: 650000, originalPrice: 750000, stock: 50, unit: 'Hộp 30 gói', origin: 'Nhật Bản',
    sold: 187,
    shortDescription: 'Collagen peptide phân tử nhỏ, hỗ trợ làn da.',
    ingredients: 'Collagen peptide thủy phân 5000 mg, Vitamin C 80 mg, Hyaluronic acid 50 mg.',
    uses: 'Hỗ trợ cải thiện độ đàn hồi của da, hỗ trợ giảm khô da.',
    dosage: 'Người lớn: 1 gói/ngày, pha với 100 ml nước, uống trước khi ngủ.',
    warning: 'Phụ nữ có thai và cho con bú nên hỏi ý kiến bác sĩ.',
  },
  {
    id: 'P008', name: 'Kẽm Zinc 15mg VitaPlus', category: 'vitamin', brand: 'VitaPlus',
    price: 150000, originalPrice: null, stock: 100, unit: 'Lọ 60 viên', origin: 'Việt Nam',
    sold: 129,
    shortDescription: 'Bổ sung kẽm, hỗ trợ tăng sức đề kháng.',
    ingredients: 'Kẽm gluconat tương đương kẽm nguyên tố 15 mg, tá dược vừa đủ.',
    uses: 'Bổ sung kẽm cho cơ thể, hỗ trợ tăng cường sức đề kháng, hỗ trợ ăn ngon.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa ăn.',
    warning: 'Không dùng quá 40 mg kẽm/ngày. Không dùng cho trẻ em dưới 12 tuổi.',
  },
  {
    id: 'P009', name: 'Ginkgo Biloba 120mg BrainPlus', category: 'than-kinh', brand: 'BrainPlus',
    price: 380000, originalPrice: null, stock: 45, unit: 'Hộp 60 viên', origin: 'Đức',
    sold: 98,
    shortDescription: 'Chiết xuất bạch quả hỗ trợ tuần hoàn não.',
    ingredients: 'Chiết xuất lá bạch quả (Ginkgo biloba) 120 mg, Vitamin B6 2 mg.',
    uses: 'Hỗ trợ tăng cường tuần hoàn máu não, hỗ trợ cải thiện trí nhớ.',
    dosage: 'Người lớn: uống 1 viên x 2 lần/ngày.',
    warning: 'Không dùng cho người đang dùng thuốc chống đông, phụ nữ có thai.',
  },
  {
    id: 'P010', name: 'Sắt + Acid Folic cho mẹ bầu MamaCare', category: 'me-be', brand: 'MamaCare',
    price: 195000, originalPrice: null, stock: 3, unit: 'Hộp 30 viên', origin: 'Pháp',
    sold: 167,
    shortDescription: 'Bổ sung sắt và acid folic cho phụ nữ mang thai.',
    ingredients: 'Sắt fumarat tương đương sắt nguyên tố 30 mg, Acid folic 400 mcg, Vitamin B12 2,6 mcg.',
    uses: 'Bổ sung sắt và acid folic cho phụ nữ mang thai và cho con bú, hỗ trợ giảm nguy cơ thiếu máu do thiếu sắt.',
    dosage: 'Uống 1 viên/ngày trước bữa ăn 1 giờ hoặc theo chỉ dẫn của bác sĩ.',
    warning: 'Có thể gây táo bón, phân đen. Không uống cùng trà, cà phê, sữa.',
  },
  {
    id: 'P011', name: 'Magie B6 RelaxNight', category: 'than-kinh', brand: 'RelaxNight',
    price: 175000, originalPrice: null, stock: 0, unit: 'Hộp 50 viên', origin: 'Pháp',
    sold: 233,
    shortDescription: 'Magie kết hợp B6 hỗ trợ giảm căng thẳng, ngủ ngon.',
    ingredients: 'Magie lactat 470 mg (tương đương 48 mg magie), Vitamin B6 5 mg.',
    uses: 'Bổ sung magie và vitamin B6, hỗ trợ giảm căng thẳng, mệt mỏi, hỗ trợ giấc ngủ.',
    dosage: 'Người lớn: 2–3 viên/ngày, chia 2–3 lần, uống cùng nhiều nước.',
    warning: 'Không dùng cho người suy thận nặng.',
  },
  {
    id: 'P012', name: 'Tảo xoắn Spirulina 500mg GreenLife', category: 'vitamin', brand: 'GreenLife',
    price: 290000, originalPrice: 340000, stock: 70, unit: 'Lọ 200 viên', origin: 'Nhật Bản',
    sold: 142,
    shortDescription: 'Tảo xoắn giàu protein thực vật, vitamin và khoáng chất.',
    ingredients: 'Tảo xoắn Spirulina platensis 500 mg/viên.',
    uses: 'Bổ sung protein thực vật, vitamin và khoáng chất, hỗ trợ tăng cường sức khỏe.',
    dosage: 'Người lớn: 4–6 viên/ngày, chia 2 lần sau bữa ăn.',
    warning: 'Người bị bệnh gout, phenylketon niệu không nên dùng.',
  },
  {
    id: 'P013', name: 'Nghệ Nano Curcumin TurmeriX', category: 'tieu-hoa', brand: 'TurmeriX',
    price: 350000, originalPrice: null, stock: 55, unit: 'Hộp 30 viên', origin: 'Việt Nam',
    sold: 176,
    shortDescription: 'Nano curcumin từ nghệ vàng, hỗ trợ dạ dày.',
    ingredients: 'Nano Curcumin 100 mg, chiết xuất gừng 50 mg, tá dược vừa đủ.',
    uses: 'Hỗ trợ giảm acid dịch vị, hỗ trợ bảo vệ niêm mạc dạ dày.',
    dosage: 'Người lớn: uống 1 viên x 2 lần/ngày sau bữa ăn.',
    warning: 'Người bị sỏi mật, phụ nữ có thai nên hỏi ý kiến bác sĩ trước khi dùng.',
  },
  {
    id: 'P014', name: 'Chiết xuất trà xanh EGCG GreenSlim', category: 'lam-dep', brand: 'GreenSlim',
    price: 270000, originalPrice: null, stock: 65, unit: 'Hộp 60 viên', origin: 'Nhật Bản',
    sold: 119,
    shortDescription: 'Chiết xuất trà xanh giàu EGCG chống oxy hóa.',
    ingredients: 'Chiết xuất lá trà xanh 500 mg (tương đương EGCG 225 mg).',
    uses: 'Hỗ trợ chống oxy hóa, hỗ trợ giảm mỡ thừa khi kết hợp chế độ ăn uống và luyện tập.',
    dosage: 'Người lớn: uống 1 viên x 2 lần/ngày sau bữa ăn.',
    warning: 'Có chứa caffeine; không dùng vào buổi tối. Người nhạy cảm với caffeine, phụ nữ có thai không nên dùng.',
  },
  {
    id: 'P015', name: 'Vitamin tổng hợp DailyOne Multivitamin', category: 'vitamin', brand: 'DailyOne',
    price: 390000, originalPrice: 450000, stock: 85, unit: 'Lọ 90 viên', origin: 'Mỹ',
    sold: 264,
    shortDescription: '23 vitamin và khoáng chất trong 1 viên mỗi ngày.',
    ingredients: '23 vitamin và khoáng chất: Vitamin A, C, D3, E, K, nhóm B, kẽm, sắt, magie, selen, iod...',
    uses: 'Bổ sung vitamin và khoáng chất hằng ngày, hỗ trợ nâng cao sức khỏe, giảm mệt mỏi.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa sáng.',
    warning: 'Không dùng chung với sản phẩm khác chứa vitamin A hoặc sắt liều cao.',
  },
  {
    id: 'P016', name: 'Melatonin 3mg SleepWell', category: 'than-kinh', brand: 'SleepWell',
    price: 230000, originalPrice: null, stock: 40, unit: 'Lọ 60 viên', origin: 'Mỹ',
    sold: 187,
    shortDescription: 'Hỗ trợ đi vào giấc ngủ tự nhiên.',
    ingredients: 'Melatonin 3 mg, Vitamin B6 2 mg, tá dược vừa đủ.',
    uses: 'Hỗ trợ đi vào giấc ngủ nhanh hơn, hỗ trợ điều chỉnh nhịp sinh học khi lệch múi giờ.',
    dosage: 'Người lớn: uống 1 viên trước khi ngủ 30 phút.',
    warning: 'Không lái xe hoặc vận hành máy móc sau khi dùng. Không dùng cho trẻ em, phụ nữ có thai và cho con bú.',
  },
  {
    id: 'P017', name: 'Lutein 20mg EyeCare', category: 'vitamin', brand: 'EyeCare',
    price: 310000, originalPrice: null, stock: 50, unit: 'Hộp 30 viên', origin: 'Mỹ',
    sold: 95,
    shortDescription: 'Lutein và Zeaxanthin hỗ trợ đôi mắt sáng khỏe.',
    ingredients: 'Lutein 20 mg, Zeaxanthin 4 mg, Vitamin A 800 mcg.',
    uses: 'Hỗ trợ bảo vệ mắt trước ánh sáng xanh, hỗ trợ giảm mỏi mắt, khô mắt.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa ăn.',
    warning: 'Phụ nữ có thai nên hỏi ý kiến bác sĩ (sản phẩm có chứa vitamin A). Không dùng quá liều khuyến cáo.',
  },
  {
    id: 'P018', name: 'Coenzyme Q10 100mg HeartGuard', category: 'tim-mach', brand: 'HeartGuard',
    price: 480000, originalPrice: 550000, stock: 35, unit: 'Lọ 60 viên nang mềm', origin: 'Mỹ',
    sold: 133,
    shortDescription: 'CoQ10 hỗ trợ tim mạch và năng lượng tế bào.',
    ingredients: 'Coenzyme Q10 100 mg, Vitamin E 10 IU, dầu đậu nành.',
    uses: 'Hỗ trợ tim mạch, hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi.',
    dosage: 'Người lớn: uống 1 viên/ngày trong bữa ăn.',
    warning: 'Người đang dùng thuốc chống đông máu hoặc thuốc huyết áp cần hỏi ý kiến bác sĩ.',
  },
  {
    id: 'P019', name: 'Kẹo dẻo vitamin cho bé KidGummy', category: 'me-be', brand: 'KidGummy',
    price: 210000, originalPrice: null, stock: 60, unit: 'Lọ 60 viên kẹo dẻo', origin: 'Úc',
    sold: 221,
    shortDescription: 'Kẹo dẻo vị trái cây bổ sung vitamin cho trẻ.',
    ingredients: 'Vitamin A, C, D3, E, B6, B12, kẽm; đường, pectin, hương trái cây tự nhiên.',
    uses: 'Bổ sung vitamin và kẽm cho trẻ, hỗ trợ tăng sức đề kháng.',
    dosage: 'Trẻ từ 3 tuổi trở lên: nhai 2 viên/ngày.',
    warning: 'Để xa tầm tay trẻ em, không dùng như kẹo thông thường. Không dùng cho trẻ dưới 3 tuổi.',
  },
  {
    id: 'P020', name: 'Biotin 5000mcg HairNail', category: 'lam-dep', brand: 'HairNail',
    price: 260000, originalPrice: null, stock: 45, unit: 'Lọ 100 viên', origin: 'Mỹ',
    sold: 158,
    shortDescription: 'Biotin hàm lượng cao cho tóc và móng.',
    ingredients: 'Biotin (Vitamin B7) 5000 mcg, tá dược vừa đủ.',
    uses: 'Hỗ trợ tóc chắc khỏe, giảm gãy rụng, hỗ trợ móng chắc khỏe.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa ăn.',
    warning: 'Biotin có thể làm sai lệch một số kết quả xét nghiệm máu; báo cho bác sĩ trước khi xét nghiệm.',
  },
  {
    id: 'P021', name: 'Vitamin B tổng hợp B-Complex Plus', category: 'than-kinh', brand: 'VitaPlus',
    price: 185000, originalPrice: null, stock: 90, unit: 'Lọ 60 viên', origin: 'Việt Nam',
    sold: 207,
    shortDescription: 'Đầy đủ 8 vitamin nhóm B, hỗ trợ giảm mệt mỏi.',
    ingredients: 'Vitamin B1 10 mg, B2 10 mg, B3 20 mg, B5 10 mg, B6 10 mg, B12 10 mcg, Acid folic 200 mcg, Biotin 30 mcg.',
    uses: 'Bổ sung vitamin nhóm B, hỗ trợ giảm mệt mỏi, căng thẳng.',
    dosage: 'Người lớn: uống 1 viên/ngày sau bữa sáng.',
    warning: 'Nước tiểu có thể chuyển màu vàng đậm do vitamin B2, đây là hiện tượng bình thường.',
  },
].map((p, i) => ({ ...p, image: `/images/${p.id}.jpg`, isActive: true, createdAt: nowISO(new Date(Date.UTC(2026, 8, 1 + i, 2))) }));
let productSeq = products.length;

const users = [];
function addUser({ id, email, password, fullName, phone, role }) {
  const { salt, hash } = hashPassword(password);
  const u = { id, email, fullName, phone, role, salt, hash, createdAt: nowISO(), failedAttempts: 0, lockedUntil: 0 };
  users.push(u);
  return u;
}
addUser({ id: 'U001', email: 'admin@healthyshop.vn', password: 'Admin@123', fullName: 'Quản trị viên', phone: '0901000001', role: 'ADMIN' });
addUser({ id: 'U002', email: 'customer01@healthyshop.vn', password: 'Test@123', fullName: 'Nguyễn Văn An', phone: '0912345678', role: 'CUSTOMER' });
addUser({ id: 'U003', email: 'customer02@healthyshop.vn', password: 'Test@123', fullName: 'Trần Thị Bình', phone: '0987654321', role: 'CUSTOMER' });
let userSeq = users.length;
const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, createdAt: u.createdAt });

const coupons = [
  { code: 'VITA10', description: 'Giảm 10% (tối đa 50.000 ₫) cho đơn từ 200.000 ₫', type: 'PERCENT', value: 10, maxDiscount: 50000, minOrder: 200000, expiresAt: '2027-12-31T23:59:59+07:00' },
  { code: 'NEWUSER50', description: 'Giảm 50.000 ₫ cho đơn từ 300.000 ₫', type: 'FIXED', value: 50000, maxDiscount: 50000, minOrder: 300000, expiresAt: '2027-12-31T23:59:59+07:00' },
  { code: 'FREESHIP', description: 'Miễn phí vận chuyển', type: 'FREESHIP', value: 0, maxDiscount: 0, minOrder: 0, expiresAt: '2027-12-31T23:59:59+07:00' },
  { code: 'SUMMER20', description: 'Giảm 20% (tối đa 100.000 ₫) – chương trình hè 2026', type: 'PERCENT', value: 20, maxDiscount: 100000, minOrder: 0, expiresAt: '2026-08-31T23:59:59+07:00' },
];

const reviews = [
  { id: 'R001', productId: 'P001', userId: 'U002', userName: 'Nguyễn Văn An', rating: 5, comment: 'Dùng 1 tháng thấy ít bị cảm hơn, giao hàng nhanh.', createdAt: '2026-10-18T09:12:00+07:00' },
  { id: 'R002', productId: 'P003', userId: 'U002', userName: 'Nguyễn Văn An', rating: 4, comment: 'Viên to hơi khó uống nhưng không tanh.', createdAt: '2026-10-18T09:20:00+07:00' },
  { id: 'R003', productId: 'P006', userId: 'U003', userName: 'Trần Thị Bình', rating: 5, comment: 'Đóng gói cẩn thận.', createdAt: '2026-10-10T20:05:00+07:00' },
];
reviews.push(
  { id: 'R004', productId: 'P015', userId: 'U003', userName: 'Trần Thị Bình', rating: 4, comment: 'Uống buổi sáng thấy đỡ mệt, viên hơi to.', createdAt: '2026-10-12T08:30:00+07:00' },
  { id: 'R005', productId: 'P019', userId: 'U003', userName: 'Trần Thị Bình', rating: 5, comment: 'Bé nhà mình rất thích vị dâu.', createdAt: '2026-10-14T21:00:00+07:00' }
);
let reviewSeq = reviews.length;

const carts = new Map(); // userId -> { items: [{productId, quantity}], couponCode }
const revokedTokens = new Set();
// Mã phiên khởi động: mỗi lần server khởi động lại sẽ có mã mới, mọi token cấp trước đó (kể cả token đã đăng xuất) đều hết hiệu lực
const BOOT_ID = crypto.randomBytes(8).toString('hex');

// Trạng thái đếm sai mật khẩu / khóa tài khoản được lưu ra file để không bị mất khi server khởi động lại
const LOCK_FILE = path.join(__dirname, '.runtime', 'login-locks.json');
function loadLoginLocks() {
  try {
    const saved = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    for (const u of users) {
      const s = saved[u.email];
      if (s) {
        u.failedAttempts = Number(s.failedAttempts) || 0;
        u.lockedUntil = Number(s.lockedUntil) || 0;
      }
    }
  } catch (e) {
    /* chưa có file hoặc file không hợp lệ: bắt đầu với trạng thái trống */
  }
}
function saveLoginLocks() {
  const data = {};
  for (const u of users) {
    if (u.failedAttempts > 0 || u.lockedUntil > Date.now()) data[u.email] = { failedAttempts: u.failedAttempts, lockedUntil: u.lockedUntil };
  }
  try {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify(data));
  } catch (e) {
    console.error(`[${nowISO()}] Không ghi được trạng thái khóa đăng nhập:`, e.message);
  }
}
loadLoginLocks();
const smsOutbox = [];
const orders = [];
let orderSeq = 0;

function seedOrder({ userId, items, status, paymentMethod, paymentStatus, createdAt, couponCode = null }) {
  orderSeq += 1;
  const user = users.find((u) => u.id === userId);
  const lines = items.map(([pid, qty]) => {
    const p = products.find((x) => x.id === pid);
    return { productId: p.id, name: p.name, image: p.image, price: p.price, quantity: qty, lineTotal: p.price * qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingFee = subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
  const order = {
    id: `ORD-${createdAt.slice(0, 10).replace(/-/g, '')}-${pad(orderSeq, 4)}`,
    userId, items: lines, subtotal, discount: 0, shippingFee, total: subtotal + shippingFee, couponCode,
    shippingAddress: { fullName: user.fullName, phone: user.phone, address: '268 Lý Thường Kiệt, Phường 14, Quận 10, TP. Hồ Chí Minh' },
    paymentMethod, paymentStatus, status, note: '', createdAt, updatedAt: createdAt,
    history: [{ status: 'PENDING', at: createdAt, by: userId }],
  };
  if (status !== 'PENDING') order.history.push({ status, at: createdAt, by: 'U001' });
  orders.push(order);
}
seedOrder({ userId: 'U002', items: [['P001', 1], ['P003', 1]], status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID', createdAt: '2026-10-15T10:30:00+07:00' });
seedOrder({ userId: 'U002', items: [['P004', 1]], status: 'SHIPPING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-20T14:05:00+07:00' });
seedOrder({ userId: 'U003', items: [['P006', 2]], status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-22T08:45:00+07:00' });
seedOrder({ userId: 'U003', items: [['P008', 1]], status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-23T19:10:00+07:00' });
orders.find((o) => o.status === 'DELIVERED').paymentStatus = 'PAID';

/* =========================================================================
 * HÀM NGHIỆP VỤ
 * ========================================================================= */
function ratingOf(productId) {
  const list = reviews.filter((r) => r.productId === productId);
  const avg = list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : 0;
  return { ratingAvg: avg, ratingCount: list.length };
}
function productSummary(p) {
  return {
    id: p.id, name: p.name, category: p.category, brand: p.brand, price: p.price, originalPrice: p.originalPrice,
    stock: p.stock, inStock: p.stock > 0, unit: p.unit, image: p.image, shortDescription: p.shortDescription,
    sold: p.sold, ...ratingOf(p.id),
  };
}
const findActiveProduct = (id) => products.find((p) => p.id === id && p.isActive);

function similarity(a, b) {
  let s = 0;
  if (a.category === b.category) s += 3;
  if (a.brand === b.brand) s += 2;
  s += 1 / (1 + Math.abs(a.price - b.price) / 100000);
  return s;
}
function findRelatedProducts(product) {
  // BUG CỐ TÌNH 13: Performance - Vòng lặp đồng bộ chạy liên tục ~400ms ngốn CPU, chặn event loop mỗi lần xem chi tiết sản phẩm
  const start = Date.now();
  let checksum = 0;
  while (Date.now() - start < 400) {
    for (const p of products) checksum += similarity(product, p) * Math.sqrt(checksum + 1);
  }
  return products
    .filter((p) => p.isActive && p.id !== product.id)
    .sort((a, b) => similarity(product, b) - similarity(product, a))
    .slice(0, 4)
    .map(productSummary);
}

/** Kiểm tra mã giảm giá. Trả về { ok, status, error, message, coupon } */
function checkCoupon(code, subtotal) {
  const coupon = coupons.find((c) => c.code === code);
  if (!coupon) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Mã giảm giá không tồn tại' };
  // BUG CỐ TÌNH 03: Functional - Không kiểm tra hạn sử dụng (expiresAt): mã đã hết hạn SUMMER20 vẫn được áp dụng
  if (subtotal < coupon.minOrder) {
    return {
      ok: false, status: 400, error: 'VALIDATION_ERROR',
      message: `Đơn hàng tối thiểu ${coupon.minOrder.toLocaleString('vi-VN')} ₫ để dùng mã ${coupon.code}`,
    };
  }
  return { ok: true, coupon };
}
function couponDiscount(coupon, subtotal) {
  if (coupon.type === 'PERCENT') return Math.min(Math.floor((subtotal * coupon.value) / 100), coupon.maxDiscount);
  if (coupon.type === 'FIXED') return Math.min(coupon.value, subtotal);
  return 0;
}
function calcShippingFee(subtotal) {
  // BUG CỐ TÌNH 05: Functional - Dùng ">" thay cho ">=": đơn đúng 500.000 ₫ vẫn bị tính phí ship 30.000 ₫ (sai giá trị biên BR-01)
  return subtotal > FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
}

function getCart(userId) {
  if (!carts.has(userId)) carts.set(userId, { items: [], couponCode: null });
  return carts.get(userId);
}
function computeCart(userId) {
  const cart = getCart(userId);
  const items = cart.items
    .map((it) => {
      const p = products.find((x) => x.id === it.productId);
      if (!p) return null;
      return {
        productId: p.id, name: p.name, image: p.image, unit: p.unit, price: p.price, stock: p.stock,
        isActive: p.isActive, quantity: it.quantity, lineTotal: p.price * it.quantity,
      };
    })
    .filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  let discount = 0;
  let freeShip = false;
  let couponMessage = null;
  let coupon = null;
  if (cart.couponCode) {
    const r = checkCoupon(cart.couponCode, subtotal);
    if (r.ok) {
      coupon = { code: r.coupon.code, description: r.coupon.description };
      discount = couponDiscount(r.coupon, subtotal);
      freeShip = r.coupon.type === 'FREESHIP';
    } else {
      couponMessage = r.message;
    }
  }
  const shippingFee = items.length === 0 || freeShip ? 0 : calcShippingFee(subtotal);
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  return { items, totalQuantity, subtotal, coupon, couponMessage, discount, shippingFee, total: subtotal - discount + shippingFee };
}

const ORDER_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
function isCancellableByCustomer(order) {
  // BUG CỐ TÌNH 04: Functional - Khách được hủy mọi đơn chưa giao/chưa hủy (cả CONFIRMED, SHIPPING); đúng ra chỉ được hủy khi PENDING
  return order.status !== 'DELIVERED' && order.status !== 'CANCELLED';
}
function restock(order) {
  for (const it of order.items) {
    const p = products.find((x) => x.id === it.productId);
    if (p) { p.stock += it.quantity; p.sold = Math.max(0, p.sold - it.quantity); }
  }
}
function orderView(order, forAdmin = false) {
  const v = { ...order, canCancel: isCancellableByCustomer(order) };
  v.canPay = order.paymentMethod === 'EWALLET' && order.paymentStatus === 'UNPAID' && order.status === 'PENDING';
  if (forAdmin) {
    const u = users.find((x) => x.id === order.userId);
    v.customer = u ? { id: u.id, fullName: u.fullName, email: u.email } : null;
    v.nextStatuses = ORDER_TRANSITIONS[order.status];
  }
  return v;
}
function orderSummary(o) {
  return {
    id: o.id, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, total: o.total,
    itemCount: o.items.reduce((s, i) => s + i.quantity, 0), createdAt: o.createdAt,
  };
}

function sendOrderConfirmation(order) {
  // BUG CỐ TÌNH 15: Crash - Gọi .trim() trên order.note khi request không gửi trường "note" (trường tùy chọn) -> TypeError trong setTimeout -> sập tiến trình Node.js
  const notePreview = order.note.trim().slice(0, 50);
  smsOutbox.push({
    to: order.shippingAddress.phone,
    message: `Healthy Shop: Đơn ${order.id} đã được tiếp nhận, tổng ${order.total.toLocaleString('vi-VN')} đ. ${notePreview}`,
    at: nowISO(),
  });
}

/* =========================================================================
 * APP & MIDDLEWARE
 * ========================================================================= */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Ghi log các request chậm (≥ 1s) hoặc lỗi 5xx – tránh log toàn bộ làm sai lệch kết quả đo hiệu năng
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms >= 1000 || res.statusCode >= 500 || process.env.LOG_REQUESTS === '1') {
      console.log(`[${nowISO()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(0)} ms)`);
    }
  });
  next();
});

function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return sendError(res, 401, 'UNAUTHORIZED', 'Bạn cần đăng nhập để thực hiện chức năng này');
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    if (payload.boot !== BOOT_ID || revokedTokens.has(payload.jti)) throw new Error('revoked');
    const user = users.find((u) => u.id === payload.sub);
    if (!user) throw new Error('no user');
    req.user = user;
    req.tokenPayload = payload;
    return next();
  } catch (e) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại');
  }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : sendError(res, 403, 'FORBIDDEN', 'Tài khoản của bạn không có quyền thực hiện chức năng này');

/* =========================================================================
 * PHỤC VỤ FRONTEND (thư mục public/)
 * Các ghi chú nội bộ "BUG CỐ TÌNH" được loại bỏ trước khi gửi tới trình duyệt
 * để không lộ Bug Manifest qua View Source / DevTools.
 * ========================================================================= */
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
const stripInternalNotes = (src) =>
  src
    .replace(/[ \t]*<!--\s*BUG CỐ TÌNH[\s\S]*?-->[ \t]*\r?\n?/g, '')
    .replace(/[ \t]*\/\*\s*BUG CỐ TÌNH[\s\S]*?\*\/[ \t]*\r?\n?/g, '')
    .replace(/[ \t]*\/\/\s*BUG CỐ TÌNH[^\n]*/g, '');
const staticCache = new Map();
app.get(['/', '/index.html', '/style.css', '/app.js'], (req, res) => {
  const file = req.path === '/' ? 'index.html' : req.path.slice(1);
  let body = staticCache.get(file);
  if (!body) {
    body = stripInternalNotes(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8'));
    staticCache.set(file, body);
  }
  res.type(MIME[path.extname(file)]).set('Cache-Control', 'no-cache').send(body);
});

// Ảnh sản phẩm: ưu tiên file trong public/images (npm run images), nếu chưa có thì chuyển hướng tới ảnh gốc Pexels
const IMAGE_DIR = path.join(PUBLIC_DIR, 'images');
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
app.get('/images/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const ext = path.extname(file).toLowerCase();
  const local = path.join(IMAGE_DIR, file);
  if (IMAGE_MIME[ext] && fs.existsSync(local)) {
    return res.type(IMAGE_MIME[ext]).set('Cache-Control', 'public, max-age=86400').send(fs.readFileSync(local));
  }
  const code = file.replace(/\.jpg$/i, '');
  if (PEXELS_IDS[code]) return res.redirect(302, pexelsUrl(PEXELS_IDS[code]));
  return res.status(404).type('text/plain; charset=utf-8').send('404 - Không tìm thấy ảnh');
});

/* =========================================================================
 * API – HỆ THỐNG
 * ========================================================================= */
app.get('/api/health', (req, res) => res.json({ data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: nowISO() } }));

/* =========================================================================
 * API – XÁC THỰC (FR-01, FR-02, FR-03)
 * ========================================================================= */
app.post('/api/auth/register', (req, res) => {
  const { fullName, email, password, phone } = req.body || {};
  const fields = {};
  if (!isStr(fullName, 2, 50)) fields.fullName = 'Họ tên từ 2 đến 50 ký tự';
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 100) fields.email = 'Email không đúng định dạng';
  if (typeof password !== 'string' || password.length < 8 || password.length > 32 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    fields.password = 'Mật khẩu 8–32 ký tự, gồm cả chữ và số';
  if (typeof phone !== 'string' || !/^0\d{9}$/.test(phone)) fields.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (Object.keys(fields).length) return validationError(res, fields);
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    return sendError(res, 409, 'CONFLICT', 'Email đã được sử dụng, vui lòng dùng email khác');
  userSeq += 1;
  const u = addUser({ id: 'U' + pad(userSeq, 3), email: email.toLowerCase(), password, fullName: fullName.trim(), phone, role: 'CUSTOMER' });
  return res.status(201).json({ data: publicUser(u) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const fields = {};
  if (typeof email !== 'string' || !email.trim()) fields.email = 'Vui lòng nhập email';
  if (typeof password !== 'string' || !password) fields.password = 'Vui lòng nhập mật khẩu';
  if (Object.keys(fields).length) return validationError(res, fields);
  const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (user && user.lockedUntil > Date.now()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    return sendError(res, 423, 'ACCOUNT_LOCKED', `Tài khoản tạm khóa do nhập sai mật khẩu ${MAX_LOGIN_FAILS} lần. Vui lòng thử lại sau ${mins} phút`);
  }
  if (!user || !verifyPassword(password, user)) {
    if (user) {
      user.failedAttempts += 1;
      if (user.failedAttempts >= MAX_LOGIN_FAILS) {
        user.failedAttempts = 0;
        user.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
      }
      saveLoginLocks();
    }
    return sendError(res, 401, 'UNAUTHORIZED', 'Email hoặc mật khẩu không đúng');
  }
  if (user.failedAttempts > 0) {
    user.failedAttempts = 0;
    saveLoginLocks();
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, role: user.role, jti, boot: BOOT_ID }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  return res.json({ data: { token, tokenType: 'Bearer', expiresIn: TOKEN_TTL_SECONDS, user: publicUser(user) } });
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ data: publicUser(req.user) }));

app.post('/api/auth/logout', authenticate, (req, res) => {
  revokedTokens.add(req.tokenPayload.jti);
  res.json({ data: { message: 'Đăng xuất thành công' } });
});

/* =========================================================================
 * API – SẢN PHẨM (FR-04, FR-05, FR-06)
 * ========================================================================= */
app.get('/api/categories', (req, res) => {
  res.json({ data: categories.map((c) => ({ ...c, productCount: products.filter((p) => p.isActive && p.category === c.id).length })) });
});

const SORTS = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  best_selling: (a, b) => b.sold - a.sold,
};

app.get('/api/products', (req, res) => {
  const paging = parsePaging(req, res);
  if (!paging) return;
  const { category, sort = 'newest' } = req.query;
  const fields = {};
  if (category !== undefined && !categories.some((c) => c.id === category)) fields.category = 'Danh mục không tồn tại';
  if (!SORTS[sort]) fields.sort = 'sort ∈ {newest, price_asc, price_desc, best_selling}';
  const minPrice = req.query.minPrice === undefined ? 0 : Number(req.query.minPrice);
  const maxPrice = req.query.maxPrice === undefined ? Infinity : Number(req.query.maxPrice);
  if (Number.isNaN(minPrice) || minPrice < 0) fields.minPrice = 'minPrice là số ≥ 0';
  if (Number.isNaN(maxPrice) || maxPrice < minPrice) fields.maxPrice = 'maxPrice là số ≥ minPrice';
  if (Object.keys(fields).length) return validationError(res, fields);
  const list = products
    .filter((p) => p.isActive && (!category || p.category === category) && p.price >= minPrice && p.price <= maxPrice)
    .sort(SORTS[sort]);
  const { items, pagination } = paginate(list, paging);
  res.json({ data: items.map(productSummary), pagination });
});

app.get('/api/products/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2 || q.length > 100) return validationError(res, { q: 'Từ khóa tìm kiếm từ 2 đến 100 ký tự' });
  const paging = parsePaging(req, res);
  if (!paging) return;
  // BUG CỐ TÌNH 12: Performance - Cố tình trì hoãn 3.5 giây (setTimeout) cho mọi yêu cầu tìm kiếm, vi phạm NFR-02 (p95 ≤ 1000 ms)
  await sleep(3500);
  const nq = normalize(q);
  const list = products
    .filter((p) => p.isActive && [p.name, p.brand, p.ingredients, p.uses, p.shortDescription].some((f) => normalize(f).includes(nq)))
    .sort(SORTS.best_selling);
  const { items, pagination } = paginate(list, paging);
  res.json({ data: items.map(productSummary), pagination, query: q });
});

app.get('/api/products/:id', (req, res) => {
  const p = findActiveProduct(req.params.id);
  if (!p) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  const category = categories.find((c) => c.id === p.category);
  res.json({
    data: {
      ...productSummary(p), categoryName: category ? category.name : null, origin: p.origin,
      ingredients: p.ingredients, uses: p.uses, dosage: p.dosage, warning: p.warning,
      disclaimer: DISCLAIMER, related: findRelatedProducts(p),
    },
  });
});

/* =========================================================================
 * API – ĐÁNH GIÁ (FR-13)
 * ========================================================================= */
app.get('/api/products/:id/reviews', (req, res) => {
  const p = findActiveProduct(req.params.id);
  if (!p) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  const paging = parsePaging(req, res, 10);
  if (!paging) return;
  const list = reviews.filter((r) => r.productId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const { items, pagination } = paginate(list, paging);
  res.json({
    data: items.map(({ userId, ...r }) => r),
    summary: ratingOf(p.id),
    pagination,
  });
});

app.post('/api/products/:id/reviews', authenticate, requireRole('CUSTOMER'), async (req, res) => {
  const p = findActiveProduct(req.params.id);
  if (!p) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  const body = req.body || {};
  if (!isInt(body.rating, 1, 5)) return validationError(res, { rating: 'Điểm đánh giá là số nguyên từ 1 đến 5' });
  // BUG CỐ TÌNH 14: Crash - "comment" là trường tùy chọn nhưng gọi .trim() khi không gửi -> TypeError trong handler async (Express 4 không bắt) -> Unhandled Promise Rejection làm sập server
  const comment = body.comment.trim();
  if (comment.length > 500) return validationError(res, { comment: 'Nhận xét tối đa 500 ký tự' });
  const purchased = orders.some(
    (o) => o.userId === req.user.id && o.status === 'DELIVERED' && o.items.some((i) => i.productId === p.id)
  );
  if (!purchased) return sendError(res, 403, 'FORBIDDEN', 'Bạn chỉ có thể đánh giá sản phẩm thuộc đơn hàng đã giao thành công');
  if (reviews.some((r) => r.productId === p.id && r.userId === req.user.id))
    return sendError(res, 409, 'CONFLICT', 'Bạn đã đánh giá sản phẩm này rồi');
  reviewSeq += 1;
  const r = { id: 'R' + pad(reviewSeq, 3), productId: p.id, userId: req.user.id, userName: req.user.fullName, rating: body.rating, comment, createdAt: nowISO() };
  reviews.push(r);
  const { userId, ...out } = r;
  res.status(201).json({ data: out });
});

/* =========================================================================
 * API – GIỎ HÀNG & MÃ GIẢM GIÁ (FR-07, FR-08) – chỉ Khách hàng
 * ========================================================================= */
const customerOnly = [authenticate, requireRole('CUSTOMER')];

app.get('/api/cart', customerOnly, (req, res) => res.json({ data: computeCart(req.user.id) }));

app.post('/api/cart/items', customerOnly, (req, res) => {
  const { productId } = req.body || {};
  const quantity = req.body && req.body.quantity !== undefined ? req.body.quantity : 1;
  const fields = {};
  if (typeof productId !== 'string' || !productId) fields.productId = 'Vui lòng chọn sản phẩm';
  if (!isInt(quantity, 1, MAX_QTY_PER_ITEM)) fields.quantity = `Số lượng là số nguyên từ 1 đến ${MAX_QTY_PER_ITEM}`;
  if (Object.keys(fields).length) return validationError(res, fields);
  const product = findActiveProduct(productId);
  if (!product) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  if (product.stock === 0) return sendError(res, 409, 'CONFLICT', `Sản phẩm "${product.name}" đã hết hàng`);
  const cart = getCart(req.user.id);
  const existing = cart.items.find((i) => i.productId === productId);
  const newQty = (existing ? existing.quantity : 0) + quantity;
  if (newQty > MAX_QTY_PER_ITEM)
    return validationError(res, { quantity: `Mỗi sản phẩm tối đa ${MAX_QTY_PER_ITEM} trong giỏ (hiện có ${existing ? existing.quantity : 0})` });
  if (newQty > product.stock) {
    // BUG CỐ TÌNH 11: Content - Thông báo lỗi vô nghĩa khi vượt tồn kho ("undefined [object Object] (ERR_0x1F)") thay vì "Sản phẩm X chỉ còn N sản phẩm"
    return sendError(res, 409, 'CONFLICT', 'Lỗi xảy ra: ' + product.stockMessage + ' ' + {} + ' (ERR_0x1F)');
  }
  if (existing) existing.quantity = newQty;
  else cart.items.push({ productId, quantity });
  res.json({ data: computeCart(req.user.id) });
});

app.put('/api/cart/items/:productId', customerOnly, (req, res) => {
  const cart = getCart(req.user.id);
  const item = cart.items.find((i) => i.productId === req.params.productId);
  if (!item) return sendError(res, 404, 'NOT_FOUND', 'Sản phẩm không có trong giỏ hàng');
  const quantity = (req.body || {}).quantity;
  // BUG CỐ TÌNH 01: Functional - Chỉ chặn quantity > 10, KHÔNG chặn quantity ≤ 0 -> cho phép số lượng âm, tổng tiền âm, đặt hàng làm TĂNG tồn kho
  if (!Number.isInteger(quantity) || quantity > MAX_QTY_PER_ITEM)
    return validationError(res, { quantity: `Số lượng là số nguyên từ 1 đến ${MAX_QTY_PER_ITEM}` });
  const product = products.find((p) => p.id === item.productId);
  if (quantity > product.stock)
    return sendError(res, 409, 'CONFLICT', `Sản phẩm "${product.name}" chỉ còn ${product.stock} sản phẩm trong kho`);
  item.quantity = quantity;
  res.json({ data: computeCart(req.user.id) });
});

app.delete('/api/cart/items/:productId', customerOnly, (req, res) => {
  const cart = getCart(req.user.id);
  const idx = cart.items.findIndex((i) => i.productId === req.params.productId);
  if (idx === -1) return sendError(res, 404, 'NOT_FOUND', 'Sản phẩm không có trong giỏ hàng');
  cart.items.splice(idx, 1);
  res.json({ data: computeCart(req.user.id) });
});

app.post('/api/cart/coupon', customerOnly, (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{4,20}$/.test(code.trim()))
    return validationError(res, { code: 'Mã giảm giá gồm 4–20 ký tự chữ và số' });
  const cart = getCart(req.user.id);
  if (cart.items.length === 0) return validationError(res, { code: 'Giỏ hàng trống, chưa thể áp dụng mã giảm giá' });
  const normalized = code.trim().toUpperCase();
  const r = checkCoupon(normalized, computeCart(req.user.id).subtotal);
  if (!r.ok) return sendError(res, r.status, r.error, r.message);
  cart.couponCode = normalized;
  res.json({ data: computeCart(req.user.id) });
});

app.delete('/api/cart/coupon', customerOnly, (req, res) => {
  getCart(req.user.id).couponCode = null;
  res.json({ data: computeCart(req.user.id) });
});

/* =========================================================================
 * API – ĐƠN HÀNG & THANH TOÁN (FR-09, FR-10, FR-11, FR-12) – chỉ Khách hàng
 * ========================================================================= */
app.post('/api/orders', customerOnly, (req, res) => {
  const { shippingAddress, paymentMethod, note } = req.body || {};
  const fields = {};
  const sa = shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {};
  if (!isStr(sa.fullName, 2, 50)) fields['shippingAddress.fullName'] = 'Họ tên người nhận từ 2 đến 50 ký tự';
  if (typeof sa.phone !== 'string' || !/^0\d{9}$/.test(sa.phone)) fields['shippingAddress.phone'] = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (!isStr(sa.address, 10, 200)) fields['shippingAddress.address'] = 'Địa chỉ giao hàng từ 10 đến 200 ký tự';
  if (!['COD', 'EWALLET'].includes(paymentMethod)) fields.paymentMethod = 'Phương thức thanh toán là COD hoặc EWALLET';
  if (note !== undefined && (typeof note !== 'string' || note.length > 200)) fields.note = 'Ghi chú tối đa 200 ký tự';
  if (Object.keys(fields).length) return validationError(res, fields);

  const cart = getCart(req.user.id);
  if (cart.items.length === 0) return validationError(res, { cart: 'Giỏ hàng trống' }, 'Giỏ hàng trống, vui lòng thêm sản phẩm trước khi đặt hàng');
  for (const it of cart.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p || !p.isActive) return sendError(res, 409, 'CONFLICT', `Sản phẩm ${it.productId} đã ngừng kinh doanh, vui lòng xóa khỏi giỏ`);
    if (it.quantity > p.stock) return sendError(res, 409, 'CONFLICT', `Sản phẩm "${p.name}" chỉ còn ${p.stock} sản phẩm trong kho`);
  }
  const summary = computeCart(req.user.id);
  if (cart.couponCode && !summary.coupon) return sendError(res, 400, 'VALIDATION_ERROR', summary.couponMessage, { fields: { coupon: summary.couponMessage } });

  orderSeq += 1;
  const now = nowISO();
  const order = {
    id: `ORD-${ymd()}-${pad(orderSeq, 4)}`,
    userId: req.user.id,
    items: summary.items.map((i) => ({ productId: i.productId, name: i.name, image: i.image, price: i.price, quantity: i.quantity, lineTotal: i.lineTotal })),
    subtotal: summary.subtotal, discount: summary.discount, shippingFee: summary.shippingFee, total: summary.total,
    couponCode: summary.coupon ? summary.coupon.code : null,
    shippingAddress: { fullName: sa.fullName.trim(), phone: sa.phone, address: sa.address.trim() },
    paymentMethod, paymentStatus: 'UNPAID', status: 'PENDING', note,
    createdAt: now, updatedAt: now, history: [{ status: 'PENDING', at: now, by: req.user.id }],
  };
  for (const it of order.items) {
    const p = products.find((x) => x.id === it.productId);
    p.stock -= it.quantity;
    p.sold += it.quantity;
  }
  orders.push(order);
  carts.set(req.user.id, { items: [], couponCode: null });
  res.status(201).json({ data: orderView(order) });
  setTimeout(() => sendOrderConfirmation(order), 50);
});

app.get('/api/orders', customerOnly, (req, res) => {
  const paging = parsePaging(req, res, 10);
  if (!paging) return;
  const list = orders.filter((o) => o.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const { items, pagination } = paginate(list, paging);
  res.json({ data: items.map(orderSummary), pagination });
});

const findOwnOrder = (req) => orders.find((o) => o.id === req.params.id && o.userId === req.user.id);

app.get('/api/orders/:id', customerOnly, (req, res) => {
  const order = findOwnOrder(req);
  if (!order) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng');
  res.json({ data: orderView(order) });
});

app.post('/api/orders/:id/pay', customerOnly, (req, res) => {
  const order = findOwnOrder(req);
  if (!order) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng');
  const { otp } = req.body || {};
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) return validationError(res, { otp: 'Mã OTP gồm 6 chữ số' });
  if (order.paymentMethod !== 'EWALLET') return sendError(res, 409, 'CONFLICT', 'Đơn hàng thanh toán khi nhận hàng (COD), không cần thanh toán trực tuyến');
  if (order.paymentStatus === 'PAID') return sendError(res, 409, 'CONFLICT', 'Đơn hàng đã được thanh toán');
  if (order.status !== 'PENDING') return sendError(res, 409, 'CONFLICT', 'Chỉ thanh toán được đơn hàng đang chờ xác nhận');
  if (otp !== EWALLET_TEST_OTP) return sendError(res, 400, 'PAYMENT_FAILED', 'Mã OTP không đúng, vui lòng kiểm tra lại');
  order.paymentStatus = 'PAID';
  order.paidAt = nowISO();
  order.updatedAt = order.paidAt;
  res.json({ data: orderView(order) });
});

app.post('/api/orders/:id/cancel', customerOnly, (req, res) => {
  const order = findOwnOrder(req);
  if (!order) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng');
  const { reason } = req.body || {};
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 200)) return validationError(res, { reason: 'Lý do hủy tối đa 200 ký tự' });
  if (!isCancellableByCustomer(order))
    return sendError(res, 409, 'CONFLICT', 'Chỉ có thể hủy đơn hàng đang ở trạng thái "Chờ xác nhận"');
  order.status = 'CANCELLED';
  order.cancelReason = reason || '';
  if (order.paymentStatus === 'PAID') order.paymentStatus = 'REFUNDED';
  order.updatedAt = nowISO();
  order.history.push({ status: 'CANCELLED', at: order.updatedAt, by: req.user.id });
  restock(order);
  res.json({ data: orderView(order) });
});

/* =========================================================================
 * API – QUẢN TRỊ (FR-14, FR-15, FR-16) – chỉ Quản trị viên
 * ========================================================================= */
const adminOnly = [authenticate, requireRole('ADMIN')];

const PRODUCT_RULES = {
  name: (v) => isStr(v, 3, 150) || 'Tên sản phẩm từ 3 đến 150 ký tự',
  category: (v) => categories.some((c) => c.id === v) || 'Danh mục không tồn tại',
  brand: (v) => isStr(v, 1, 50) || 'Thương hiệu từ 1 đến 50 ký tự',
  price: (v) => isInt(v, 1000, 50000000) || 'Giá là số nguyên từ 1.000 đến 50.000.000',
  originalPrice: (v) => v === null || isInt(v, 1000, 50000000) || 'Giá gốc là null hoặc số nguyên từ 1.000 đến 50.000.000',
  stock: (v) => isInt(v, 0, 9999) || 'Tồn kho là số nguyên từ 0 đến 9999',
  unit: (v) => isStr(v, 1, 50) || 'Quy cách từ 1 đến 50 ký tự',
  origin: (v) => isStr(v, 1, 50) || 'Xuất xứ từ 1 đến 50 ký tự',
  image: (v) => (isStr(v, 1, 500) && /^(https?:\/\/|\/images\/)\S+$/.test(v.trim())) || 'Ảnh là đường dẫn http(s):// hoặc /images/..., tối đa 500 ký tự',
  shortDescription: (v) => (typeof v === 'string' && v.length <= 200) || 'Mô tả ngắn tối đa 200 ký tự',
  ingredients: (v) => (typeof v === 'string' && v.length <= 1000) || 'Thành phần tối đa 1000 ký tự',
  uses: (v) => (typeof v === 'string' && v.length <= 1000) || 'Công dụng tối đa 1000 ký tự',
  dosage: (v) => (typeof v === 'string' && v.length <= 500) || 'Liều dùng tối đa 500 ký tự',
  warning: (v) => (typeof v === 'string' && v.length <= 500) || 'Lưu ý tối đa 500 ký tự',
};
const REQUIRED_PRODUCT_FIELDS = ['name', 'category', 'brand', 'price', 'stock', 'unit'];

function validateProduct(body, existing) {
  const fields = {};
  for (const [k, rule] of Object.entries(PRODUCT_RULES)) {
    if (body[k] === undefined) {
      if (!existing && REQUIRED_PRODUCT_FIELDS.includes(k)) fields[k] = 'Trường bắt buộc';
      continue;
    }
    const r = rule(body[k]);
    if (r !== true) fields[k] = r;
  }
  const merged = { ...(existing || {}), ...body };
  if (!fields.price && !fields.originalPrice && merged.originalPrice != null && merged.originalPrice <= merged.price)
    fields.originalPrice = 'Giá gốc phải lớn hơn giá bán';
  return fields;
}
const pickProductFields = (body) =>
  Object.fromEntries(Object.keys(PRODUCT_RULES).filter((k) => body[k] !== undefined).map((k) => [k, typeof body[k] === 'string' ? body[k].trim() : body[k]]));

app.get('/api/admin/products', adminOnly, (req, res) => {
  const paging = parsePaging(req, res, 20);
  if (!paging) return;
  const { items, pagination } = paginate([...products].sort((a, b) => a.id.localeCompare(b.id)), paging);
  res.json({ data: items.map((p) => ({ ...p })), pagination });
});

app.post('/api/admin/products', adminOnly, (req, res) => {
  const body = req.body || {};
  const fields = validateProduct(body, null);
  if (Object.keys(fields).length) return validationError(res, fields);
  if (products.some((p) => p.name.toLowerCase() === body.name.trim().toLowerCase()))
    return sendError(res, 409, 'CONFLICT', 'Tên sản phẩm đã tồn tại');
  productSeq += 1;
  const p = {
    id: 'P' + pad(productSeq, 3), originalPrice: null, origin: 'Việt Nam', image: '/images/placeholder.svg', shortDescription: '',
    ingredients: '', uses: '', dosage: '', warning: '', ...pickProductFields(body), sold: 0, isActive: true, createdAt: nowISO(),
  };
  products.push(p);
  res.status(201).json({ data: { ...p } });
});

// BUG CỐ TÌNH 02: Functional - API sửa sản phẩm chỉ kiểm tra đăng nhập (authenticate), thiếu requireRole('ADMIN') -> Khách hàng sửa được giá/tồn kho (vượt quyền)
app.put('/api/admin/products/:id', authenticate, (req, res) => {
  const p = products.find((x) => x.id === req.params.id);
  if (!p) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  const body = req.body || {};
  const fields = validateProduct(body, p);
  if (Object.keys(fields).length) return validationError(res, fields);
  if (body.name && products.some((x) => x.id !== p.id && x.name.toLowerCase() === body.name.trim().toLowerCase()))
    return sendError(res, 409, 'CONFLICT', 'Tên sản phẩm đã tồn tại');
  Object.assign(p, pickProductFields(body));
  res.json({ data: { ...p } });
});

app.delete('/api/admin/products/:id', adminOnly, (req, res) => {
  const p = products.find((x) => x.id === req.params.id);
  if (!p) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy sản phẩm');
  if (!p.isActive) return sendError(res, 409, 'CONFLICT', 'Sản phẩm đã ngừng kinh doanh trước đó');
  p.isActive = false;
  res.json({ data: { id: p.id, isActive: false, message: 'Đã ngừng kinh doanh sản phẩm' } });
});

const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);

app.get('/api/admin/orders', adminOnly, (req, res) => {
  const paging = parsePaging(req, res, 20);
  if (!paging) return;
  const { status } = req.query;
  if (status !== undefined && !ORDER_STATUSES.includes(status))
    return validationError(res, { status: `status ∈ {${ORDER_STATUSES.join(', ')}}` });
  const list = orders.filter((o) => !status || o.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const { items, pagination } = paginate(list, paging);
  res.json({ data: items.map((o) => orderView(o, true)), pagination });
});

app.patch('/api/admin/orders/:id/status', adminOnly, (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng');
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return validationError(res, { status: `status ∈ {${ORDER_STATUSES.join(', ')}}` });
  if (!ORDER_TRANSITIONS[order.status].includes(status))
    return sendError(res, 409, 'CONFLICT', `Không thể chuyển đơn hàng từ ${order.status} sang ${status}`);
  if (status === 'CONFIRMED' && order.paymentMethod === 'EWALLET' && order.paymentStatus !== 'PAID')
    return sendError(res, 409, 'CONFLICT', 'Đơn thanh toán ví điện tử chưa được thanh toán, chưa thể xác nhận');
  order.status = status;
  order.updatedAt = nowISO();
  order.history.push({ status, at: order.updatedAt, by: req.user.id });
  if (status === 'CANCELLED') {
    restock(order);
    if (order.paymentStatus === 'PAID') order.paymentStatus = 'REFUNDED';
  }
  if (status === 'DELIVERED' && order.paymentMethod === 'COD') order.paymentStatus = 'PAID';
  res.json({ data: orderView(order, true) });
});

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const delivered = orders.filter((o) => o.status === 'DELIVERED');
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]));
  const sales = {};
  for (const o of orders.filter((x) => x.status !== 'CANCELLED'))
    for (const i of o.items) sales[i.productId] = (sales[i.productId] || 0) + i.quantity;
  const topProducts = Object.entries(sales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, qty]) => ({ productId: id, name: (products.find((p) => p.id === id) || {}).name, quantity: qty }));
  res.json({
    data: {
      totalRevenue: delivered.reduce((s, o) => s + o.total, 0),
      totalOrders: orders.length,
      ordersByStatus: byStatus,
      totalCustomers: users.filter((u) => u.role === 'CUSTOMER').length,
      totalProducts: products.filter((p) => p.isActive).length,
      lowStock: products.filter((p) => p.isActive && p.stock < 5).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
      topProducts,
    },
  });
});

/* =========================================================================
 * 404 & XỬ LÝ LỖI CHUNG
 * ========================================================================= */
app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'API không tồn tại'));
app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('404 - Không tìm thấy trang'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return sendError(res, 400, 'VALIDATION_ERROR', 'Dữ liệu JSON không hợp lệ');
  if (err.type === 'entity.too.large') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên vượt quá 100 KB');
  console.error(`[${nowISO()}] Lỗi máy chủ:`, err.message);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Đã có lỗi máy chủ, vui lòng thử lại sau');
});

app.listen(PORT, () => {
  console.log('==============================================');
  console.log(` Healthy Shop đang chạy tại: http://localhost:${PORT}`);
  console.log(` API base URL:          http://localhost:${PORT}/api`);
  console.log(' Tài khoản mẫu: admin@healthyshop.vn / Admin@123');
  console.log('                customer01@healthyshop.vn / Test@123');
  console.log('==============================================');
});
