const DEFAULT_PRODUCTS = [
  { id: 'fujiyama_plain', name: '藤山プレーン', price: 350, stock: 30 },
  { id: 'daiki_dip', name: '大貴 dip', price: 400, stock: 30 },
  { id: 'iidas_special', name: '飯田’s スペシャル', price: 500, stock: 30 }
];

const STORAGE_KEY = 'donut-match-v5';
const LEGACY_STORAGE_KEY = 'donut-match-v4';
const ACTIVE_VIEW_KEY = 'donut-match-v5-active-view';
const UNDO_MS = 5000;

let state = loadState();
let cart = {};
let activeView = localStorage.getItem(ACTIVE_VIEW_KEY) || 'order';
const pendingTimers = new Map();

const els = {
  productGrid: document.getElementById('productGrid'),
  cartItems: document.getElementById('cartItems'),
  cartEmpty: document.getElementById('cartEmpty'),
  cartTotal: document.getElementById('cartTotal'),
  submitOrderBtn: document.getElementById('submitOrderBtn'),
  clearCartBtn: document.getElementById('clearCartBtn'),
  customerNameInput: document.getElementById('customerNameInput'),

  toppingQueue: document.getElementById('toppingQueue'),
  handoffQueue: document.getElementById('handoffQueue'),
  logList: document.getElementById('logList'),

  toppingWaitingCount: document.getElementById('toppingWaitingCount'),
  handoffWaitingCount: document.getElementById('handoffWaitingCount'),
  completedCount: document.getElementById('completedCount'),
  toppingPageCount: document.getElementById('toppingPageCount'),
  handoffPageCount: document.getElementById('handoffPageCount'),
  toppingNavCount: document.getElementById('toppingNavCount'),
  handoffNavCount: document.getElementById('handoffNavCount'),

  inventoryList: document.getElementById('inventoryList'),
  inventoryEditBtn: document.getElementById('inventoryEditBtn'),
  inventoryDialog: document.getElementById('inventoryDialog'),
  inventoryFormRows: document.getElementById('inventoryFormRows'),
  inventoryForm: document.getElementById('inventoryForm'),

  toast: document.getElementById('toast')
};

function newBaseState() {
  return {
    products: structuredClone(DEFAULT_PRODUCTS),
    orders: []
  };
}

function normalizePendingTransition(pending) {
  if (!pending || !['topping', 'delivery'].includes(pending.type)) return null;
  const until = Number(pending.until);
  if (!Number.isFinite(until)) return null;
  return { type: pending.type, until };
}

function normalizeOrder(order) {
  if (!order || !order.id) return null;

  let status = order.status;
  if (status === 'preparing') status = 'topping';
  if (status === 'ready') status = 'handoff';

  return {
    id: order.id,
    customerName: order.customerName || '名前未設定',
    items: Array.isArray(order.items) ? order.items : [],
    total: Number(order.total) || 0,
    status: ['topping', 'handoff', 'completed', 'cancelled'].includes(status) ? status : 'topping',
    createdAt: Number(order.createdAt) || Date.now(),
    toppingCompletedAt: order.toppingCompletedAt ? Number(order.toppingCompletedAt) : null,
    deliveryCompletedAt: order.deliveryCompletedAt ? Number(order.deliveryCompletedAt) : null,
    cancelledAt: order.cancelledAt ? Number(order.cancelledAt) : null,
    pendingTransition: normalizePendingTransition(order.pendingTransition)
  };
}

function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.orders)) return newBaseState();

  const migratedOrders = raw.orders.map(normalizeOrder).filter(Boolean);

  return {
    products: structuredClone(DEFAULT_PRODUCTS),
    orders: migratedOrders.filter(order =>
      order.items.every(item => DEFAULT_PRODUCTS.some(p => p.id === item.productId))
    )
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

const channel = 'BroadcastChannel' in window
  ? new BroadcastChannel('donut-match-ops-v5')
  : null;

if (channel) {
  channel.addEventListener('message', event => {
    if (event.data?.type !== 'state-updated') return;

    try {
      const fresh = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (fresh) {
        state = normalizeState(fresh);
        reconcilePendingTransitions();
        render();
      }
    } catch (_) {}
  });
}

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;

  try {
    state = normalizeState(JSON.parse(event.newValue));
    reconcilePendingTransitions();
    render();
  } catch (_) {}
});

function money(n) {
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function clockTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function dateTime(timestamp) {
  return new Date(timestamp).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function getProduct(id) {
  return state.products.find(p => p.id === id);
}

function getOrder(id) {
  return state.orders.find(o => o.id === id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function switchView(view) {
  if (!['order', 'topping', 'handoff', 'log'].includes(view)) view = 'order';

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

function render() {
  renderProducts();
  renderCart();
  renderInventory();
  renderToppingQueue();
  renderHandoffQueue();
  renderLog();
  renderStats();
  schedulePendingTimers();
}

function renderProducts() {
  els.productGrid.innerHTML = state.products.map(p => {
    const inCart = cart[p.id] || 0;
    const available = p.stock - inCart;

    return `
      <button class="product-card" type="button" data-product-id="${p.id}" ${available <= 0 ? 'disabled' : ''}>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-bottom">
          <span class="product-price">${money(p.price)}</span>
          <span class="stock-badge">残 ${Math.max(0, available)}</span>
        </div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('[data-product-id]').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.productId));
  });
}

function addToCart(id) {
  const p = getProduct(id);
  if (!p) return;

  const current = cart[id] || 0;

  if (current >= p.stock) {
    showToast(`${p.name}は在庫上限です`);
    return;
  }

  cart[id] = current + 1;
  renderProducts();
  renderCart();
}

function changeQty(id, delta) {
  const p = getProduct(id);
  if (!p) return;

  const next = (cart[id] || 0) + delta;

  if (next <= 0) {
    delete cart[id];
  } else if (next <= p.stock) {
    cart[id] = next;
  }

  renderProducts();
  renderCart();
}

function renderCart() {
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);

  els.cartEmpty.hidden = entries.length > 0;

  els.cartItems.innerHTML = entries.map(([id, qty]) => {
    const p = getProduct(id);
    if (!p) return '';

    return `
      <div class="cart-row">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <div style="font-size:12px;color:#737373">${money(p.price)} × ${qty}</div>
        </div>

        <div class="qty-control">
          <button class="qty-btn" type="button" data-id="${id}" data-delta="-1">−</button>
          <strong>${qty}</strong>
          <button class="qty-btn" type="button" data-id="${id}" data-delta="1">＋</button>
        </div>

        <strong>${money(p.price * qty)}</strong>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      changeQty(btn.dataset.id, Number(btn.dataset.delta));
    });
  });

  const total = entries.reduce((sum, [id, qty]) => {
    const p = getProduct(id);
    return sum + (p ? p.price * qty : 0);
  }, 0);

  els.cartTotal.textContent = money(total);
  updateSubmitState();
}

function updateSubmitState() {
  const hasItems = Object.values(cart).some(qty => qty > 0);
  const hasName = els.customerNameInput.value.trim().length > 0;

  els.submitOrderBtn.disabled = !(hasItems && hasName);
}

function submitOrder() {
  const customerName = els.customerNameInput.value.trim();
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);

  if (!customerName) {
    showToast('名前を入力してください');
    els.customerNameInput.focus();
    return;
  }

  if (!entries.length) {
    showToast('商品を選んでください');
    return;
  }

  for (const [id, qty] of entries) {
    const p = getProduct(id);

    if (!p || p.stock < qty) {
      showToast(`${p?.name ?? '商品'}の在庫が足りません`);
      return;
    }
  }

  const total = entries.reduce((sum, [id, qty]) => {
    const p = getProduct(id);
    return sum + p.price * qty;
  }, 0);

  const order = {
    id: uid(),
    customerName,
    items: entries.map(([id, qty]) => ({ productId: id, qty })),
    total,
    status: 'topping',
    createdAt: Date.now(),
    toppingCompletedAt: null,
    deliveryCompletedAt: null,
    cancelledAt: null,
    pendingTransition: null
  };

  entries.forEach(([id, qty]) => {
    getProduct(id).stock -= qty;
  });

  state.orders.push(order);

  cart = {};
  els.customerNameInput.value = '';

  saveState();
  render();
  showToast(`${customerName}さんの注文を登録しました`);
}

function renderOrderItems(order) {
  return order.items.map(item => {
    const p = getProduct(item.productId);
    const name = p?.name ?? item.productId;

    return `
      <div class="task-item-line">
        <strong>${escapeHtml(name)}</strong>
        <span>× ${item.qty}</span>
      </div>
    `;
  }).join('');
}

function renderToppingQueue() {
  const orders = state.orders
    .filter(o => o.status === 'topping')
    .sort((a, b) => a.createdAt - b.createdAt);

  els.toppingQueue.innerHTML = orders.length
    ? orders.map(order => renderTaskCard(order, 'topping')).join('')
    : `<div class="task-empty">トッピング待ちはありません</div>`;

  bindTaskButtons();
}

function renderHandoffQueue() {
  const orders = state.orders
    .filter(o => o.status === 'handoff')
    .sort((a, b) =>
      (a.toppingCompletedAt || a.createdAt) -
      (b.toppingCompletedAt || b.createdAt)
    );

  els.handoffQueue.innerHTML = orders.length
    ? orders.map(order => renderTaskCard(order, 'handoff')).join('')
    : `<div class="task-empty">商品渡し待ちはありません</div>`;

  bindTaskButtons();
}

function renderTaskCard(order, stage) {
  const pendingType = stage === 'topping' ? 'topping' : 'delivery';
  const isPending = order.pendingTransition?.type === pendingType;

  const secondsLeft = isPending
    ? Math.max(1, Math.ceil((order.pendingTransition.until - Date.now()) / 1000))
    : 0;

  const statusLabel = isPending
    ? '完了処理中'
    : stage === 'topping'
      ? 'トッピング待ち'
      : '商品渡し待ち';

  const mainButton = stage === 'topping'
    ? `<button class="task-main-btn" type="button" data-order-action="start-topping-complete" data-order-id="${order.id}">トッピング完了</button>`
    : `<button class="task-main-btn green" type="button" data-order-action="start-delivery-complete" data-order-id="${order.id}">商品渡し完了</button>`;

  const actions = isPending
    ? `
      <button class="undo-btn" type="button" data-order-action="undo" data-order-id="${order.id}">
        完了を取り消す
      </button>
    `
    : `
      ${mainButton}
      ${stage === 'topping'
        ? `<button class="cancel-order-btn" type="button" title="注文取消" data-order-action="cancel" data-order-id="${order.id}">×</button>`
        : ''
      }
    `;

  return `
    <article class="task-card ${isPending ? 'pending' : ''}">
      <div class="task-card-head">
        <div>
          <div class="customer-name">${escapeHtml(order.customerName)}さん</div>
          <div class="order-time">受付 ${clockTime(order.createdAt)}</div>
        </div>

        <span class="status-chip ${stage === 'handoff' ? 'handoff' : ''} ${isPending ? 'pending' : ''}">
          ${statusLabel}
        </span>
      </div>

      <div class="task-items">
        ${renderOrderItems(order)}
      </div>

      <div class="task-meta">
        <span>合計 ${money(order.total)}</span>
        <span>${stage === 'handoff' && order.toppingCompletedAt ? `トッピング完了 ${clockTime(order.toppingCompletedAt)}` : ''}</span>
      </div>

      <div class="task-actions">
        ${actions}
      </div>

      ${isPending ? `<div class="pending-note">あと約${secondsLeft}秒で次へ移動</div>` : ''}
    </article>
  `;
}

function bindTaskButtons() {
  document.querySelectorAll('[data-order-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.orderId;
      const action = btn.dataset.orderAction;

      if (action === 'start-topping-complete') startPendingTransition(id, 'topping');
      if (action === 'start-delivery-complete') startPendingTransition(id, 'delivery');
      if (action === 'undo') undoPendingTransition(id);
      if (action === 'cancel') cancelOrder(id);
    });
  });
}

function startPendingTransition(orderId, type) {
  const order = getOrder(orderId);
  if (!order || order.pendingTransition) return;

  if (type === 'topping' && order.status !== 'topping') return;
  if (type === 'delivery' && order.status !== 'handoff') return;

  order.pendingTransition = {
    type,
    until: Date.now() + UNDO_MS
  };

  saveState();
  render();

  showToast('5秒以内なら取り消せます');
}

function undoPendingTransition(orderId) {
  const order = getOrder(orderId);
  if (!order?.pendingTransition) return;

  order.pendingTransition = null;
  clearPendingTimer(orderId);

  saveState();
  render();
  showToast('完了を取り消しました');
}

function finalizePendingTransition(orderId) {
  const order = getOrder(orderId);
  if (!order?.pendingTransition) return;

  const type = order.pendingTransition.type;

  if (type === 'topping' && order.status === 'topping') {
    order.status = 'handoff';
    order.toppingCompletedAt = Date.now();
  }

  if (type === 'delivery' && order.status === 'handoff') {
    order.status = 'completed';
    order.deliveryCompletedAt = Date.now();
  }

  order.pendingTransition = null;
  clearPendingTimer(orderId);

  saveState();
  render();
}

function cancelOrder(orderId) {
  const order = getOrder(orderId);
  if (!order || order.status !== 'topping' || order.pendingTransition) return;

  const ok = confirm(`${order.customerName}さんの注文を取り消しますか？\n在庫は戻ります。`);
  if (!ok) return;

  order.items.forEach(item => {
    const p = getProduct(item.productId);
    if (p) p.stock += item.qty;
  });

  order.status = 'cancelled';
  order.cancelledAt = Date.now();

  saveState();
  render();
  showToast('注文を取り消しました');
}

function reconcilePendingTransitions() {
  const now = Date.now();
  let changed = false;

  state.orders.forEach(order => {
    const pending = order.pendingTransition;
    if (!pending) return;

    if (pending.until <= now) {
      if (pending.type === 'topping' && order.status === 'topping') {
        order.status = 'handoff';
        order.toppingCompletedAt = now;
      }

      if (pending.type === 'delivery' && order.status === 'handoff') {
        order.status = 'completed';
        order.deliveryCompletedAt = now;
      }

      order.pendingTransition = null;
      changed = true;
    }
  });

  if (changed) saveState();
}

function schedulePendingTimers() {
  const activeIds = new Set();

  state.orders.forEach(order => {
    const pending = order.pendingTransition;
    if (!pending) return;

    activeIds.add(order.id);

    if (pendingTimers.has(order.id)) return;

    const delay = Math.max(0, pending.until - Date.now());

    const timer = setTimeout(() => {
      pendingTimers.delete(order.id);
      finalizePendingTransition(order.id);
    }, delay);

    pendingTimers.set(order.id, timer);
  });

  for (const [orderId, timer] of pendingTimers.entries()) {
    if (!activeIds.has(orderId)) {
      clearTimeout(timer);
      pendingTimers.delete(orderId);
    }
  }
}

function clearPendingTimer(orderId) {
  const timer = pendingTimers.get(orderId);

  if (timer) {
    clearTimeout(timer);
  }

  pendingTimers.delete(orderId);
}

function renderLog() {
  const finished = state.orders
    .filter(o => o.status === 'completed' || o.status === 'cancelled')
    .sort((a, b) => {
      const aTime = a.deliveryCompletedAt || a.cancelledAt || a.createdAt;
      const bTime = b.deliveryCompletedAt || b.cancelledAt || b.createdAt;
      return bTime - aTime;
    });

  if (!finished.length) {
    els.logList.innerHTML = `<div class="task-empty">Logはありません</div>`;
    return;
  }

  els.logList.innerHTML = finished.map(order => {
    const cancelled = order.status === 'cancelled';
    const finishedAt = cancelled ? order.cancelledAt : order.deliveryCompletedAt;

    return `
      <article class="log-card">
        <div class="log-card-head">
          <div>
            <div class="log-name">${escapeHtml(order.customerName)}さん</div>
            <div class="order-time">受付 ${dateTime(order.createdAt)}</div>
          </div>

          <span class="log-status ${cancelled ? 'cancelled' : ''}">
            ${cancelled ? '注文取消' : '商品渡し完了'}
          </span>
        </div>

        <div class="log-items">
          ${order.items.map(item => {
            const p = getProduct(item.productId);
            return `${escapeHtml(p?.name ?? item.productId)} × ${item.qty}`;
          }).join(' / ')}
        </div>

        <div class="log-meta">
          ${cancelled ? '取消' : '完了'} ${finishedAt ? dateTime(finishedAt) : '-'} ・ 合計 ${money(order.total)}
        </div>
      </article>
    `;
  }).join('');
}

function renderInventory() {
  els.inventoryList.innerHTML = state.products.map(p => {
    const cls = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';

    return `
      <div class="inventory-row">
        <div>
          <strong>${escapeHtml(p.name)}</strong><br>
          <span>${money(p.price)}</span>
        </div>
        <div class="stock-number ${cls}">${p.stock}</div>
      </div>
    `;
  }).join('');
}

function openInventoryDialog() {
  els.inventoryFormRows.innerHTML = state.products.map(p => `
    <label class="inventory-form-row">
      <span><strong>${escapeHtml(p.name)}</strong></span>
      <input type="number" min="0" step="1" name="${p.id}" value="${p.stock}" />
    </label>
  `).join('');

  els.inventoryDialog.showModal();
}

function saveInventory(event) {
  event.preventDefault();

  const formData = new FormData(els.inventoryForm);

  state.products.forEach(p => {
    const value = Number(formData.get(p.id));

    if (Number.isFinite(value) && value >= 0) {
      p.stock = Math.floor(value);
    }
  });

  saveState();
  els.inventoryDialog.close();
  render();
  showToast('在庫数を更新しました');
}

function renderStats() {
  const toppingCount = state.orders.filter(o => o.status === 'topping').length;
  const handoffCount = state.orders.filter(o => o.status === 'handoff').length;
  const completedCount = state.orders.filter(o => o.status === 'completed').length;

  els.toppingWaitingCount.textContent = toppingCount;
  els.handoffWaitingCount.textContent = handoffCount;
  els.completedCount.textContent = completedCount;

  els.toppingPageCount.textContent = toppingCount;
  els.handoffPageCount.textContent = handoffCount;

  els.toppingNavCount.textContent = toppingCount > 9 ? '9+' : String(toppingCount);
  els.handoffNavCount.textContent = handoffCount > 9 ? '9+' : String(handoffCount);

  els.toppingNavCount.hidden = toppingCount === 0;
  els.handoffNavCount.hidden = handoffCount === 0;
}

let toastTimer;

function showToast(message) {
  clearTimeout(toastTimer);

  els.toast.textContent = message;
  els.toast.classList.add('show');

  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 1800);
}

els.submitOrderBtn.addEventListener('click', submitOrder);

els.clearCartBtn.addEventListener('click', () => {
  cart = {};
  renderProducts();
  renderCart();
});

els.customerNameInput.addEventListener('input', updateSubmitState);

els.customerNameInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !els.submitOrderBtn.disabled) {
    event.preventDefault();
    submitOrder();
  }
});

els.inventoryEditBtn.addEventListener('click', openInventoryDialog);
els.inventoryForm.addEventListener('submit', saveInventory);

document.querySelectorAll('[data-view-target]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.viewTarget));
});

reconcilePendingTransitions();
render();
switchView(activeView);

setInterval(() => {
  const hasPending = state.orders.some(o => o.pendingTransition);

  if (hasPending) {
    renderToppingQueue();
    renderHandoffQueue();
  }
}, 1000);
