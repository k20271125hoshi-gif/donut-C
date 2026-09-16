const DEFAULT_PRODUCTS = [
  { id: 'sugar', name: 'シュガー', price: 250, stock: 30, emoji: '🍩', note: '定番' },
  { id: 'choco', name: 'チョコ', price: 300, stock: 30, emoji: '🍫', note: '人気' },
  { id: 'strawberry', name: 'いちご', price: 300, stock: 24, emoji: '🍓', note: '数量限定' },
  { id: 'matcha', name: '抹茶', price: 320, stock: 20, emoji: '🍵', note: 'おすすめ' },
  { id: 'custard', name: 'カスタード', price: 350, stock: 20, emoji: '🥚', note: 'クリーム入り' },
  { id: 'plain', name: 'プレーン', price: 220, stock: 30, emoji: '✨', note: 'シンプル' }
];

const LOCATIONS = {
  sales: { name: '体育館横・販売所', short: '販売所', icon: '🏪' },
  kitchen: { name: '家庭科調理室', short: '調理室', icon: '🍳' },
  transport: { name: '運搬・連絡', short: '運搬', icon: '🚶' }
};

const BUSY_LABELS = {
  1: '余裕あり',
  2: '通常',
  3: 'やや忙しい',
  4: '応援ほしい',
  5: '緊急レベル'
};

const STORAGE_KEY = 'donut-match-v3';
const LEGACY_STORAGE_KEY = 'donut-match-v1';
const DEVICE_LOCATION_KEY = 'donut-match-device-location';
const ACTIVE_VIEW_KEY = 'donut-match-active-view';

let state = loadState();
let cart = {};
let filter = 'all';
let activeView = localStorage.getItem(ACTIVE_VIEW_KEY) || 'sales';
let deviceLocation = localStorage.getItem(DEVICE_LOCATION_KEY) || 'sales';
let selectedPeople = 1;
let selectedReason = '混雑対応';

const els = {
  productGrid: document.getElementById('productGrid'),
  cartItems: document.getElementById('cartItems'),
  cartEmpty: document.getElementById('cartEmpty'),
  cartTotal: document.getElementById('cartTotal'),
  submitOrderBtn: document.getElementById('submitOrderBtn'),
  clearCartBtn: document.getElementById('clearCartBtn'),
  queueList: document.getElementById('queueList'),
  inventoryList: document.getElementById('inventoryList'),
  nextNumber: document.getElementById('nextNumber'),
  soldCount: document.getElementById('soldCount'),
  waitingCount: document.getElementById('waitingCount'),
  mobileWaitingCount: document.getElementById('mobileWaitingCount'),
  resetBtn: document.getElementById('resetBtn'),
  inventoryEditBtn: document.getElementById('inventoryEditBtn'),
  inventoryDialog: document.getElementById('inventoryDialog'),
  inventoryFormRows: document.getElementById('inventoryFormRows'),
  inventoryForm: document.getElementById('inventoryForm'),
  toast: document.getElementById('toast'),
  deviceLocationSelect: document.getElementById('deviceLocationSelect'),
  statusGrid: document.getElementById('statusGrid'),
  currentLocationChip: document.getElementById('currentLocationChip'),
  helpLocationChip: document.getElementById('helpLocationChip'),
  helpOriginLabel: document.getElementById('helpOriginLabel'),
  peopleChoice: document.getElementById('peopleChoice'),
  reasonChoice: document.getElementById('reasonChoice'),
  helpMemo: document.getElementById('helpMemo'),
  urgentHelp: document.getElementById('urgentHelp'),
  sendHelpBtn: document.getElementById('sendHelpBtn'),
  helpRequestList: document.getElementById('helpRequestList'),
  activeHelpCount: document.getElementById('activeHelpCount'),
  helpNavCount: document.getElementById('helpNavCount'),
  mobileHelpNavCount: document.getElementById('mobileHelpNavCount'),
  statusNavDot: document.getElementById('statusNavDot'),
  mobileStatusNavDot: document.getElementById('mobileStatusNavDot')
};

function defaultOperations() {
  const now = Date.now();
  return {
    locations: {
      sales: { busy: 2, updatedAt: now },
      kitchen: { busy: 2, updatedAt: now },
      transport: { busy: 2, updatedAt: now }
    },
    helpRequests: []
  };
}

function newBaseState() {
  return {
    products: structuredClone(DEFAULT_PRODUCTS),
    orders: [],
    nextOrderNumber: 1,
    operations: defaultOperations()
  };
}

function normalizeState(raw) {
  const base = newBaseState();
  if (!raw || !Array.isArray(raw.products) || !Array.isArray(raw.orders)) return base;
  return {
    products: raw.products,
    orders: raw.orders,
    nextOrderNumber: Number(raw.nextOrderNumber) || 1,
    operations: {
      locations: {
        ...base.operations.locations,
        ...(raw.operations?.locations || {})
      },
      helpRequests: Array.isArray(raw.operations?.helpRequests) ? raw.operations.helpRequests : []
    }
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return normalizeState(saved);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) return normalizeState(legacy);
  } catch (_) {}
  return newBaseState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try {
    channel?.postMessage({ type: 'state-updated', at: Date.now() });
  } catch (_) {}
}

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('donut-match-ops') : null;
if (channel) {
  channel.addEventListener('message', event => {
    if (event.data?.type !== 'state-updated') return;
    try {
      const fresh = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (fresh) {
        state = normalizeState(fresh);
        render();
      }
    } catch (_) {}
  });
}

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    state = normalizeState(JSON.parse(event.newValue));
    render();
  } catch (_) {}
});

function money(n) { return `¥${n.toLocaleString('ja-JP')}`; }
function orderNo(n) { return String(n).padStart(3, '0'); }
function getProduct(id) { return state.products.find(p => p.id === id); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function locationInfo(id) { return LOCATIONS[id] || LOCATIONS.sales; }

function timeAgo(timestamp) {
  const diff = Math.max(0, Date.now() - Number(timestamp || Date.now()));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  return `${hours}時間前`;
}

function clockTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function render() {
  renderProducts();
  renderCart();
  renderQueue();
  renderInventory();
  renderStats();
  renderStatus();
  renderHelpRequests();
  renderNavigationBadges();
  updateLocationLabels();
}

function switchView(view) {
  if (!['sales', 'status', 'help'].includes(view)) view = 'sales';
  activeView = view;
  localStorage.setItem(ACTIVE_VIEW_KEY, activeView);

  document.querySelectorAll('.app-view').forEach(section => {
    const isActive = section.dataset.view === view;
    section.hidden = !isActive;
    section.classList.toggle('active', isActive);
  });

  document.querySelectorAll('[data-view-target]').forEach(btn => {
    const isActive = btn.dataset.viewTarget === view;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderProducts() {
  els.productGrid.innerHTML = state.products.map(p => {
    const inCart = cart[p.id] || 0;
    const available = p.stock - inCart;
    return `
      <button class="product-card" data-product-id="${p.id}" ${available <= 0 ? 'disabled' : ''}>
        <span class="stock-badge">残 ${Math.max(0, available)}</span>
        <span class="product-emoji">${p.emoji}</span>
        <span class="product-meta"><strong>${p.name}</strong><span>${p.note}</span></span>
        <span class="product-price">${money(p.price)}</span>
      </button>`;
  }).join('');

  document.querySelectorAll('[data-product-id]').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.productId));
  });
}

function addToCart(id) {
  const p = getProduct(id);
  const current = cart[id] || 0;
  if (current >= p.stock) return showToast(`${p.name}は在庫上限です`);
  cart[id] = current + 1;
  renderProducts();
  renderCart();
}

function changeQty(id, delta) {
  const p = getProduct(id);
  const next = (cart[id] || 0) + delta;
  if (next <= 0) delete cart[id];
  else if (next <= p.stock) cart[id] = next;
  renderProducts();
  renderCart();
}

function renderCart() {
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  els.cartEmpty.hidden = entries.length > 0;
  els.submitOrderBtn.disabled = entries.length === 0;

  els.cartItems.innerHTML = entries.map(([id, qty]) => {
    const p = getProduct(id);
    return `
      <div class="cart-row">
        <div><strong>${p.name}</strong><div style="font-size:12px;color:#746d67">${money(p.price)} × ${qty}</div></div>
        <div class="qty-control">
          <button class="qty-btn" data-id="${id}" data-delta="-1" aria-label="${p.name}を1つ減らす">−</button>
          <strong>${qty}</strong>
          <button class="qty-btn" data-id="${id}" data-delta="1" aria-label="${p.name}を1つ増やす">＋</button>
        </div>
        <strong>${money(p.price * qty)}</strong>
      </div>`;
  }).join('');

  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => changeQty(btn.dataset.id, Number(btn.dataset.delta)));
  });

  const total = entries.reduce((sum, [id, qty]) => sum + getProduct(id).price * qty, 0);
  els.cartTotal.textContent = money(total);
}

function submitOrder() {
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  if (!entries.length) return;

  for (const [id, qty] of entries) {
    const p = getProduct(id);
    if (p.stock < qty) return showToast(`${p.name}の在庫が足りません`);
  }

  const total = entries.reduce((sum, [id, qty]) => sum + getProduct(id).price * qty, 0);
  const order = {
    id: uid(),
    number: state.nextOrderNumber,
    items: entries.map(([id, qty]) => ({ productId: id, qty })),
    total,
    status: 'preparing',
    createdAt: Date.now()
  };

  entries.forEach(([id, qty]) => { getProduct(id).stock -= qty; });
  state.orders.unshift(order);
  state.nextOrderNumber += 1;
  cart = {};
  saveState();
  render();
  showToast(`注文 ${orderNo(order.number)} を登録しました`);
}

function renderQueue() {
  const visible = state.orders.filter(o => {
    if (o.status === 'completed' || o.status === 'cancelled') return false;
    return filter === 'all' ? true : o.status === filter;
  });

  if (!visible.length) {
    els.queueList.innerHTML = `<div class="queue-empty">現在、待ち注文はありません</div>`;
    return;
  }

  els.queueList.innerHTML = visible.map(o => {
    const itemLines = o.items.map(i => {
      const p = getProduct(i.productId);
      return `<div class="item-line"><strong>${p?.name ?? i.productId}</strong><span>× ${i.qty}</span></div>`;
    }).join('');
    const ready = o.status === 'ready';
    return `
      <article class="order-card ${ready ? 'ready' : ''}">
        <div class="order-card-head">
          <div><div class="order-no-label">注文番号</div><div class="order-no">${orderNo(o.number)}</div></div>
          <span class="status-chip">${ready ? '受取可' : '準備中'}</span>
        </div>
        <div class="order-items">
          ${itemLines}
          <div class="order-total-line"><strong>${money(o.total)}</strong></div>
        </div>
        <div class="order-actions">
          ${ready
            ? `<button class="complete-btn" data-action="complete" data-order-id="${o.id}">番号確認 → 受け渡し完了</button>`
            : `<button class="ready-btn" data-action="ready" data-order-id="${o.id}">商品準備完了 → 受取可</button>`}
          <button class="cancel-btn" title="注文取消" data-action="cancel" data-order-id="${o.id}">×</button>
        </div>
      </article>`;
  }).join('');

  document.querySelectorAll('[data-order-id]').forEach(btn => {
    btn.addEventListener('click', () => updateOrder(btn.dataset.orderId, btn.dataset.action));
  });
}

function updateOrder(id, action) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;

  if (action === 'ready') {
    order.status = 'ready';
    showToast(`注文 ${orderNo(order.number)} は受け渡しできます`);
  }
  if (action === 'complete') {
    order.status = 'completed';
    showToast(`注文 ${orderNo(order.number)} を受け渡しました`);
  }
  if (action === 'cancel') {
    if (!confirm(`注文 ${orderNo(order.number)} を取消しますか？\n在庫は自動で戻ります。`)) return;
    order.status = 'cancelled';
    order.items.forEach(i => { const p = getProduct(i.productId); if (p) p.stock += i.qty; });
  }

  saveState();
  render();
}

function renderInventory() {
  els.inventoryList.innerHTML = state.products.map(p => {
    const cls = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
    return `
      <div class="inventory-row">
        <div><strong>${p.emoji} ${p.name}</strong><br><span>${money(p.price)}</span></div>
        <div class="stock-number ${cls}">${p.stock}</div>
      </div>`;
  }).join('');
}

function renderStats() {
  const waiting = state.orders.filter(o => ['preparing','ready'].includes(o.status)).length;
  els.nextNumber.textContent = orderNo(state.nextOrderNumber);
  els.soldCount.textContent = state.orders.filter(o => o.status === 'completed').length;
  els.waitingCount.textContent = waiting;
  els.mobileWaitingCount.textContent = waiting;
}

function openInventoryDialog() {
  els.inventoryFormRows.innerHTML = state.products.map(p => `
    <label class="inventory-form-row">
      <span>${p.emoji} <strong>${p.name}</strong></span>
      <input type="number" min="0" step="1" name="${p.id}" value="${p.stock}" />
    </label>`).join('');
  els.inventoryDialog.showModal();
}

function saveInventory(e) {
  e.preventDefault();
  const formData = new FormData(els.inventoryForm);
  state.products.forEach(p => {
    const value = Number(formData.get(p.id));
    p.stock = Number.isFinite(value) && value >= 0 ? Math.floor(value) : p.stock;
  });
  saveState();
  els.inventoryDialog.close();
  render();
  showToast('在庫数を更新しました');
}

function resetSales() {
  if (!confirm('本日の注文履歴・注文番号をリセットしますか？\n在庫数は初期値に戻ります。\n拠点状況と応援要請も初期化します。')) return;
  state = newBaseState();
  cart = {};
  saveState();
  render();
  switchView('sales');
  showToast('営業データをリセットしました');
}

function setDeviceLocation(locationId) {
  if (!LOCATIONS[locationId]) return;
  deviceLocation = locationId;
  localStorage.setItem(DEVICE_LOCATION_KEY, locationId);
  els.deviceLocationSelect.value = locationId;
  updateLocationLabels();
  renderStatus();
  renderHelpRequests();
}

function updateLocationLabels() {
  const loc = locationInfo(deviceLocation);
  els.deviceLocationSelect.value = deviceLocation;
  els.currentLocationChip.textContent = loc.name;
  els.helpLocationChip.textContent = `${loc.name}から送信`;
  els.helpOriginLabel.textContent = loc.name;
}

function renderStatus() {
  els.statusGrid.innerHTML = Object.entries(LOCATIONS).map(([id, loc]) => {
    const record = state.operations.locations[id] || { busy: 2, updatedAt: Date.now() };
    const busy = Math.max(1, Math.min(5, Number(record.busy) || 2));
    const isCurrent = id === deviceLocation;
    const meter = [1,2,3,4,5].map(n => `<span class="level-segment ${n <= busy ? 'on' : ''}"></span>`).join('');
    const controls = [1,2,3,4,5].map(n => `
      <button class="level-btn ${n === busy ? 'active' : ''}" data-busy-location="${id}" data-busy-level="${n}" ${isCurrent ? '' : 'disabled'}>${n}</button>`
    ).join('');

    return `
      <article class="status-card ${isCurrent ? 'current' : ''}">
        <div class="status-place">
          <div class="place-icon">${loc.icon}</div>
          <div><strong>${loc.name}</strong><span>${id === 'sales' ? '体育館横' : id === 'kitchen' ? 'ドーナツ作成' : '拠点間の移動・連絡'}</span></div>
        </div>
        <div class="busy-display">
          <div class="busy-number">${busy}<small>/5</small></div>
          <div><div class="busy-label">${BUSY_LABELS[busy]}</div><div class="busy-time">更新 ${timeAgo(record.updatedAt)}</div></div>
        </div>
        <div class="level-meter">${meter}</div>
        ${isCurrent ? `<div class="level-controls">${controls}</div>` : `<div class="remote-note">この拠点の端末から更新されます</div>`}
      </article>`;
  }).join('');

  document.querySelectorAll('[data-busy-location]').forEach(btn => {
    btn.addEventListener('click', () => {
      const locationId = btn.dataset.busyLocation;
      if (locationId !== deviceLocation) return;
      setBusyLevel(locationId, Number(btn.dataset.busyLevel));
    });
  });
}

function setBusyLevel(locationId, level) {
  state.operations.locations[locationId] = { busy: level, updatedAt: Date.now() };
  saveState();
  renderStatus();
  renderNavigationBadges();
  showToast(`${locationInfo(locationId).short}を忙しさLv.${level}に更新しました`);
}

function sendHelpRequest() {
  const memo = els.helpMemo.value.trim();
  const request = {
    id: uid(),
    origin: deviceLocation,
    people: selectedPeople,
    reason: selectedReason,
    memo,
    urgent: els.urgentHelp.checked,
    status: 'open',
    createdAt: Date.now(),
    responder: null,
    respondedAt: null
  };

  state.operations.helpRequests.unshift(request);
  saveState();
  els.helpMemo.value = '';
  els.urgentHelp.checked = false;
  renderHelpRequests();
  renderNavigationBadges();
  showToast(`${locationInfo(deviceLocation).short}から応援要請を送りました`);
}

function renderHelpRequests() {
  const active = state.operations.helpRequests.filter(r => ['open', 'responding'].includes(r.status));
  els.activeHelpCount.textContent = `${active.length}件`;

  if (!active.length) {
    els.helpRequestList.innerHTML = `<div class="help-empty">現在、応援要請はありません</div>`;
    return;
  }

  els.helpRequestList.innerHTML = active.map(r => {
    const origin = locationInfo(r.origin);
    const responder = r.responder ? locationInfo(r.responder) : null;
    const statusText = r.status === 'responding' ? '対応中' : r.urgent ? '緊急' : '未対応';
    return `
      <article class="help-request ${r.urgent ? 'urgent' : ''} ${r.status === 'responding' ? 'responding' : ''}">
        <div class="help-request-head">
          <div class="request-place"><span class="request-place-icon">${origin.icon}</span><span>${origin.name}</span></div>
          <span class="request-badge">${statusText}</span>
        </div>
        <div class="request-details">
          <span>👥 ${r.people >= 3 ? '3人以上' : `${r.people}人`}必要</span>
          <span>${r.reason}</span>
          ${r.urgent ? '<span>⚠️ 緊急</span>' : ''}
        </div>
        ${r.memo ? `<p class="request-memo">${escapeHtml(r.memo)}</p>` : ''}
        <div class="request-meta"><span>${clockTime(r.createdAt)}・${timeAgo(r.createdAt)}</span><span>${origin.short}から要請</span></div>
        ${r.status === 'responding' && responder ? `<div class="request-status-note">${responder.name}が対応中</div>` : ''}
        <div class="request-actions">
          ${r.status === 'open'
            ? `<button class="respond-btn" data-help-action="respond" data-help-id="${r.id}">この拠点から対応する</button>`
            : `<button class="resolve-btn" data-help-action="resolve" data-help-id="${r.id}">解決</button>`}
        </div>
      </article>`;
  }).join('');

  document.querySelectorAll('[data-help-id]').forEach(btn => {
    btn.addEventListener('click', () => updateHelpRequest(btn.dataset.helpId, btn.dataset.helpAction));
  });
}

function updateHelpRequest(id, action) {
  const request = state.operations.helpRequests.find(r => r.id === id);
  if (!request) return;

  if (action === 'respond') {
    request.status = 'responding';
    request.responder = deviceLocation;
    request.respondedAt = Date.now();
    showToast(`${locationInfo(deviceLocation).short}が対応します`);
  }
  if (action === 'resolve') {
    request.status = 'resolved';
    request.resolvedAt = Date.now();
    showToast('応援要請を解決済みにしました');
  }

  saveState();
  renderHelpRequests();
  renderNavigationBadges();
}

function renderNavigationBadges() {
  const activeRequests = state.operations.helpRequests.filter(r => ['open', 'responding'].includes(r.status));
  const count = activeRequests.length;
  [els.helpNavCount, els.mobileHelpNavCount].forEach(el => {
    el.textContent = count > 9 ? '9+' : String(count);
    el.hidden = count === 0;
  });

  const highBusy = Object.values(state.operations.locations).some(loc => Number(loc.busy) >= 4);
  [els.statusNavDot, els.mobileStatusNavDot].forEach(el => { el.hidden = !highBusy; });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

els.submitOrderBtn.addEventListener('click', submitOrder);
els.clearCartBtn.addEventListener('click', () => { cart = {}; renderProducts(); renderCart(); });
els.resetBtn.addEventListener('click', resetSales);
els.inventoryEditBtn.addEventListener('click', openInventoryDialog);
els.inventoryForm.addEventListener('submit', saveInventory);
els.deviceLocationSelect.addEventListener('change', e => setDeviceLocation(e.target.value));
els.sendHelpBtn.addEventListener('click', sendHelpRequest);

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderQueue();
  });
});

document.querySelectorAll('[data-view-target]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.viewTarget));
});

els.peopleChoice.querySelectorAll('[data-people]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedPeople = Number(btn.dataset.people);
    els.peopleChoice.querySelectorAll('[data-people]').forEach(b => b.classList.toggle('active', b === btn));
  });
});

els.reasonChoice.querySelectorAll('[data-reason]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedReason = btn.dataset.reason;
    els.reasonChoice.querySelectorAll('[data-reason]').forEach(b => b.classList.toggle('active', b === btn));
  });
});

els.deviceLocationSelect.value = deviceLocation;
render();
switchView(activeView);
