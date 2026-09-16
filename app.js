import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBMCNuLCRTtOoXqevH9vEoW8vkExR3FVyQ",
  authDomain: "donut-match-d07d0.firebaseapp.com",
  databaseURL: "https://donut-match-d07d0-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "donut-match-d07d0",
  storageBucket: "donut-match-d07d0.firebasestorage.app",
  messagingSenderId: "425637735845",
  appId: "1:425637735845:web:160e82e9238dde87958c4c"
};

const DEFAULT_PRODUCTS = [
  { id: "fujiyama_plain", name: "藤山プレーン", price: 350, stock: 30 },
  { id: "daiki_dip", name: "大貴 dip", price: 400, stock: 30 },
  { id: "iidas_special", name: "飯田’s スペシャル", price: 500, stock: 30 }
];

const ACTIVE_VIEW_KEY = "donut-match-firebase-active-view";
const UNDO_MS = 5000;

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
const rootRef = ref(db, "donutMatch");
const connectedRef = ref(db, ".info/connected");

let state = { products: structuredClone(DEFAULT_PRODUCTS), orders: [] };
let cart = {};
let activeView = localStorage.getItem(ACTIVE_VIEW_KEY) || "order";
let stopData = null;
let stopConnection = null;
const pendingTimers = new Map();

const els = Object.fromEntries([
  "authScreen","loginForm","loginEmail","loginPassword","loginBtn","loginError",
  "appRoot","bottomNav","logoutBtn","syncIndicator","productGrid","cartItems","cartEmpty",
  "cartTotal","submitOrderBtn","clearCartBtn","customerNameInput","toppingQueue","handoffQueue",
  "logList","toppingWaitingCount","handoffWaitingCount","completedCount","toppingPageCount",
  "handoffPageCount","toppingNavCount","handoffNavCount","inventoryList","inventoryEditBtn",
  "inventoryDialog","inventoryFormRows","inventoryForm","toast"
].map(id => [id, document.getElementById(id)]));

function makeProductMap() {
  return Object.fromEntries(DEFAULT_PRODUCTS.map(p => [p.id, { ...p }]));
}

function normalizeItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.filter(Boolean).map(i => ({ productId: i.productId, qty: Number(i.qty) || 0 })).filter(i => i.productId && i.qty > 0);
  }
  return Object.entries(items).map(([productId, qty]) => ({ productId, qty: Number(qty) || 0 })).filter(i => i.qty > 0);
}

function normalizePending(p) {
  if (!p || !["topping", "delivery"].includes(p.type)) return null;
  const until = Number(p.until);
  return Number.isFinite(until) ? { type: p.type, until } : null;
}

function normalizeState(raw) {
  const remoteProducts = raw?.products || {};
  const products = DEFAULT_PRODUCTS.map(base => ({
    ...base,
    stock: Number.isFinite(Number(remoteProducts[base.id]?.stock))
      ? Math.max(0, Math.floor(Number(remoteProducts[base.id].stock)))
      : base.stock
  }));

  const orders = Object.entries(raw?.orders || {}).map(([id, o]) => ({
    id,
    customerName: String(o.customerName || "名前未設定"),
    items: normalizeItems(o.items),
    total: Number(o.total) || 0,
    status: ["topping","handoff","completed","cancelled"].includes(o.status) ? o.status : "topping",
    createdAt: Number(o.createdAt) || Date.now(),
    toppingCompletedAt: o.toppingCompletedAt ? Number(o.toppingCompletedAt) : null,
    deliveryCompletedAt: o.deliveryCompletedAt ? Number(o.deliveryCompletedAt) : null,
    cancelledAt: o.cancelledAt ? Number(o.cancelledAt) : null,
    pendingTransition: normalizePending(o.pendingTransition)
  }));

  return { products, orders };
}

function getProduct(id) { return state.products.find(p => p.id === id); }
function getOrder(id) { return state.orders.find(o => o.id === id); }
function money(n) { return `¥${Number(n).toLocaleString("ja-JP")}`; }
function clockTime(t) { return new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); }
function dateTime(t) { return new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function escapeHtml(v) { return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }

async function ensureSeeded() {
  await runTransaction(rootRef, current => {
    const next = current || {};
    next.products = next.products || makeProductMap();
    for (const [id, p] of Object.entries(makeProductMap())) {
      if (!next.products[id]) next.products[id] = p;
    }
    return next;
  }, { applyLocally: false });
}

function startSync() {
  stopSync();
  stopData = onValue(rootRef, snap => {
    state = normalizeState(snap.val());
    render();
    finalizeExpired();
  }, err => {
    console.error(err);
    showToast("データ同期に失敗しました");
  });

  stopConnection = onValue(connectedRef, snap => {
    const online = snap.val() === true;
    els.syncIndicator.textContent = online ? "同期中" : "オフライン";
    els.syncIndicator.classList.toggle("online", online);
    els.syncIndicator.classList.toggle("offline", !online);
  });
}

function stopSync() {
  if (typeof stopData === "function") stopData();
  if (typeof stopConnection === "function") stopConnection();
  stopData = stopConnection = null;
  for (const [id, timer] of pendingTimers) { clearTimeout(timer); pendingTimers.delete(id); }
}

function switchView(view) {
  if (!["order","topping","handoff","log"].includes(view)) view = "order";
  activeView = view;
  localStorage.setItem(ACTIVE_VIEW_KEY, view);
  document.querySelectorAll(".app-view").forEach(s => {
    const active = s.dataset.view === view;
    s.hidden = !active;
    s.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-view-target]").forEach(b => {
    const active = b.dataset.viewTarget === view;
    b.classList.toggle("active", active);
    active ? b.setAttribute("aria-current","page") : b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function render() {
  renderProducts(); renderCart(); renderInventory(); renderTopping(); renderHandoff(); renderLog(); renderStats(); schedulePendingTimers();
}

function renderProducts() {
  els.productGrid.innerHTML = state.products.map(p => {
    const available = p.stock - (cart[p.id] || 0);
    return `<button class="product-card" type="button" data-product-id="${p.id}" ${available <= 0 ? "disabled" : ""}>
      <div class="product-name">${escapeHtml(p.name)}</div>
      <div class="product-bottom"><span class="product-price">${money(p.price)}</span><span class="stock-badge">残 ${Math.max(0, available)}</span></div>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-product-id]").forEach(b => b.addEventListener("click", () => addToCart(b.dataset.productId)));
}

function addToCart(id) {
  const p = getProduct(id); if (!p) return;
  const current = cart[id] || 0;
  if (current >= p.stock) return showToast(`${p.name}は在庫上限です`);
  cart[id] = current + 1; renderProducts(); renderCart();
}

function changeQty(id, delta) {
  const p = getProduct(id); if (!p) return;
  const next = (cart[id] || 0) + delta;
  if (next <= 0) delete cart[id]; else if (next <= p.stock) cart[id] = next;
  renderProducts(); renderCart();
}

function renderCart() {
  const entries = Object.entries(cart).filter(([,q]) => q > 0);
  els.cartEmpty.hidden = entries.length > 0;
  els.cartItems.innerHTML = entries.map(([id, qty]) => {
    const p = getProduct(id); if (!p) return "";
    return `<div class="cart-row"><div><strong>${escapeHtml(p.name)}</strong><div style="font-size:12px;color:#737373">${money(p.price)} × ${qty}</div></div>
      <div class="qty-control"><button class="qty-btn" type="button" data-id="${id}" data-delta="-1">−</button><strong>${qty}</strong><button class="qty-btn" type="button" data-id="${id}" data-delta="1">＋</button></div>
      <strong>${money(p.price * qty)}</strong></div>`;
  }).join("");
  document.querySelectorAll(".qty-btn").forEach(b => b.addEventListener("click", () => changeQty(b.dataset.id, Number(b.dataset.delta))));
  els.cartTotal.textContent = money(entries.reduce((sum,[id,q]) => sum + (getProduct(id)?.price || 0) * q, 0));
  updateSubmitState();
}

function updateSubmitState() {
  els.submitOrderBtn.disabled = !(Object.values(cart).some(q => q > 0) && els.customerNameInput.value.trim());
}

async function submitOrder() {
  const name = els.customerNameInput.value.trim();
  const entries = Object.entries(cart).filter(([,q]) => q > 0);
  if (!name) { els.customerNameInput.focus(); return showToast("名前を入力してください"); }
  if (!entries.length) return showToast("商品を選んでください");

  const orderId = uid();
  let abortReason = "";
  els.submitOrderBtn.disabled = true;

  try {
    const result = await runTransaction(rootRef, current => {
      if (!current?.products) { abortReason = "商品データを読み込めません"; return; }
      for (const [id, qty] of entries) {
        const p = current.products[id];
        if (!p) { abortReason = "商品データが見つかりません"; return; }
        if ((Number(p.stock) || 0) < qty) { abortReason = `${p.name}の在庫が足りません`; return; }
      }
      let total = 0; const items = {};
      for (const [id, qty] of entries) {
        const p = current.products[id]; p.stock = (Number(p.stock) || 0) - qty; total += Number(p.price) * qty; items[id] = qty;
      }
      current.orders = current.orders || {};
      current.orders[orderId] = { customerName: name, items, total, status: "topping", createdAt: Date.now() };
      return current;
    }, { applyLocally: false });

    if (!result.committed) return showToast(abortReason || "注文を登録できませんでした");
    cart = {}; els.customerNameInput.value = ""; renderCart(); renderProducts(); showToast(`${name}さんの注文を登録しました`);
  } catch (e) {
    console.error(e); showToast("注文登録に失敗しました");
  } finally { updateSubmitState(); }
}

function renderOrderItems(order) {
  return order.items.map(i => `<div class="task-item-line"><strong>${escapeHtml(getProduct(i.productId)?.name || i.productId)}</strong><span>× ${i.qty}</span></div>`).join("");
}

function renderTopping() {
  const orders = state.orders.filter(o => o.status === "topping").sort((a,b) => a.createdAt - b.createdAt);
  els.toppingQueue.innerHTML = orders.length ? orders.map(o => renderTaskCard(o,"topping")).join("") : `<div class="task-empty">トッピング待ちはありません</div>`;
  bindTaskButtons();
}

function renderHandoff() {
  const orders = state.orders.filter(o => o.status === "handoff").sort((a,b) => (a.toppingCompletedAt || a.createdAt) - (b.toppingCompletedAt || b.createdAt));
  els.handoffQueue.innerHTML = orders.length ? orders.map(o => renderTaskCard(o,"handoff")).join("") : `<div class="task-empty">商品渡し待ちはありません</div>`;
  bindTaskButtons();
}

function renderTaskCard(order, stage) {
  const type = stage === "topping" ? "topping" : "delivery";
  const pending = order.pendingTransition?.type === type;
  const seconds = pending ? Math.max(1, Math.ceil((order.pendingTransition.until - Date.now()) / 1000)) : 0;
  const label = pending ? "完了処理中" : stage === "topping" ? "トッピング待ち" : "商品渡し待ち";
  const main = stage === "topping"
    ? `<button class="task-main-btn" type="button" data-order-action="start-topping" data-order-id="${order.id}">トッピング完了</button>`
    : `<button class="task-main-btn green" type="button" data-order-action="start-delivery" data-order-id="${order.id}">商品渡し完了</button>`;
  const actions = pending
    ? `<button class="undo-btn" type="button" data-order-action="undo" data-order-id="${order.id}">完了を取り消す</button>`
    : `${main}${stage === "topping" ? `<button class="cancel-order-btn" type="button" data-order-action="cancel" data-order-id="${order.id}">×</button>` : ""}`;

  return `<article class="task-card ${pending ? "pending" : ""}"><div class="task-card-head"><div><div class="customer-name">${escapeHtml(order.customerName)}さん</div><div class="order-time">受付 ${clockTime(order.createdAt)}</div></div>
    <span class="status-chip ${stage === "handoff" ? "handoff" : ""} ${pending ? "pending" : ""}">${label}</span></div>
    <div class="task-items">${renderOrderItems(order)}</div>
    <div class="task-meta"><span>合計 ${money(order.total)}</span><span>${stage === "handoff" && order.toppingCompletedAt ? `トッピング完了 ${clockTime(order.toppingCompletedAt)}` : ""}</span></div>
    <div class="task-actions">${actions}</div>${pending ? `<div class="pending-note">あと約${seconds}秒で次へ移動</div>` : ""}</article>`;
}

function bindTaskButtons() {
  document.querySelectorAll("[data-order-action]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.orderId, action = b.dataset.orderAction;
    if (action === "start-topping") startPending(id,"topping");
    if (action === "start-delivery") startPending(id,"delivery");
    if (action === "undo") undoPending(id);
    if (action === "cancel") cancelOrder(id);
  }));
}

async function startPending(orderId, type) {
  const orderRef = ref(db, `donutMatch/orders/${orderId}`);
  const result = await runTransaction(orderRef, order => {
    if (!order || order.pendingTransition) return;
    if (type === "topping" && order.status !== "topping") return;
    if (type === "delivery" && order.status !== "handoff") return;
    order.pendingTransition = { type, until: Date.now() + UNDO_MS };
    return order;
  }, { applyLocally: false });
  if (result.committed) showToast("5秒以内なら取り消せます");
}

async function undoPending(orderId) {
  const orderRef = ref(db, `donutMatch/orders/${orderId}`);
  const result = await runTransaction(orderRef, order => {
    if (!order?.pendingTransition || Number(order.pendingTransition.until) <= Date.now()) return;
    order.pendingTransition = null; return order;
  }, { applyLocally: false });
  if (result.committed) { clearPendingTimer(orderId); showToast("完了を取り消しました"); }
  else showToast("5秒の取消時間を過ぎています");
}

async function finalizePending(orderId) {
  const orderRef = ref(db, `donutMatch/orders/${orderId}`), now = Date.now();
  try {
    await runTransaction(orderRef, order => {
      const p = order?.pendingTransition;
      if (!p || Number(p.until) > now) return;
      if (p.type === "topping" && order.status === "topping") { order.status = "handoff"; order.toppingCompletedAt = now; order.pendingTransition = null; return order; }
      if (p.type === "delivery" && order.status === "handoff") { order.status = "completed"; order.deliveryCompletedAt = now; order.pendingTransition = null; return order; }
      return;
    }, { applyLocally: false });
  } finally { clearPendingTimer(orderId); }
}

async function cancelOrder(orderId) {
  const local = getOrder(orderId); if (!local) return;
  if (!confirm(`${local.customerName}さんの注文を取り消しますか？\n在庫は戻ります。`)) return;
  let reason = "";
  const result = await runTransaction(rootRef, current => {
    const order = current?.orders?.[orderId];
    if (!order) { reason = "注文が見つかりません"; return; }
    if (order.status !== "topping" || order.pendingTransition) { reason = "この注文は取り消せません"; return; }
    for (const item of normalizeItems(order.items)) {
      if (current.products?.[item.productId]) current.products[item.productId].stock = (Number(current.products[item.productId].stock) || 0) + item.qty;
    }
    order.status = "cancelled"; order.cancelledAt = Date.now(); return current;
  }, { applyLocally: false });
  showToast(result.committed ? "注文を取り消しました" : (reason || "注文を取り消せませんでした"));
}

function schedulePendingTimers() {
  const active = new Set();
  for (const order of state.orders) {
    if (!order.pendingTransition) continue;
    active.add(order.id);
    if (pendingTimers.has(order.id)) continue;
    const timer = setTimeout(() => { pendingTimers.delete(order.id); finalizePending(order.id); }, Math.max(0, order.pendingTransition.until - Date.now()));
    pendingTimers.set(order.id, timer);
  }
  for (const [id,timer] of pendingTimers) if (!active.has(id)) { clearTimeout(timer); pendingTimers.delete(id); }
}

function clearPendingTimer(id) { const t = pendingTimers.get(id); if (t) clearTimeout(t); pendingTimers.delete(id); }
function finalizeExpired() { for (const o of state.orders) if (o.pendingTransition && o.pendingTransition.until <= Date.now()) finalizePending(o.id); }

function renderLog() {
  const finished = state.orders.filter(o => ["completed","cancelled"].includes(o.status)).sort((a,b) => (b.deliveryCompletedAt || b.cancelledAt || b.createdAt) - (a.deliveryCompletedAt || a.cancelledAt || a.createdAt));
  if (!finished.length) { els.logList.innerHTML = `<div class="task-empty">Logはありません</div>`; return; }
  els.logList.innerHTML = finished.map(o => {
    const cancelled = o.status === "cancelled", when = cancelled ? o.cancelledAt : o.deliveryCompletedAt;
    return `<article class="log-card"><div class="log-card-head"><div><div class="log-name">${escapeHtml(o.customerName)}さん</div><div class="order-time">受付 ${dateTime(o.createdAt)}</div></div><span class="log-status ${cancelled ? "cancelled" : ""}">${cancelled ? "注文取消" : "商品渡し完了"}</span></div>
      <div class="log-items">${o.items.map(i => `${escapeHtml(getProduct(i.productId)?.name || i.productId)} × ${i.qty}`).join(" / ")}</div><div class="log-meta">${cancelled ? "取消" : "完了"} ${when ? dateTime(when) : "-"} ・ 合計 ${money(o.total)}</div></article>`;
  }).join("");
}

function renderInventory() {
  els.inventoryList.innerHTML = state.products.map(p => `<div class="inventory-row"><div><strong>${escapeHtml(p.name)}</strong><br><span>${money(p.price)}</span></div><div class="stock-number ${p.stock === 0 ? "out" : p.stock <= 5 ? "low" : ""}">${p.stock}</div></div>`).join("");
}

function openInventory() {
  els.inventoryFormRows.innerHTML = state.products.map(p => `<label class="inventory-form-row"><span><strong>${escapeHtml(p.name)}</strong></span><input type="number" min="0" step="1" name="${p.id}" value="${p.stock}" /></label>`).join("");
  els.inventoryDialog.showModal();
}

async function saveInventory(e) {
  e.preventDefault(); const fd = new FormData(els.inventoryForm), updates = {};
  for (const p of state.products) { const v = Number(fd.get(p.id)); if (Number.isFinite(v) && v >= 0) updates[p.id] = Math.floor(v); }
  const result = await runTransaction(rootRef, current => {
    if (!current?.products) return;
    for (const [id,stock] of Object.entries(updates)) if (current.products[id]) current.products[id].stock = stock;
    return current;
  }, { applyLocally: false });
  if (result.committed) { els.inventoryDialog.close(); showToast("在庫数を更新しました"); } else showToast("在庫を更新できませんでした");
}

function renderStats() {
  const topping = state.orders.filter(o => o.status === "topping").length;
  const handoff = state.orders.filter(o => o.status === "handoff").length;
  const completed = state.orders.filter(o => o.status === "completed").length;
  els.toppingWaitingCount.textContent = topping; els.handoffWaitingCount.textContent = handoff; els.completedCount.textContent = completed;
  els.toppingPageCount.textContent = topping; els.handoffPageCount.textContent = handoff;
  els.toppingNavCount.textContent = topping > 9 ? "9+" : topping; els.handoffNavCount.textContent = handoff > 9 ? "9+" : handoff;
  els.toppingNavCount.hidden = topping === 0; els.handoffNavCount.hidden = handoff === 0;
}

function showApp() { els.authScreen.hidden = true; els.appRoot.hidden = false; els.bottomNav.hidden = false; switchView(activeView); }
function showLogin() { els.authScreen.hidden = false; els.appRoot.hidden = true; els.bottomNav.hidden = true; }
function authMessage(e) { if (e?.code === "auth/invalid-credential") return "メールアドレスまたはパスワードが違います"; if (e?.code === "auth/invalid-email") return "メールアドレスを確認してください"; return "ログインできませんでした"; }

let toastTimer;
function showToast(message) { clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.add("show"); toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800); }

els.loginForm.addEventListener("submit", async e => {
  e.preventDefault(); els.loginError.hidden = true; els.loginBtn.disabled = true; els.loginBtn.textContent = "ログイン中";
  try { await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value); }
  catch (err) { console.error(err); els.loginError.textContent = authMessage(err); els.loginError.hidden = false; }
  finally { els.loginBtn.disabled = false; els.loginBtn.textContent = "ログイン"; }
});

els.logoutBtn.addEventListener("click", () => signOut(auth));
els.submitOrderBtn.addEventListener("click", submitOrder);
els.clearCartBtn.addEventListener("click", () => { cart = {}; renderProducts(); renderCart(); });
els.customerNameInput.addEventListener("input", updateSubmitState);
els.customerNameInput.addEventListener("keydown", e => { if (e.key === "Enter" && !els.submitOrderBtn.disabled) { e.preventDefault(); submitOrder(); } });
els.inventoryEditBtn.addEventListener("click", openInventory);
els.inventoryForm.addEventListener("submit", saveInventory);
document.querySelectorAll("[data-view-target]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.viewTarget)));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") finalizeExpired(); });
setInterval(() => { if (state.orders.some(o => o.pendingTransition)) { renderTopping(); renderHandoff(); finalizeExpired(); } }, 1000);

onAuthStateChanged(auth, async user => {
  if (!user) { stopSync(); showLogin(); return; }
  try { await ensureSeeded(); startSync(); showApp(); }
  catch (err) { console.error(err); showLogin(); els.loginError.textContent = "Firebaseへの接続に失敗しました"; els.loginError.hidden = false; }
});
