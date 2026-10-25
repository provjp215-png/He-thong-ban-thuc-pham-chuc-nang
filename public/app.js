/* Healthy Shop – Frontend (JavaScript thuần), gọi trực tiếp REST API tại /api */
(function () {
  'use strict';

  const API_BASE = '/api';
  const STATUS_LABEL = {
    PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', SHIPPING: 'Đang giao', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy',
  };
  const PAY_LABEL = { UNPAID: 'Chưa thanh toán', PAID: 'Đã thanh toán', REFUNDED: 'Đã hoàn tiền' };
  const METHOD_LABEL = { COD: 'Thanh toán khi nhận hàng (COD)', EWALLET: 'Ví điện tử HealthyPay' };

  const state = {
    token: null,
    user: null,
    categories: [],
    home: { category: '', sort: 'newest', page: 1 },
    adminTab: 'products',
    adminOrderFilter: '',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  /* ---------------- Tiện ích ---------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const money = (n) => Number(n || 0).toLocaleString('vi-VN') + ' ₫';
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const PLACEHOLDER = '/images/placeholder.svg';
  const imgTag = (src, alt, cls = '') =>
    `<img class="${cls}" src="${esc(src || PLACEHOLDER)}" alt="${esc(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">`;
  const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = msg;
    $('#toastWrap').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function loadSession() {
    try {
      state.token = localStorage.getItem('hs_token');
      const u = localStorage.getItem('hs_user');
      state.user = u ? JSON.parse(u) : null;
    } catch (e) { state.token = null; state.user = null; }
  }
  function saveSession(token, user) {
    state.token = token; state.user = user;
    try {
      if (token) { localStorage.setItem('hs_token', token); localStorage.setItem('hs_user', JSON.stringify(user)); }
      else { localStorage.removeItem('hs_token'); localStorage.removeItem('hs_user'); }
    } catch (e) { /* bỏ qua */ }
    updateHeader();
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.');
      err.status = 0;
      throw err;
    }
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) {
      const err = new Error((json && json.message) || 'Yêu cầu thất bại (mã ' + res.status + ')');
      err.status = res.status;
      err.code = json && json.error;
      err.fields = (json && json.fields) || {};
      if (res.status === 401 && state.token && path !== '/auth/login') {
        saveSession(null, null);
        toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'error');
        location.hash = '#/login';
      }
      throw err;
    }
    return json;
  }

  const isCustomer = () => state.user && state.user.role === 'CUSTOMER';
  const isAdmin = () => state.user && state.user.role === 'ADMIN';

  function updateHeader() {
    const b = document.body;
    b.classList.toggle('is-guest', !state.user);
    b.classList.toggle('is-customer', isCustomer());
    b.classList.toggle('is-admin', isAdmin());
    $('#userChip').textContent = state.user ? '👤 ' + state.user.fullName : '';
    if (isCustomer()) refreshCartBadge(); else $('#cartBadge').textContent = '0';
  }
  async function refreshCartBadge(cart) {
    try {
      const c = cart || (await api('/cart')).data;
      $('#cartBadge').textContent = c.totalQuantity;
    } catch (e) { /* bỏ qua */ }
  }

  function showFieldErrors(form, fields) {
    $$('.field-error', form).forEach((e) => e.remove());
    Object.entries(fields || {}).forEach(([name, msg]) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) {
        const div = document.createElement('div');
        div.className = 'field-error';
        div.textContent = msg;
        (input.closest('.field') || input.parentElement).appendChild(div);
      }
    });
  }

  /* ---------------- Modal ---------------- */
  function openModal(html, small = false) {
    $('#modalBody').innerHTML = html;
    $('.modal-dialog').classList.toggle('small', small);
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').hidden = true;
    $('#modalBody').innerHTML = '';
    document.body.style.overflow = '';
  }
  function confirmDialog(message, okText = 'Đồng ý') {
    return new Promise((resolve) => {
      openModal(`<h3>Xác nhận</h3><p>${esc(message)}</p>
        <div class="order-actions"><button class="btn btn-danger" id="cfOk">${esc(okText)}</button>
        <button class="btn btn-light" id="cfCancel">Quay lại</button></div>`, true);
      $('#cfOk').onclick = () => { closeModal(); resolve(true); };
      $('#cfCancel').onclick = () => { closeModal(); resolve(false); };
    });
  }

  /* ---------------- Thẻ sản phẩm ---------------- */
  function priceHtml(p) {
    return `<div class="price-box"><span class="price-current">${money(p.price)}</span>${
      p.originalPrice ? `<span class="price-old">${money(p.originalPrice)}</span>` : ''}</div>`;
  }
  function productCard(p) {
    const discount = p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
    return `<article class="product-card" data-id="${esc(p.id)}">
      <div class="product-thumb" data-action="detail">${imgTag(p.image, p.name)}
        ${!p.inStock ? '<span class="tag out">Hết hàng</span>' : discount ? `<span class="tag">-${discount}%</span>` : ''}</div>
      <div class="product-body">
        <div class="product-brand">${esc(p.brand)}</div>
        <div class="product-name" data-action="detail">${esc(p.name)}</div>
        <div class="rating">${stars(p.ratingAvg)} <span>(${p.ratingCount}) · Đã bán ${p.sold}</span></div>
        ${priceHtml(p)}
        <div class="muted" style="font-size:13px">${esc(p.unit)}</div>
        <div class="product-actions">
          <button class="btn btn-light" data-action="detail">Chi tiết</button>
          <button class="btn add-to-cart" data-action="add" ${p.inStock ? '' : 'disabled'}>${p.inStock ? 'Thêm vào giỏ' : 'Hết hàng'}</button>
        </div>
      </div>
    </article>`;
  }
  function bindProductGrid(root) {
    root.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      const card = e.target.closest('.product-card');
      if (!actionEl || !card) return;
      const id = card.dataset.id;
      if (actionEl.dataset.action === 'detail') openProductDetail(id);
      if (actionEl.dataset.action === 'add') addToCart(id, 1);
    });
  }

  async function addToCart(productId, quantity) {
    if (!state.user) {
      toast('Vui lòng đăng nhập để thêm sản phẩm vào giỏ hàng', 'error');
      location.hash = '#/login';
      return false;
    }
    if (!isCustomer()) { toast('Tài khoản quản trị không thể mua hàng', 'error'); return false; }
    try {
      const res = await api('/cart/items', { method: 'POST', body: { productId, quantity } });
      refreshCartBadge(res.data);
      toast('Đã thêm sản phẩm vào giỏ hàng');
      return true;
    } catch (err) {
      toast(err.fields && err.fields.quantity ? err.fields.quantity : err.message, 'error');
      return false;
    }
  }

  /* ---------------- Trang chủ ---------------- */
  async function renderHome() {
    const h = state.home;
    app.innerHTML = `
      <section class="hero">
        <div><h1>Chăm sóc sức khỏe chủ động mỗi ngày</h1>
        <p>Thực phẩm chức năng chính hãng, nguồn gốc rõ ràng. Miễn phí vận chuyển cho đơn hàng từ 500.000 ₫.</p></div>
        <div class="hero-emoji">🌿</div>
      </section>
      <div class="toolbar">
        <div class="chips" id="categoryChips"></div>
        <select id="sortSelect" aria-label="Sắp xếp">
          <option value="newest">Mới nhất</option>
          <option value="best_selling">Bán chạy</option>
          <option value="price_asc">Giá tăng dần</option>
          <option value="price_desc">Giá giảm dần</option>
        </select>
      </div>
      <div id="productArea"><div class="loading"><div class="spinner"></div>Đang tải sản phẩm...</div></div>`;
    $('#sortSelect').value = h.sort;
    $('#sortSelect').onchange = (e) => { h.sort = e.target.value; h.page = 1; loadProducts(); };
    if (!state.categories.length) {
      try { state.categories = (await api('/categories')).data; } catch (e) { state.categories = []; }
    }
    const chips = $('#categoryChips');
    chips.innerHTML = `<button class="chip ${h.category ? '' : 'active'}" data-cat="">Tất cả</button>` +
      state.categories.map((c) => `<button class="chip ${h.category === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    chips.onclick = (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      h.category = b.dataset.cat; h.page = 1;
      $$('.chip', chips).forEach((x) => x.classList.toggle('active', x === b));
      loadProducts();
    };
    loadProducts();
  }

  async function loadProducts() {
    const h = state.home;
    const area = $('#productArea');
    if (!area) return;
    const qs = new URLSearchParams({ page: h.page, size: 12, sort: h.sort });
    if (h.category) qs.set('category', h.category);
    try {
      const res = await api('/products?' + qs.toString());
      if (!res.data.length) { area.innerHTML = '<div class="empty"><div class="big">🔍</div>Chưa có sản phẩm trong danh mục này.</div>'; return; }
      area.innerHTML = `<div class="product-grid" id="productGrid">${res.data.map(productCard).join('')}</div>${paginationHtml(res.pagination)}`;
      bindProductGrid($('#productGrid'));
      bindPagination(area, (p) => { h.page = p; loadProducts(); });
    } catch (err) {
      area.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function paginationHtml(pg) {
    if (!pg || pg.totalPages <= 1) return '';
    let html = '<div class="pagination">';
    for (let i = 1; i <= pg.totalPages; i++) html += `<button class="btn btn-sm ${i === pg.page ? '' : 'btn-light'}" data-page="${i}">${i}</button>`;
    return html + '</div>';
  }
  function bindPagination(root, cb) {
    $$('.pagination [data-page]', root).forEach((b) => { b.onclick = () => cb(Number(b.dataset.page)); });
  }

  /* ---------------- Tìm kiếm ---------------- */
  async function renderSearch(q) {
    $('#searchInput').value = q;
    app.innerHTML = `<h2>Kết quả tìm kiếm cho “${esc(q)}”</h2><div id="searchArea"><div class="loading"><div class="spinner"></div>Đang tìm kiếm...</div></div>`;
    try {
      const res = await api('/products/search?q=' + encodeURIComponent(q));
      const area = $('#searchArea');
      if (!area) return;
      if (!res.data.length) { area.innerHTML = '<div class="empty"><div class="big">🔍</div>Không tìm thấy sản phẩm phù hợp. Hãy thử từ khóa khác.</div>'; return; }
      area.innerHTML = `<p class="muted">Tìm thấy ${res.pagination.total} sản phẩm</p><div class="product-grid" id="searchGrid">${res.data.map(productCard).join('')}</div>`;
      bindProductGrid($('#searchGrid'));
    } catch (err) {
      const area = $('#searchArea');
      if (area) area.innerHTML = `<div class="empty">${esc(err.fields && err.fields.q ? err.fields.q : err.message)}</div>`;
    }
  }

  /* ---------------- Chi tiết sản phẩm ---------------- */
  async function openProductDetail(id) {
    openModal('<div class="loading"><div class="spinner"></div>Đang tải thông tin sản phẩm...</div>');
    let p, rv;
    try {
      [p, rv] = await Promise.all([api('/products/' + encodeURIComponent(id)), api('/products/' + encodeURIComponent(id) + '/reviews')]);
      p = p.data;
    } catch (err) {
      $('#modalBody').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      return;
    }
    const stockHtml = p.stock === 0 ? '<span class="stock-out">Hết hàng</span>'
      : p.stock < 5 ? `<span class="stock-low">Chỉ còn ${p.stock} sản phẩm</span>` : `<span class="stock-ok">Còn hàng (${p.stock})</span>`;
    $('#modalBody').innerHTML = `
      <div class="detail" id="productDetail" data-id="${esc(p.id)}">
        <div class="detail-thumb">${imgTag(p.image, p.name)}</div>
        <div>
          <div class="product-brand">${esc(p.brand)} · ${esc(p.categoryName)}</div>
          <h2 id="detailName">${esc(p.name)}</h2>
          <div class="rating">${stars(p.ratingAvg)} <span>${p.ratingAvg}/5 (${p.ratingCount} đánh giá) · Đã bán ${p.sold}</span></div>
          ${priceHtml(p)}
          <div class="detail-meta">
            <div>Quy cách: <b>${esc(p.unit)}</b></div>
            <div>Xuất xứ: <b>${esc(p.origin)}</b></div>
            <div>Tình trạng: ${stockHtml}</div>
          </div>
          <div class="qty-row">
            <label for="detailQty" style="margin:0">Số lượng</label>
            <input type="number" id="detailQty" value="1" min="1" max="10" ${p.stock ? '' : 'disabled'}>
            <button class="btn" id="detailAdd" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Thêm vào giỏ hàng' : 'Hết hàng'}</button>
          </div>
        </div>
      </div>
      <div class="info-section"><h3>Thành phần</h3><p id="detailIngredients">${esc(p.ingredients)}</p></div>
      <div class="info-section"><h3>Công dụng</h3><p id="detailUses">${esc(p.uses)}</p></div>
      <div class="info-section"><h3>Liều dùng & cách dùng</h3><p id="detailDosage">${esc(p.dosage)}</p></div>
      <div class="info-section"><h3>Lưu ý</h3><p id="detailWarning">${esc(p.warning)}</p></div>
      <div class="disclaimer" id="detailDisclaimer">⚠️ ${esc(p.disclaimer)}</div>
      ${p.related && p.related.length ? `<div class="info-section"><h3>Sản phẩm liên quan</h3><div class="related">${p.related.map((r) =>
        `<div class="related-item" data-related="${esc(r.id)}">${imgTag(r.image, r.name, 'related-img')}${esc(r.name)}</div>`).join('')}</div></div>` : ''}
      <div class="reviews" id="reviewsBox">
        <h3>Đánh giá từ khách hàng (${rv.summary.ratingCount})</h3>
        <div id="reviewList">${rv.data.length ? rv.data.map((r) => `<div class="review"><div class="review-head"><b>${esc(r.userName)}</b><span>${fmtDate(r.createdAt)}</span></div>
          <div class="rating">${stars(r.rating)}</div><div>${esc(r.comment)}</div></div>`).join('') : '<p class="muted">Chưa có đánh giá nào.</p>'}</div>
        ${isCustomer() ? reviewFormHtml() : '<p class="muted">Đăng nhập bằng tài khoản khách hàng đã mua sản phẩm để viết đánh giá.</p>'}
      </div>`;
    const addBtn = $('#detailAdd');
    if (addBtn) addBtn.onclick = () => addToCart(p.id, Number($('#detailQty').value));
    $$('[data-related]').forEach((el) => { el.onclick = () => openProductDetail(el.dataset.related); });
    const rf = $('#reviewForm');
    if (rf) rf.onsubmit = (e) => submitReview(e, p.id);
  }
  function reviewFormHtml() {
    return `<form class="form" id="reviewForm" style="margin-top:12px">
      <h3>Viết đánh giá của bạn</h3>
      <div class="field"><div class="stars-input">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="star${n}" name="rating" value="${n}"><label for="star${n}" title="${n} sao">★</label>`).join('')}</div></div>
      <div class="field"><label for="reviewComment">Nhận xét (không bắt buộc)</label><textarea id="reviewComment" name="comment" rows="3" maxlength="500" placeholder="Chia sẻ trải nghiệm của bạn..."></textarea></div>
      <div><button class="btn" type="submit" id="reviewSubmit">Gửi đánh giá</button></div>
    </form>`;
  }
  async function submitReview(e, productId) {
    e.preventDefault();
    const form = e.target;
    const checked = form.querySelector('input[name=rating]:checked');
    if (!checked) { showFieldErrors(form, { rating: 'Vui lòng chọn số sao (1–5)' }); return; }
    const body = { rating: Number(checked.value) };
    const comment = form.comment.value.trim();
    if (comment) body.comment = comment;
    try {
      await api('/products/' + encodeURIComponent(productId) + '/reviews', { method: 'POST', body });
      toast('Cảm ơn bạn đã đánh giá sản phẩm!');
      openProductDetail(productId);
    } catch (err) {
      showFieldErrors(form, err.fields);
      toast(err.message, 'error');
    }
  }

  /* ---------------- Đăng nhập / Đăng ký ---------------- */
  function renderLogin() {
    if (state.user) { location.hash = '#/'; return; }
    app.innerHTML = `<div class="card auth-card"><h2>Đăng nhập</h2>
      <form class="form" id="loginForm" novalidate>
        <div class="field"><label for="loginEmail">Email</label><input type="email" id="loginEmail" name="email" autocomplete="username" required></div>
        <div class="field"><label for="loginPassword">Mật khẩu</label><input type="password" id="loginPassword" name="password" autocomplete="current-password" required></div>
        <div class="notice hidden" id="loginError"></div>
        <button class="btn btn-block" type="submit" id="loginSubmit">Đăng nhập</button>
        <p class="muted" style="margin:0">Chưa có tài khoản? <a href="#/register">Đăng ký ngay</a></p>
      </form></div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      $('#loginError').classList.add('hidden');
      try {
        const res = await api('/auth/login', { method: 'POST', body: { email: f.email.value.trim(), password: f.password.value } });
        saveSession(res.data.token, res.data.user);
        toast('Xin chào ' + res.data.user.fullName + '!');
        location.hash = res.data.user.role === 'ADMIN' ? '#/admin' : '#/';
      } catch (err) {
        showFieldErrors(f, err.fields);
        $('#loginError').textContent = err.message;
        $('#loginError').classList.remove('hidden');
      }
    };
  }

  function renderRegister() {
    if (state.user) { location.hash = '#/'; return; }
    app.innerHTML = `<div class="card auth-card"><h2>Đăng ký tài khoản</h2>
      <form class="form" id="registerForm" novalidate>
        <div class="field"><label for="regName">Họ và tên</label><input type="text" id="regName" name="fullName" required></div>
        <div class="field"><label for="regEmail">Email</label><input type="email" id="regEmail" name="email" required></div>
        <div class="field"><label for="regPhone">Số điện thoại</label><input type="tel" id="regPhone" name="phone" placeholder="0xxxxxxxxx" required></div>
        <div class="field"><label for="regPassword">Mật khẩu</label><input type="password" id="regPassword" name="password" autocomplete="new-password" required>
          <div class="muted" style="font-size:13px">8–32 ký tự, gồm cả chữ và số.</div></div>
        <div class="field"><label for="regConfirm">Nhập lại mật khẩu</label><input type="password" id="regConfirm" name="confirm" required></div>
        <button class="btn btn-block" type="submit" id="registerSubmit">Đăng ký</button>
        <p class="muted" style="margin:0">Đã có tài khoản? <a href="#/login">Đăng nhập</a></p>
      </form></div>`;
    $('#registerForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.password.value !== f.confirm.value) { showFieldErrors(f, { confirm: 'Mật khẩu nhập lại không khớp' }); return; }
      try {
        await api('/auth/register', {
          method: 'POST',
          body: { fullName: f.fullName.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), password: f.password.value },
        });
        toast('Đăng ký thành công! Vui lòng đăng nhập.');
        location.hash = '#/login';
      } catch (err) {
        showFieldErrors(f, err.fields);
        toast(err.message, 'error');
      }
    };
  }

  function requireCustomer() {
    if (!state.user) { toast('Vui lòng đăng nhập để tiếp tục', 'error'); location.hash = '#/login'; return false; }
    if (!isCustomer()) { app.innerHTML = '<div class="empty"><div class="big">🔒</div>Chức năng chỉ dành cho khách hàng.</div>'; return false; }
    return true;
  }

  /* ---------------- Giỏ hàng ---------------- */
  async function renderCart() {
    if (!requireCustomer()) return;
    app.innerHTML = '<div class="loading"><div class="spinner"></div>Đang tải giỏ hàng...</div>';
    try { drawCart((await api('/cart')).data); } catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }
  function cartSummaryHtml(c, withCoupon) {
    return `<div class="summary-line"><span>Tạm tính (${c.totalQuantity} sản phẩm)</span><span id="sumSubtotal">${money(c.subtotal)}</span></div>
      <div class="summary-line"><span>Giảm giá</span><span id="sumDiscount">${c.discount ? '-' + money(c.discount) : money(0)}</span></div>
      <div class="summary-line"><span>Phí vận chuyển</span><span id="sumShipping">${c.shippingFee ? money(c.shippingFee) : 'Miễn phí'}</span></div>
      ${withCoupon ? couponBoxHtml(c) : ''}
      <div class="summary-line summary-total"><span>Tổng cộng</span><span id="sumTotal">${money(c.total)}</span></div>`;
  }
  function couponBoxHtml(c) {
    if (c.coupon) {
      return `<div class="coupon-applied" id="couponApplied"><span>🏷️ <b>${esc(c.coupon.code)}</b> – ${esc(c.coupon.description)}</span>
        <button class="link-btn" style="color:var(--red)" id="couponRemove">Bỏ mã</button></div>`;
    }
    return `<form class="coupon-form" id="couponForm"><input type="text" name="code" id="couponInput" placeholder="Nhập mã giảm giá" maxlength="20">
      <button class="btn btn-light" type="submit" id="couponApply">Áp dụng</button></form>
      ${c.couponMessage ? `<div class="notice">${esc(c.couponMessage)}</div>` : ''}`;
  }
  function drawCart(c) {
    refreshCartBadge(c);
    if (!c.items.length) {
      app.innerHTML = '<div class="empty"><div class="big">🛒</div><p>Giỏ hàng của bạn đang trống.</p><a class="btn" href="#/">Tiếp tục mua sắm</a></div>';
      return;
    }
    app.innerHTML = `<h1>Giỏ hàng</h1><div class="layout-2col">
      <div class="card"><table class="cart-table" id="cartTable"><thead><tr><th>Sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th></th></tr></thead>
      <tbody>${c.items.map((i) => `<tr data-id="${esc(i.productId)}">
        <td><div class="cart-prod"><span class="emo">${imgTag(i.image, i.name)}</span><div><b>${esc(i.name)}</b><div class="muted" style="font-size:13px">${esc(i.unit)}</div></div></div></td>
        <td>${money(i.price)}</td>
        <td><input type="number" class="qty-input" value="${i.quantity}" min="1" max="10" aria-label="Số lượng"></td>
        <td><b class="line-total">${money(i.lineTotal)}</b></td>
        <td><button class="link-btn remove-item" style="color:var(--red)">Xóa</button></td></tr>`).join('')}</tbody></table></div>
      <aside class="card" id="cartSummary"><h3>Tóm tắt đơn hàng</h3>${cartSummaryHtml(c, true)}
        <a class="btn btn-checkout btn-block" href="#/checkout" id="checkoutBtn" style="margin-top:12px">Tiến hành đặt hàng</a>
        <p class="muted" style="font-size:13px;margin-bottom:0">Miễn phí vận chuyển cho đơn hàng từ 500.000 ₫.</p></aside></div>`;
    $$('#cartTable tbody tr').forEach((tr) => {
      const id = tr.dataset.id;
      $('.qty-input', tr).onchange = async (e) => {
        try { drawCart((await api('/cart/items/' + encodeURIComponent(id), { method: 'PUT', body: { quantity: Number(e.target.value) } })).data); }
        catch (err) { toast(err.fields && err.fields.quantity ? err.fields.quantity : err.message, 'error'); renderCart(); }
      };
      $('.remove-item', tr).onclick = async () => {
        try { drawCart((await api('/cart/items/' + encodeURIComponent(id), { method: 'DELETE' })).data); toast('Đã xóa sản phẩm khỏi giỏ'); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
    const cf = $('#couponForm');
    if (cf) cf.onsubmit = async (e) => {
      e.preventDefault();
      try { drawCart((await api('/cart/coupon', { method: 'POST', body: { code: cf.code.value.trim() } })).data); toast('Áp dụng mã giảm giá thành công'); }
      catch (err) { toast(err.fields && err.fields.code ? err.fields.code : err.message, 'error'); }
    };
    const cr = $('#couponRemove');
    if (cr) cr.onclick = async () => { try { drawCart((await api('/cart/coupon', { method: 'DELETE' })).data); } catch (err) { toast(err.message, 'error'); } };
  }

  /* ---------------- Đặt hàng ---------------- */
  async function renderCheckout() {
    if (!requireCustomer()) return;
    let c;
    try { c = (await api('/cart')).data; } catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    if (!c.items.length) { location.hash = '#/cart'; return; }
    const u = state.user;
    app.innerHTML = `<h1>Thông tin đặt hàng</h1><div class="layout-2col">
      <form class="card form" id="checkoutForm" novalidate>
        <h3>Địa chỉ giao hàng</h3>
        <div class="form-row">
          <div class="field"><label for="shipName">Họ tên người nhận</label><input type="text" id="shipName" name="shippingAddress.fullName" value="${esc(u.fullName)}"></div>
          <div class="field"><label for="shipPhone">Số điện thoại</label><input type="tel" id="shipPhone" name="shippingAddress.phone" value="${esc(u.phone || '')}"></div>
        </div>
        <div class="field"><label for="shipAddress">Địa chỉ</label><input type="text" id="shipAddress" name="shippingAddress.address" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"></div>
        <div class="field"><label for="orderNote">Ghi chú (không bắt buộc)</label><textarea id="orderNote" name="note" rows="2" maxlength="200" placeholder="Ví dụ: giao giờ hành chính"></textarea></div>
        <h3>Phương thức thanh toán</h3>
        <div class="radio-group field">
          <label class="radio-card"><input type="radio" name="paymentMethod" value="COD" checked><span><b>Thanh toán khi nhận hàng (COD)</b><br><span class="muted">Trả tiền mặt cho nhân viên giao hàng</span></span></label>
          <label class="radio-card"><input type="radio" name="paymentMethod" value="EWALLET"><span><b>Ví điện tử HealthyPay</b><br><span class="muted">Xác thực bằng mã OTP sau khi đặt hàng</span></span></label>
        </div>
        <button class="btn btn-block" type="submit" id="placeOrderBtn">Đặt hàng</button>
      </form>
      <aside class="card"><h3>Đơn hàng (${c.totalQuantity} sản phẩm)</h3>
        ${c.items.map((i) => `<div class="summary-line"><span class="sum-prod">${imgTag(i.image, i.name, 'mini-img')} ${esc(i.name)} × ${i.quantity}</span><span>${money(i.lineTotal)}</span></div>`).join('')}
        <hr style="border:0;border-top:1px solid var(--line)">
        ${c.coupon ? `<div class="summary-line"><span>Mã giảm giá</span><b>${esc(c.coupon.code)}</b></div>` : ''}
        ${cartSummaryHtml(c, false)}
      </aside></div>`;
    $('#checkoutForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = $('#placeOrderBtn');
      btn.disabled = true;
      try {
        const res = await api('/orders', {
          method: 'POST',
          body: {
            shippingAddress: { fullName: $('#shipName').value.trim(), phone: $('#shipPhone').value.trim(), address: $('#shipAddress').value.trim() },
            paymentMethod: f.querySelector('input[name=paymentMethod]:checked').value,
            note: $('#orderNote').value.trim(),
          },
        });
        refreshCartBadge();
        toast('Đặt hàng thành công! Mã đơn: ' + res.data.id);
        location.hash = '#/orders/' + res.data.id;
      } catch (err) {
        showFieldErrors(f, err.fields);
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
  }

  /* ---------------- Đơn hàng ---------------- */
  async function renderOrders() {
    if (!requireCustomer()) return;
    app.innerHTML = '<h1>Đơn hàng của tôi</h1><div id="ordersArea"><div class="loading"><div class="spinner"></div></div></div>';
    try {
      const res = await api('/orders?size=50');
      const area = $('#ordersArea');
      if (!res.data.length) { area.innerHTML = '<div class="empty"><div class="big">📦</div>Bạn chưa có đơn hàng nào.</div>'; return; }
      area.innerHTML = `<div class="table-wrap"><table class="table" id="ordersTable"><thead><tr><th>Mã đơn</th><th>Ngày đặt</th><th>Số SP</th><th>Tổng tiền</th><th>Thanh toán</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${res.data.map((o) => `<tr><td><b>${esc(o.id)}</b></td><td>${fmtDate(o.createdAt)}</td><td>${o.itemCount}</td><td>${money(o.total)}</td>
        <td class="pay-${o.paymentStatus}">${PAY_LABEL[o.paymentStatus]}</td><td><span class="status status-${o.status}">${STATUS_LABEL[o.status]}</span></td>
        <td><a href="#/orders/${encodeURIComponent(o.id)}">Xem chi tiết</a></td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { $('#ordersArea').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function renderOrderDetail(id) {
    if (!requireCustomer()) return;
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    let o;
    try { o = (await api('/orders/' + encodeURIComponent(id))).data; } catch (err) { app.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    app.innerHTML = `<p><a href="#/orders">← Danh sách đơn hàng</a></p>
      <h1>Đơn hàng ${esc(o.id)} <span class="status status-${o.status}" id="orderStatus">${STATUS_LABEL[o.status]}</span></h1>
      <div class="layout-2col">
        <div class="card">
          <table class="cart-table"><thead><tr><th>Sản phẩm</th><th>Đơn giá</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody>
          ${o.items.map((i) => `<tr><td><div class="cart-prod"><span class="emo">${imgTag(i.image, i.name)}</span><b>${esc(i.name)}</b></div></td><td>${money(i.price)}</td><td>${i.quantity}</td><td>${money(i.lineTotal)}</td></tr>`).join('')}
          </tbody></table>
          <h3 style="margin-top:20px">Giao đến</h3>
          <p style="margin:0">${esc(o.shippingAddress.fullName)} · ${esc(o.shippingAddress.phone)}<br>${esc(o.shippingAddress.address)}</p>
          ${o.note ? `<p class="muted">Ghi chú: ${esc(o.note)}</p>` : ''}
          <h3 style="margin-top:20px">Lịch sử trạng thái</h3>
          <ul class="timeline">${o.history.map((h) => `<li><b>${STATUS_LABEL[h.status]}</b> – ${fmtDate(h.at)}</li>`).join('')}</ul>
        </div>
        <aside class="card"><h3>Thanh toán</h3>
          <div class="summary-line"><span>Phương thức</span><span>${METHOD_LABEL[o.paymentMethod]}</span></div>
          <div class="summary-line"><span>Trạng thái</span><b class="pay-${o.paymentStatus}" id="payStatus">${PAY_LABEL[o.paymentStatus]}</b></div>
          <div class="summary-line"><span>Tạm tính</span><span>${money(o.subtotal)}</span></div>
          <div class="summary-line"><span>Giảm giá ${o.couponCode ? '(' + esc(o.couponCode) + ')' : ''}</span><span>${o.discount ? '-' + money(o.discount) : money(0)}</span></div>
          <div class="summary-line"><span>Phí vận chuyển</span><span>${o.shippingFee ? money(o.shippingFee) : 'Miễn phí'}</span></div>
          <div class="summary-line summary-total"><span>Tổng cộng</span><span>${money(o.total)}</span></div>
          ${o.canPay ? `<form class="form" id="payForm" style="margin-top:14px"><div class="field"><label for="otpInput">Nhập mã OTP ví HealthyPay</label>
            <input type="text" id="otpInput" name="otp" inputmode="numeric" maxlength="6" placeholder="6 chữ số"></div>
            <button class="btn btn-block" id="payBtn" type="submit">Xác nhận thanh toán</button>
            <p class="muted" style="font-size:13px;margin:0">Môi trường thử nghiệm: mã OTP là 123456.</p></form>` : ''}
          <div class="order-actions">${o.canCancel ? '<button class="btn btn-danger btn-block" id="cancelOrderBtn">Hủy đơn hàng</button>' : ''}</div>
        </aside>
      </div>`;
    const pf = $('#payForm');
    if (pf) pf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/orders/' + encodeURIComponent(o.id) + '/pay', { method: 'POST', body: { otp: pf.otp.value.trim() } }); toast('Thanh toán thành công'); renderOrderDetail(o.id); }
      catch (err) { showFieldErrors(pf, err.fields); toast(err.message, 'error'); }
    };
    const cb = $('#cancelOrderBtn');
    if (cb) cb.onclick = async () => {
      if (!(await confirmDialog('Bạn chắc chắn muốn hủy đơn hàng ' + o.id + '?', 'Hủy đơn'))) return;
      try { await api('/orders/' + encodeURIComponent(o.id) + '/cancel', { method: 'POST', body: { reason: 'Khách hàng hủy trên website' } }); toast('Đã hủy đơn hàng'); renderOrderDetail(o.id); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ---------------- Quản trị ---------------- */
  function renderAdmin() {
    if (!state.user) { location.hash = '#/login'; return; }
    if (!isAdmin()) { app.innerHTML = '<div class="empty"><div class="big">🔒</div>Bạn không có quyền truy cập trang quản trị.</div>'; return; }
    app.innerHTML = `<h1>Trang quản trị</h1>
      <div class="tabs" id="adminTabs">
        <button class="tab" data-tab="products">Sản phẩm</button>
        <button class="tab" data-tab="orders">Đơn hàng</button>
        <button class="tab" data-tab="stats">Thống kê</button>
      </div><div id="adminArea"></div>`;
    $('#adminTabs').onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { state.adminTab = t.dataset.tab; drawAdminTab(); } };
    drawAdminTab();
  }
  function drawAdminTab() {
    $$('#adminTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.adminTab));
    if (state.adminTab === 'products') adminProducts();
    else if (state.adminTab === 'orders') adminOrders();
    else adminStats();
  }

  async function adminProducts() {
    const area = $('#adminArea');
    area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const res = await api('/admin/products?size=50');
      if (!state.categories.length) state.categories = (await api('/categories')).data;
      area.innerHTML = `<div class="toolbar"><span class="muted">${res.pagination.total} sản phẩm</span><button class="btn" id="addProductBtn">+ Thêm sản phẩm</button></div>
        <div class="table-wrap"><table class="table" id="adminProductTable"><thead><tr><th>Mã</th><th>Sản phẩm</th><th>Danh mục</th><th>Giá bán</th><th>Tồn kho</th><th>Đã bán</th><th>Trạng thái</th><th></th></tr></thead><tbody>
        ${res.data.map((p) => `<tr class="${p.isActive ? '' : 'inactive-row'}" data-id="${esc(p.id)}"><td>${esc(p.id)}</td><td><span class="admin-prod">${imgTag(p.image, p.name, 'mini-img')} ${esc(p.name)}</span></td>
          <td>${esc((state.categories.find((c) => c.id === p.category) || {}).name || p.category)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${p.sold}</td>
          <td>${p.isActive ? 'Đang bán' : 'Ngừng bán'}</td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-light edit-product">Sửa</button> ${p.isActive ? '<button class="btn btn-sm btn-danger delete-product">Ngừng bán</button>' : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      $('#addProductBtn').onclick = () => productForm(null);
      $$('#adminProductTable tbody tr').forEach((tr) => {
        const p = res.data.find((x) => x.id === tr.dataset.id);
        $('.edit-product', tr).onclick = () => productForm(p);
        const del = $('.delete-product', tr);
        if (del) del.onclick = async () => {
          if (!(await confirmDialog('Ngừng kinh doanh sản phẩm "' + p.name + '"?', 'Ngừng bán'))) return;
          try { await api('/admin/products/' + p.id, { method: 'DELETE' }); toast('Đã ngừng kinh doanh sản phẩm'); adminProducts(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { area.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  function productForm(p) {
    const v = p || { name: '', category: state.categories[0] ? state.categories[0].id : '', brand: '', price: '', originalPrice: '', stock: '', unit: '', origin: 'Việt Nam', image: PLACEHOLDER, shortDescription: '', ingredients: '', uses: '', dosage: '', warning: '' };
    openModal(`<h2>${p ? 'Sửa sản phẩm ' + esc(p.id) : 'Thêm sản phẩm mới'}</h2>
      <form class="form" id="productForm" novalidate>
        <div class="field"><label>Tên sản phẩm *</label><input type="text" name="name" value="${esc(v.name)}"></div>
        <div class="form-row">
          <div class="field"><label>Danh mục *</label><select name="category">${state.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === v.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Thương hiệu *</label><input type="text" name="brand" value="${esc(v.brand)}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Giá bán (₫) *</label><input type="number" name="price" value="${esc(v.price)}"></div>
          <div class="field"><label>Giá gốc (₫)</label><input type="number" name="originalPrice" value="${esc(v.originalPrice == null ? '' : v.originalPrice)}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Tồn kho *</label><input type="number" name="stock" value="${esc(v.stock)}"></div>
          <div class="field"><label>Quy cách *</label><input type="text" name="unit" value="${esc(v.unit)}" placeholder="Hộp 60 viên"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Xuất xứ</label><input type="text" name="origin" value="${esc(v.origin)}"></div>
          <div class="field"><label>Ảnh (URL hoặc /images/...)</label><input type="text" name="image" value="${esc(v.image)}"></div>
        </div>
        <div class="field"><label>Mô tả ngắn</label><input type="text" name="shortDescription" value="${esc(v.shortDescription)}"></div>
        <div class="field"><label>Thành phần</label><textarea name="ingredients" rows="2">${esc(v.ingredients)}</textarea></div>
        <div class="field"><label>Công dụng</label><textarea name="uses" rows="2">${esc(v.uses)}</textarea></div>
        <div class="field"><label>Liều dùng</label><textarea name="dosage" rows="2">${esc(v.dosage)}</textarea></div>
        <div class="field"><label>Lưu ý</label><textarea name="warning" rows="2">${esc(v.warning)}</textarea></div>
        <button class="btn" type="submit" id="productSave">${p ? 'Lưu thay đổi' : 'Thêm sản phẩm'}</button>
      </form>`);
    $('#productForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const num = (x) => (x.trim() === '' ? undefined : Number(x));
      const body = {
        name: f.name.value, category: f.category.value, brand: f.brand.value, price: num(f.price.value),
        originalPrice: f.originalPrice.value.trim() === '' ? null : Number(f.originalPrice.value), stock: num(f.stock.value),
        unit: f.unit.value, origin: f.origin.value, image: f.image.value, shortDescription: f.shortDescription.value,
        ingredients: f.ingredients.value, uses: f.uses.value, dosage: f.dosage.value, warning: f.warning.value,
      };
      try {
        await api(p ? '/admin/products/' + p.id : '/admin/products', { method: p ? 'PUT' : 'POST', body });
        closeModal();
        toast(p ? 'Đã cập nhật sản phẩm' : 'Đã thêm sản phẩm mới');
        adminProducts();
      } catch (err) { showFieldErrors(f, err.fields); toast(err.message, 'error'); }
    };
  }

  async function adminOrders() {
    const area = $('#adminArea');
    area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const qs = state.adminOrderFilter ? '&status=' + state.adminOrderFilter : '';
    try {
      const res = await api('/admin/orders?size=50' + qs);
      area.innerHTML = `<div class="toolbar"><select id="orderFilter" style="width:auto"><option value="">Tất cả trạng thái</option>
        ${Object.keys(STATUS_LABEL).map((s) => `<option value="${s}" ${s === state.adminOrderFilter ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
        <span class="muted">${res.pagination.total} đơn hàng</span></div>
        <div class="table-wrap"><table class="table" id="adminOrderTable"><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Ngày đặt</th><th>Tổng tiền</th><th>Thanh toán</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>
        ${res.data.map((o) => `<tr data-id="${esc(o.id)}"><td><b>${esc(o.id)}</b></td><td>${esc(o.customer ? o.customer.fullName : '')}<br><span class="muted" style="font-size:12px">${esc(o.customer ? o.customer.email : '')}</span></td>
          <td>${fmtDate(o.createdAt)}</td><td>${money(o.total)}</td><td><span class="pay-${o.paymentStatus}">${o.paymentMethod} · ${PAY_LABEL[o.paymentStatus]}</span></td>
          <td><span class="status status-${o.status}">${STATUS_LABEL[o.status]}</span></td>
          <td>${o.nextStatuses.length ? `<select class="next-status" style="width:auto"><option value="">-- Chọn --</option>${o.nextStatuses.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>`;
      $('#orderFilter').onchange = (e) => { state.adminOrderFilter = e.target.value; adminOrders(); };
      $$('#adminOrderTable .next-status').forEach((sel) => {
        sel.onchange = async () => {
          if (!sel.value) return;
          const id = sel.closest('tr').dataset.id;
          try { await api('/admin/orders/' + id + '/status', { method: 'PATCH', body: { status: sel.value } }); toast('Đã cập nhật trạng thái đơn ' + id); adminOrders(); }
          catch (err) { toast(err.message, 'error'); sel.value = ''; }
        };
      });
    } catch (err) { area.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  async function adminStats() {
    const area = $('#adminArea');
    area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const s = (await api('/admin/stats')).data;
      area.innerHTML = `<div class="stats-grid">
          <div class="stat"><div class="label">Doanh thu (đơn đã giao)</div><div class="value" id="statRevenue">${money(s.totalRevenue)}</div></div>
          <div class="stat"><div class="label">Tổng đơn hàng</div><div class="value">${s.totalOrders}</div></div>
          <div class="stat"><div class="label">Khách hàng</div><div class="value">${s.totalCustomers}</div></div>
          <div class="stat"><div class="label">Sản phẩm đang bán</div><div class="value">${s.totalProducts}</div></div>
        </div>
        <div class="layout-2col">
          <div class="card"><h3>Sản phẩm bán chạy</h3><table class="table"><thead><tr><th>Sản phẩm</th><th>Số lượng</th></tr></thead><tbody>
            ${s.topProducts.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.quantity}</td></tr>`).join('')}</tbody></table></div>
          <div class="card"><h3>Đơn theo trạng thái</h3>${Object.entries(s.ordersByStatus).map(([k, v]) => `<div class="summary-line"><span class="status status-${k}">${STATUS_LABEL[k]}</span><b>${v}</b></div>`).join('')}
            <h3 style="margin-top:16px">Sắp hết hàng (&lt; 5)</h3>${s.lowStock.length ? s.lowStock.map((p) => `<div class="summary-line"><span>${esc(p.name)}</span><b>${p.stock}</b></div>`).join('') : '<p class="muted">Không có</p>'}</div>
        </div>`;
    } catch (err) { area.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }

  /* ---------------- Router ---------------- */
  function setActiveNav(name) { $$('#mainNav [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name)); }

  function route() {
    closeModal();
    const hash = location.hash || '#/';
    const [pathPart, query] = hash.slice(1).split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const params = new URLSearchParams(query || '');
    window.scrollTo(0, 0);
    switch (parts[0]) {
      case undefined: setActiveNav('home'); return renderHome();
      case 'search': setActiveNav('home'); return renderSearch(params.get('q') || '');
      case 'login': setActiveNav('login'); return renderLogin();
      case 'register': setActiveNav('register'); return renderRegister();
      case 'cart': setActiveNav('cart'); return renderCart();
      case 'checkout': setActiveNav('cart'); return renderCheckout();
      case 'orders': setActiveNav('orders'); return parts[1] ? renderOrderDetail(decodeURIComponent(parts[1])) : renderOrders();
      case 'admin': setActiveNav('admin'); return renderAdmin();
      default: app.innerHTML = '<div class="empty"><div class="big">🧭</div>Không tìm thấy trang. <a href="#/">Về trang chủ</a></div>';
    }
  }

  /* ---------------- Khởi động ---------------- */
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (q.length < 2) { toast('Vui lòng nhập từ khóa tối thiểu 2 ký tự', 'error'); return; }
    location.hash = '#/search?q=' + encodeURIComponent(q);
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* bỏ qua */ }
    saveSession(null, null);
    toast('Đã đăng xuất');
    location.hash = '#/';
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.dataset.close) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  window.addEventListener('hashchange', route);

  loadSession();
  updateHeader();
  if (state.token) {
    api('/auth/me').then((r) => { state.user = r.data; saveSession(state.token, r.data); }).catch(() => {});
  }
  route();
})();
