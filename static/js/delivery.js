/* ================================================================
   Delivery Dashboard — orders, OTP verification, filtering, unpicked report
   ================================================================ */

let deliveryOrders = [];
let deliveryFilter = 'PENDING_DELIVERY';
let selectedDeliveryOrder = null;

async function loadDeliveryOrders() {
  try {
    const res = await fetch('/api/orders/delivery');
    const data = await res.json();
    deliveryOrders = data || [];
    updateDeliveryStats();
    renderDeliveryOrders();
  } catch (err) {
    console.error('Failed to load delivery orders:', err);
  }
}

function updateDeliveryStats() {
  const active = deliveryOrders.filter(o => o.status === 'DISPATCHED').length;
  const unpicked = deliveryOrders.filter(o => o.status === 'UNPICKED').length;
  const done = deliveryOrders.filter(o => o.status === 'DELIVERED').length;

  const elActive = document.getElementById('delivery-active-count');
  const elDone = document.getElementById('delivery-done-count');
  const elActiveLbl = document.getElementById('delivery-active-label');
  const elUnpickedLbl = document.getElementById('delivery-unpicked-label');
  const elDoneLbl = document.getElementById('delivery-done-label');

  if (elActive) elActive.textContent = active;
  if (elDone) elDone.textContent = done;
  if (elActiveLbl) elActiveLbl.textContent = active;
  if (elUnpickedLbl) elUnpickedLbl.textContent = unpicked;
  if (elDoneLbl) elDoneLbl.textContent = done;
}

function setDeliveryFilter(f, btn) {
  deliveryFilter = f;
  document.querySelectorAll('#delivery-filters .nav-pill').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDeliveryOrders();
}

function getFilteredDeliveryOrders() {
  return deliveryOrders.filter(o => {
    if (deliveryFilter === 'PENDING_DELIVERY') return o.status === 'DISPATCHED';
    if (deliveryFilter === 'UNPICKED') return o.status === 'UNPICKED';
    if (deliveryFilter === 'COMPLETED') return o.status === 'DELIVERED';
    return true;
  });
}

function renderDeliveryOrders() {
  const container = document.getElementById('delivery-content');
  const filtered = getFilteredDeliveryOrders();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:4rem 0;background:#fff;border-radius:var(--radius-3xl);border:1px solid var(--stone-200);padding:2rem;box-shadow:var(--shadow-sm);">
        <i data-lucide="bike" style="width:3rem;height:3rem;color:var(--stone-300);margin:0 auto 0.75rem;display:block;"></i>
        <h3 style="font-weight:700;font-size:1rem;color:var(--stone-800);">No orders in this section</h3>
        <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.25rem;">Orders will appear here immediately once marked "Dispatched" by the kitchen.</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = '<div class="space-y-4">';

  filtered.forEach(order => {
    const isDispatched = order.status === 'DISPATCHED';
    const isUnpicked = order.status === 'UNPICKED';
    const isDelivered = order.status === 'DELIVERED';

    let statusBadge = '';
    if (isDelivered) statusBadge = 'badge-emerald';
    else if (isDispatched) statusBadge = 'badge-blue';
    else if (isUnpicked) statusBadge = 'badge-red';
    else statusBadge = 'badge-stone';

    html += `
    <div class="delivery-card${isDelivered ? ' done' : ''}">
      <div class="flex items-center justify-between" style="padding-bottom:0.75rem;border-bottom:1px solid var(--stone-100);">
        <div>
          <span style="font-size:10px;font-weight:700;color:var(--stone-400);text-transform:uppercase;letter-spacing:0.05em;">Order Number</span>
          <h3 style="font-size:1rem;font-weight:800;font-family:var(--font-mono);color:var(--stone-900);">#${order.order_number}</h3>
        </div>
        <div style="text-align:right;">
          <span class="badge ${statusBadge}">${order.status}</span>
          <span style="display:block;font-size:11px;font-weight:700;color:var(--color-primary);margin-top:0.25rem;">₹${order.total_amount} (Paid)</span>
        </div>
      </div>

      <div style="padding:0.75rem 0;font-size:0.75rem;">
        <div class="flex items-center justify-between">
          <span style="color:var(--stone-500);">Customer:</span>
          <span style="font-weight:700;color:var(--stone-900);">${order.customer_name || 'Customer'}</span>
        </div>
        <div class="flex items-center justify-between" style="margin-top:0.375rem;">
          <span style="color:var(--stone-500);">Delivery Location:</span>
          <div class="flex items-center gap-1" style="font-weight:700;color:var(--color-primary);">
            <i data-lucide="map-pin" style="width:0.875rem;height:0.875rem;"></i>
            <span>${order.location_name_snapshot || 'Campus Location'}</span>
          </div>
        </div>
        ${order.customer_phone ? `
          <div class="flex items-center justify-between" style="margin-top:0.375rem;">
            <span style="color:var(--stone-500);">Contact:</span>
            <a href="tel:${order.customer_phone}" class="flex items-center gap-1" style="padding:0.25rem 0.75rem;background:var(--emerald-50);color:var(--emerald-700);border-radius:var(--radius-lg);font-weight:700;border:1px solid var(--emerald-200);">
              <i data-lucide="phone" style="width:0.75rem;height:0.75rem;"></i>
              <span>Call ${order.customer_phone}</span>
            </a>
          </div>` : ''}
        ${order.kitchen_notes ? `
          <div style="padding:0.5rem;background:var(--stone-50);border:1px solid var(--stone-200);border-radius:var(--radius-lg);color:var(--stone-600);font-style:italic;margin-top:0.5rem;">
            Note: "${order.kitchen_notes}"
          </div>` : ''}

        <div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed var(--stone-200);">
          <span style="font-size:10px;font-weight:700;color:var(--stone-500);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:0.25rem;">Dishes:</span>
          ${(order.items || []).map(i => `<div style="font-size:11px;color:var(--stone-700);">${i.quantity}x ${i.item_name || i.name}</div>`).join('')}
        </div>
      </div>

      ${isDispatched ? `
        <div class="flex items-center gap-2" style="padding-top:0.75rem;border-top:1px solid var(--stone-100);">
          <button class="btn btn-success flex-1" onclick="openOtpModal(${order.id}, '${order.order_number}')">
            <i data-lucide="key-round" style="width:1rem;height:1rem;"></i>
            <span>Verify Customer OTP & Handover</span>
          </button>
          <button class="btn btn-outline" style="color:#b91c1c;border-color:#fca5a5;" onclick="handleReportUnpicked(${order.id}, '${order.order_number}')" title="Customer unreachable / no-show">
            <i data-lucide="alert-triangle" style="width:1rem;height:1rem;"></i>
            <span>Unpicked</span>
          </button>
        </div>` : ''}

      ${isUnpicked ? `
        <div style="padding-top:0.5rem;border-top:1px solid var(--stone-100);">
          <div style="text-align:center;padding:0.5rem;font-size:0.75rem;font-weight:700;color:#b91c1c;background:#fef2f2;border-radius:var(--radius-xl);border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;gap:0.375rem;">
            <i data-lucide="alert-circle" style="width:1rem;height:1rem;"></i>
            <span>Flagged as Unpicked (Awaiting Kitchen Ticket Closure)</span>
          </div>
        </div>` : ''}

      ${isDelivered ? `
        <div style="padding-top:0.5rem;border-top:1px solid var(--stone-100);">
          <div style="text-align:center;padding:0.5rem;font-size:0.75rem;font-weight:700;color:var(--emerald-600);background:var(--emerald-50);border-radius:var(--radius-xl);border:1px solid var(--emerald-200);display:flex;align-items:center;justify-content:center;gap:0.375rem;">
            <i data-lucide="check-circle-2" style="width:1rem;height:1rem;"></i>
            <span>Successfully Handed Over & OTP Verified</span>
          </div>
        </div>` : ''}
    </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

async function handleReportUnpicked(orderId, orderNumber) {
  const confirmed = confirm(`Are you sure you want to mark Order #${orderNumber} as UNPICKED?\n\nUse this if the customer is unreachable or does not show up to collect the order.`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'UNPICKED', actor: 'Delivery Partner' })
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || 'Failed to update order');
    }
    await loadDeliveryOrders();
  } catch (err) {
    alert('Error reporting unpicked: ' + err.message);
  }
}

// Modal
function openOtpModal(orderId, orderNum) {
  selectedDeliveryOrder = { id: orderId, orderNumber: orderNum };
  document.getElementById('otp-order-number').textContent = '#' + orderNum;
  document.getElementById('otp-input').value = '';
  document.getElementById('otp-error').style.display = 'none';
  document.getElementById('otp-success').style.display = 'none';
  document.getElementById('otp-modal').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('otp-input').focus();
  }, 100);
}

function closeOtpModal() {
  document.getElementById('otp-modal').style.display = 'none';
  selectedDeliveryOrder = null;
}

async function handleVerifyOtp(e) {
  e.preventDefault();
  if (!selectedDeliveryOrder) return;

  const otp = document.getElementById('otp-input').value.trim();
  const btn = document.getElementById('otp-submit-btn');
  const errEl = document.getElementById('otp-error');
  const succEl = document.getElementById('otp-success');

  errEl.style.display = 'none';
  succEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch(`/api/orders/${selectedDeliveryOrder.id}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp, actor: 'Delivery Courier' }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Incorrect OTP code');
    }

    succEl.style.display = 'flex';
    document.getElementById('otp-success-text').textContent = json.message || 'OTP Verified! Handover completed.';

    setTimeout(() => {
      closeOtpModal();
      loadDeliveryOrders();
    }, 1200);
  } catch (err) {
    errEl.style.display = 'flex';
    document.getElementById('otp-error-text').textContent = err.message;
    document.getElementById('otp-input').value = '';
    document.getElementById('otp-input').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Delivery';
  }
}

// Init
document.addEventListener('DOMContentLoaded', function() {
  loadDeliveryOrders();
  setInterval(loadDeliveryOrders, 7000);
});
