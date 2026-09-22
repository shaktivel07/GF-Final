/* ================================================================
   Order Tracking — polling, status stepper, order history
   ================================================================ */

let trackingOrders = [];
let currentTrackedOrder = null;
let trackingInterval = null;

function renderTrackingSignedOut() {
  document.getElementById('tracking-content').innerHTML = `
    <div style="text-align:center;padding:4rem 0;">
      <div style="background:#fff;border-radius:var(--radius-3xl);padding:2rem;border:1px solid var(--stone-200);box-shadow:var(--shadow-md);max-width:28rem;margin:0 auto;">
        <i data-lucide="receipt" style="width:3rem;height:3rem;color:var(--color-primary);margin:0 auto 0.75rem;display:block;"></i>
        <h3 style="font-weight:700;font-size:1.125rem;color:var(--stone-900);font-family:var(--font-serif);">Sign In to Track Orders</h3>
        <p style="font-size:0.75rem;color:var(--stone-500);margin:0.25rem auto 1.25rem;max-width:20rem;">
          Log in with your Firebase account to monitor kitchen preparation, track your delivery rider, and view your OTP.
        </p>
        <button class="btn btn-primary btn-block" onclick="openAuthModal()">Sign In with Firebase</button>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

async function loadTrackingOrders(silent) {
  if (!currentUser) {
    renderTrackingSignedOut();
    return;
  }

  try {
    const data = await apiFetch('/api/orders/my-orders?firebase_uid=' + currentUser.firebase_uid);
    trackingOrders = data || [];

    if (currentTrackedOrder) {
      const updated = trackingOrders.find(o => o.id === currentTrackedOrder.id);
      if (updated) currentTrackedOrder = updated;
    } else if (trackingOrders.length > 0) {
      currentTrackedOrder = trackingOrders[0];
    }

    renderTracking();
  } catch (err) {
    console.error('Error loading orders:', err);
  }

  // Start polling
  if (!trackingInterval) {
    trackingInterval = setInterval(() => loadTrackingOrders(true), 8000);
  }
}

function getStatusStep(status) {
  switch (status) {
    case 'CONFIRMED': return 1;
    case 'PREPARING': return 2;
    case 'DISPATCHED': return 3;
    case 'DELIVERED': return 4;
    case 'UNPICKED': return 3;
    case 'CLOSED': return -1;
    case 'CANCELLED': return -1;
    default: return 1;
  }
}

function renderTracking() {
  const container = document.getElementById('tracking-content');

  if (trackingOrders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:4rem 0;">
        <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);padding:2rem;box-shadow:var(--shadow-sm);">
          <i data-lucide="utensils" style="width:3rem;height:3rem;color:var(--stone-300);margin:0 auto 0.75rem;display:block;"></i>
          <h3 style="font-weight:700;color:var(--stone-800);font-size:1rem;">No orders placed yet</h3>
          <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.25rem;max-width:24rem;margin-left:auto;margin-right:auto;">
            Browse through our menu, select your dishes, and place your order using Razorpay to view real-time tracking here.
          </p>
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const step = currentTrackedOrder ? getStatusStep(currentTrackedOrder.status) : 0;

  let html = `
  <div class="flex items-center justify-between" style="margin-bottom:1.5rem;">
    <div>
      <h2 style="font-size:1.25rem;font-weight:800;color:var(--stone-900);font-family:var(--font-serif);">Live Order Tracking</h2>
      <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.125rem;">Real-time status synced with SRM Kitchen & Riders</p>
    </div>
    <button class="btn btn-outline btn-sm" onclick="loadTrackingOrders()">
      <i data-lucide="refresh-cw" style="width:0.875rem;height:0.875rem;color:var(--color-primary);"></i>
      <span>Refresh</span>
    </button>
  </div>

  <div style="display:grid;grid-template-columns:1fr;gap:1.5rem;">`;

  if (window.innerWidth >= 1024) {
    html = html.replace('grid-template-columns:1fr', 'grid-template-columns:2fr 1fr');
  }

  // Main order spotlight
  if (currentTrackedOrder) {
    const ord = currentTrackedOrder;
    html += `
    <div>
      <div style="background:#fff;border-radius:var(--radius-3xl);border:1px solid rgba(231,229,228,0.9);box-shadow:var(--shadow-md);padding:1.5rem;overflow:hidden;">
        <!-- Header -->
        <div class="flex items-center justify-between" style="padding-bottom:1rem;border-bottom:1px solid var(--stone-100);">
          <div>
            <span style="font-size:11px;font-weight:700;color:var(--stone-400);text-transform:uppercase;letter-spacing:0.05em;">Order ID</span>
            <h3 style="font-size:1.25rem;font-weight:800;color:var(--color-primary);font-family:var(--font-mono);">#${ord.order_number}</h3>
          </div>
          <div style="text-align:right;">
            <span style="font-size:11px;font-weight:700;color:var(--stone-400);text-transform:uppercase;letter-spacing:0.05em;">Payment</span>
            <span class="badge badge-emerald" style="display:block;margin-top:0.125rem;padding:0.125rem 0.625rem;">Razorpay Verified (₹${ord.total_amount})</span>
          </div>
        </div>`;

    // Unpicked Notice
    if (ord.status === 'UNPICKED') {
      html += `
        <div class="alert alert-error" style="margin:1.25rem 0;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:1rem;border-radius:var(--radius-2xl);">
          <div class="flex items-center gap-2" style="font-weight:700;font-size:0.875rem;">
            <i data-lucide="alert-triangle" style="width:1.25rem;height:1.25rem;color:#b91c1c;"></i>
            <span>Delivery Attempted — Customer Unreachable</span>
          </div>
          <p style="font-size:0.75rem;margin-top:0.25rem;line-height:1.4;">
            Your delivery partner attempted delivery at your selected spot but could not reach you. Please contact kitchen or pickup directly.
          </p>
        </div>`;
    }

    // OTP Box (Only visible to the customer for active orders)
    if (ord.raw_otp && ord.status !== 'DELIVERED' && ord.status !== 'CANCELLED' && ord.status !== 'CLOSED') {
      html += `
        <div class="otp-box" style="margin:1.25rem 0;">
          <div class="flex items-center gap-3">
            <div style="padding:0.75rem;background:var(--amber-500);color:#fff;border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);">
              <i data-lucide="key-round" style="width:1.5rem;height:1.5rem;"></i>
            </div>
            <div>
              <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--amber-900);">Delivery Verification Code</span>
              <p style="font-size:0.75rem;color:var(--amber-700);">Share this OTP with your delivery partner to receive your food</p>
            </div>
          </div>
          <div class="otp-display">
            <span class="otp-digits">${ord.raw_otp}</span>
          </div>
        </div>`;
    }

    // Status Stepper
    html += `
        <div style="padding:1.5rem 0;">
          <div class="order-stepper">
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div class="step-circle ${step >= 1 ? 'active' : 'inactive'}">
                <i data-lucide="package-check" style="width:1.25rem;height:1.25rem;"></i>
              </div>
              <span style="font-size:11px;font-weight:700;color:var(--stone-800);margin-top:0.5rem;">Placed</span>
              <span style="font-size:10px;color:var(--stone-400);">Razorpay Paid</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div class="step-circle ${step >= 2 ? 'active' : 'inactive'}">
                <i data-lucide="chef-hat" style="width:1.25rem;height:1.25rem;"></i>
              </div>
              <span style="font-size:11px;font-weight:700;color:var(--stone-800);margin-top:0.5rem;">Kitchen</span>
              <span style="font-size:10px;color:var(--stone-400);">Preparing</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div class="step-circle ${step >= 3 ? 'active' : 'inactive'}">
                <i data-lucide="bike" style="width:1.25rem;height:1.25rem;"></i>
              </div>
              <span style="font-size:11px;font-weight:700;color:var(--stone-800);margin-top:0.5rem;">Dispatched</span>
              <span style="font-size:10px;color:var(--stone-400);">On the way</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div class="step-circle ${step >= 4 ? 'delivered' : 'inactive'}">
                <i data-lucide="check-circle-2" style="width:1.25rem;height:1.25rem;"></i>
              </div>
              <span style="font-size:11px;font-weight:700;color:var(--stone-800);margin-top:0.5rem;">Delivered</span>
              <span style="font-size:10px;color:var(--stone-400);">OTP Verified</span>
            </div>
          </div>
        </div>`;

    // Location & Items
    html += `
        <div style="background:var(--stone-50);border-radius:var(--radius-2xl);padding:1rem;">
          <div class="flex items-center gap-2" style="font-size:0.75rem;color:var(--stone-700);">
            <i data-lucide="map-pin" style="width:1rem;height:1rem;color:var(--color-primary);flex-shrink:0;"></i>
            <span>Delivery Spot: <strong style="color:var(--stone-900);">${ord.location_name_snapshot || 'Campus Location'}</strong></span>
          </div>
          ${ord.kitchen_notes ? `
            <div style="padding:0.625rem;background:#fff;border:1px solid var(--stone-200);border-radius:var(--radius-xl);color:var(--stone-600);font-style:italic;font-size:0.75rem;margin-top:0.625rem;">
              "${ord.kitchen_notes}"
            </div>` : ''}
          <div style="padding-top:0.5rem;border-top:1px solid rgba(231,229,228,0.8);margin-top:0.5rem;">
            <span style="font-weight:700;color:var(--stone-800);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:0.375rem;">Ordered Items</span>
            ${(ord.items || []).map(it => `
              <div class="flex justify-between" style="font-size:0.75rem;color:var(--stone-800);margin-bottom:0.25rem;">
                <span>${it.quantity}x ${it.item_name || it.name}</span>
                <span style="font-weight:600;">₹${it.subtotal || it.price * it.quantity}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  // Order History sidebar
  html += `
  <div>
    <h4 style="font-weight:700;color:var(--stone-800);font-size:0.875rem;margin-bottom:0.75rem;">Order History</h4>
    <div style="max-height:31.25rem;overflow-y:auto;padding-right:0.25rem;">`;

  trackingOrders.forEach(ord => {
    const isSelected = currentTrackedOrder?.id === ord.id;
    const statusClass = ord.status === 'DELIVERED' ? 'badge-emerald' : ord.status === 'CANCELLED' ? 'badge-red' : 'badge-amber';
    html += `
      <div onclick="selectTrackedOrder(${ord.id})" style="padding:0.875rem;border-radius:var(--radius-2xl);border:1px solid ${isSelected ? 'var(--color-primary)' : 'var(--stone-200)'};${isSelected ? 'box-shadow:var(--shadow-md);background:#fff;' : 'background:#fff;'}cursor:pointer;transition:all 0.15s;margin-bottom:0.625rem;">
        <div class="flex items-center justify-between" style="margin-bottom:0.25rem;">
          <span style="font-weight:700;font-family:var(--font-mono);font-size:0.75rem;color:var(--stone-900);">#${ord.order_number}</span>
          <span class="badge ${statusClass}">${ord.status}</span>
        </div>
        <div class="flex items-center justify-between" style="font-size:0.75rem;color:var(--stone-500);">
          <span>${new Date(ord.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
          <span style="font-weight:700;color:var(--stone-900);">₹${ord.total_amount}</span>
        </div>
      </div>`;
  });

  html += `</div></div></div>`;

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function selectTrackedOrder(orderId) {
  currentTrackedOrder = trackingOrders.find(o => o.id === orderId) || null;
  renderTracking();
}
