/* ================================================================
   Cart Logic — localStorage-backed cart state
   ================================================================ */

const CART_KEY = 'srm_gf_cart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartUI();
}

function getCartItemQty(itemId) {
  const cart = getCart();
  const entry = cart.find(c => c.food_item_id === itemId);
  return entry ? entry.quantity : 0;
}

function addToCart(itemId) {
  const item = menuItems.find(i => i.id === itemId);
  if (!item) return;

  const cart = getCart();
  const existing = cart.find(c => c.food_item_id === itemId);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({
      food_item_id: itemId,
      name: item.name,
      price: item.price,
      quantity: 1,
      image_url: item.image_url || '',
    });
  }
  saveCart(cart);
  renderFoodGrid(); // Re-render to show qty controls
}

function updateCartQty(itemId, newQty) {
  let cart = getCart();
  if (newQty <= 0) {
    cart = cart.filter(c => c.food_item_id !== itemId);
  } else {
    const entry = cart.find(c => c.food_item_id === itemId);
    if (entry) entry.quantity = newQty;
  }
  saveCart(cart);
  renderFoodGrid();
}

function removeFromCart(itemId) {
  updateCartQty(itemId, 0);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartUI();
  renderFoodGrid();
}

function getCartTotal() {
  return getCart().reduce((sum, c) => sum + c.price * c.quantity, 0);
}

function getCartCount() {
  return getCart().reduce((sum, c) => sum + c.quantity, 0);
}

// ---- Cart UI Updates ----
function updateCartUI() {
  const cart = getCart();
  const count = getCartCount();
  const total = getCartTotal();

  // Header cart button
  const cartBtn = document.getElementById('cart-btn');
  if (cartBtn) cartBtn.style.display = count > 0 ? 'flex' : 'none';
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = count;

  // Floating cart
  const floatingCart = document.getElementById('floating-cart');
  if (floatingCart) floatingCart.style.display = count > 0 ? 'flex' : 'none';
  const floatingText = document.getElementById('floating-cart-text');
  if (floatingText) floatingText.textContent = count + ' item' + (count !== 1 ? 's' : '') + ' in cart';
  const floatingTotal = document.getElementById('floating-cart-total');
  if (floatingTotal) floatingTotal.textContent = '₹' + total;

  // Cart drawer totals
  const subtotal = document.getElementById('cart-subtotal');
  if (subtotal) subtotal.textContent = '₹' + total;
  const cartTotal = document.getElementById('cart-total');
  if (cartTotal) cartTotal.textContent = '₹' + total;

  // Cart items list
  renderCartItems();
}

function renderCartItems() {
  const container = document.getElementById('cart-items-list');
  if (!container) return;
  const cart = getCart();

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <i data-lucide="shopping-bag" style="width:3rem;height:3rem;color:var(--stone-300);margin:0 auto 0.75rem;display:block;"></i>
        <h3 style="font-weight:700;color:var(--stone-800);font-size:1rem;">Your cart is empty</h3>
        <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.25rem;">Browse our menu and add some delicious items</p>
        <button class="btn btn-primary" style="margin-top:1rem;" onclick="closeCartDrawer(); switchView('store');">
          <i data-lucide="utensils-crossed" style="width:0.875rem;height:0.875rem;"></i>
          <span>Browse Menu</span>
        </button>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = '';
  cart.forEach(item => {
    html += `
    <div class="flex items-center gap-3" style="padding:0.75rem;background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);margin-bottom:0.5rem;">
      <div style="width:3rem;height:3rem;border-radius:var(--radius-xl);overflow:hidden;flex-shrink:0;background:var(--red-50);">
        ${item.image_url
          ? `<img src="${item.image_url}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--color-primary);font-weight:800;font-size:0.625rem;">SRM</div>`
        }
      </div>
      <div style="flex:1;min-width:0;">
        <h4 style="font-weight:700;font-size:0.75rem;color:var(--stone-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</h4>
        <span style="font-size:0.75rem;font-weight:700;color:var(--color-primary);">₹${item.price * item.quantity}</span>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="updateCartQty(${item.food_item_id}, ${item.quantity - 1})" style="width:1.5rem;height:1.5rem;border-radius:var(--radius-lg);background:var(--stone-100);display:flex;align-items:center;justify-content:center;color:var(--stone-600);">
          <i data-lucide="${item.quantity === 1 ? 'trash-2' : 'minus'}" style="width:0.75rem;height:0.75rem;"></i>
        </button>
        <span style="width:1.25rem;text-align:center;font-weight:700;font-size:0.75rem;">${item.quantity}</span>
        <button onclick="updateCartQty(${item.food_item_id}, ${item.quantity + 1})" style="width:1.5rem;height:1.5rem;border-radius:var(--radius-lg);background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;">
          <i data-lucide="plus" style="width:0.75rem;height:0.75rem;"></i>
        </button>
      </div>
    </div>`;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// ---- Cart Drawer Open/Close ----
function openCartDrawer() {
  updateCartUI();
  document.getElementById('cart-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCartDrawer(e) {
  if (e && e.target !== document.getElementById('cart-overlay')) return;
  document.getElementById('cart-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// Initialize cart UI on load
document.addEventListener('DOMContentLoaded', function() {
  updateCartUI();
});
