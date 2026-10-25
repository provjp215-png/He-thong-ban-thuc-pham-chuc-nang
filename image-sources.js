'use strict';
/**
 * Nguồn ảnh minh họa sản phẩm – ảnh chụp thật từ Pexels (https://www.pexels.com).
 * Giấy phép Pexels: miễn phí sử dụng cho mục đích thương mại và phi thương mại, không bắt buộc ghi nguồn.
 * Đây là ảnh minh họa chung (viên nang, viên nén, nguyên liệu...), không phải ảnh bao bì của sản phẩm thật.
 *
 * Server phục vụ ảnh tại /images/<mã SP>.jpg:
 *   - nếu đã tải về thư mục public/images (lệnh: npm run images) -> trả file cục bộ;
 *   - nếu chưa -> chuyển hướng (302) tới ảnh gốc trên Pexels.
 */
const PEXELS_IDS = {
  P001: 3873135,  // Cam cắt lát trên đĩa – Vitamin C
  P002: 14631435, // Lọ viên nang mềm màu vàng – Vitamin D3
  P003: 15897790, // Viên dầu gan cá – Omega-3
  P004: 3683036,  // Viên nang tròn màu trắng – Canxi
  P005: 5699514,  // Đống viên nén trắng – Glucosamine
  P006: 17820730, // Viên nang và bột – Men vi sinh
  P007: 27305404, // Lọ nước uống collagen cạnh quả chanh – Collagen
  P008: 3683048,  // Viên nén trắng trên nền xanh – Kẽm
  P009: 7615616,  // Lá bạch quả và viên nang – Ginkgo
  P010: 1556669,  // Phụ nữ mang thai – Sắt + Acid folic
  P011: 4371873,  // Viên nén trắng trong cốc thủy tinh – Magie B6
  P012: 7615577,  // Viên nang trên nền xanh lá – Tảo Spirulina
  P013: 6220708,  // Bột nghệ – Curcumin
  P014: 5946652,  // Bát trà xanh matcha trên tay – Chiết xuất trà xanh
  P015: 7605733,  // Các loại viên uống nhìn từ trên – Vitamin tổng hợp
  P016: 3873201,  // Người đang uống viên uống – Melatonin
  P017: 3683106,  // Viên nén trắng trên nền vàng – Lutein
  P018: 8441517,  // Viên nang vàng trên nền xanh – Coenzyme Q10
  P019: 14027297, // Kẹo dẻo bổ sung – Kẹo dẻo vitamin cho bé
  P020: 208518,   // Lọ viên nang vàng đổ ra – Biotin
  P021: 3873170,  // Viên uống trên lòng bàn tay – Vitamin B tổng hợp
};

const pexelsUrl = (id, width = 600) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;

module.exports = { PEXELS_IDS, pexelsUrl };
