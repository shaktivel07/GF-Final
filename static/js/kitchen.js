/* ================================================================
   SRM Kitchen Command (KDS) Logic — Sidebar, Batch Tally, Timers, No OTP
   ================================================================ */

let kitchenOrders = [];
let activeKitchenTab = 'ACTIVE';
let audioEnabled = true;
let previousOrderIds = new Set();
let datePreset = 'TODAY';
let customStartDate = '';
let customEndDate = '';
let kitchenUpdatingId = null;

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  if (typeof dateStr === 'string') {
    if (!dateStr.endsWith('Z') && !dateStr.includes('+')) {
      dateStr = dateStr.replace(' ', 'T') + 'Z';
    }
  }
  return new Date(dateStr);
}

// Sound synthesis for kitchen order ping
function playOrderAlert() {
  if (!audioEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    // Web audio might need user interaction
  }
}

function toggleKitchenTheme() {
  const current = localStorage.getItem('kds_theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('kds_theme', next);
  document.documentElement.className = 'theme-' + next;
  document.body.className = 'theme-' + next;
  updateThemeUI(next);
}

function updateThemeUI(theme) {
  const label = document.getElementById('theme-label');
  const icon = document.getElementById('theme-icon');
  const headerLabel = document.getElementById('theme-header-label');

  if (theme === 'light') {
    if (label) label.textContent = 'Dark Mode';
    if (icon) icon.setAttribute('data-lucide', 'moon');
    if (headerLabel) headerLabel.textContent = 'Dark Mode';
  } else {
    if (label) label.textContent = 'Light Mode';
    if (icon) icon.setAttribute('data-lucide', 'sun');
    if (headerLabel) headerLabel.textContent = 'Light Mode';
  }
  if (window.lucide) lucide.createIcons();
}

function toggleAudioAlert() {
  audioEnabled = !audioEnabled;
  const txt = document.getElementById('audio-text');
  const icon = document.getElementById('audio-icon');
  if (txt) txt.textContent = `Alert: ${audioEnabled ? 'ON' : 'OFF'}`;
  if (icon) icon.setAttribute('data-lucide', audioEnabled ? 'volume-2' : 'volume-x');
  if (window.lucide) lucide.createIcons();
}

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function setKitchenTab(tab, btn) {
  activeKitchenTab = tab;
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const titleEl = document.getElementById('view-title');
  if (titleEl) {
    switch (tab) {
      case 'ACTIVE': titleEl.textContent = 'Incoming & Prep Operations (Live Stream)'; break;
      case 'PREPARING': titleEl.textContent = 'Active Cooking Stations'; break;
      case 'DISPATCHED': titleEl.textContent = 'Dispatched Courier Handover Queue'; break;
      case 'UNPICKED': titleEl.textContent = 'Unpicked & Alert Tickets'; break;
      case 'DONE': titleEl.textContent = 'Completed & Archived Orders'; break;
      case 'ALL': titleEl.textContent = 'All Campus Orders Stream'; break;
    }
  }

  renderKitchenOrders();
}

function applyDatePreset(preset) {
  datePreset = preset;
  const now = new Date();

  if (preset === 'TODAY') {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    customStartDate = `${y}-${m}-${d}`;
    customEndDate = `${y}-${m}-${d}`;
  } else if (preset === 'YESTERDAY') {
    const yest = new Date(now.getTime() - 86400000);
    const y = yest.getFullYear();
    const m = String(yest.getMonth() + 1).padStart(2, '0');
    const d = String(yest.getDate()).padStart(2, '0');
    customStartDate = `${y}-${m}-${d}`;
    customEndDate = `${y}-${m}-${d}`;
  } else if (preset === 'MONTH') {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    customStartDate = `${y}-${m}-01`;
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    customEndDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  } else {
    customStartDate = '';
    customEndDate = '';
  }

  document.getElementById('filter-start-date').value = customStartDate;
  document.getElementById('filter-end-date').value = customEndDate;
  loadKitchenOrders();
}

function applyCustomDateRange() {
  customStartDate = document.getElementById('filter-start-date').value;
  customEndDate = document.getElementById('filter-end-date').value;
  loadKitchenOrders();
}

async function loadKitchenOrders() {
  const icon = document.getElementById('kds-refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    let url = '/api/orders/kitchen?';
    if (customStartDate) url += `start_date=${customStartDate}&`;
    if (customEndDate) url += `end_date=${customEndDate}&`;

    const res = await fetch(url);
    const data = await res.json();
    const orders = data || [];

    // Check for brand new incoming orders to trigger audio ping
    let hasNewOrder = false;
    orders.forEach(o => {
      if (o.status === 'CONFIRMED' && !previousOrderIds.has(o.id)) {
        hasNewOrder = true;
      }
    });
    if (hasNewOrder && previousOrderIds.size > 0) {
      playOrderAlert();
    }
    previousOrderIds = new Set(orders.map(o => o.id));

    kitchenOrders = orders;
    populateLocationFilter();
    updateSidebarBadges();
    updateBatchCookingSummary();
    renderKitchenOrders();
  } catch (err) {
    console.error('Error fetching kitchen orders:', err);
  } finally {
    if (icon) icon.classList.remove('animate-spin');
  }
}

function populateLocationFilter() {
  const sel = document.getElementById('kds-location-filter');
  if (!sel || sel.options.length > 1) return;

  const locs = new Set();
  kitchenOrders.forEach(o => {
    if (o.location_name_snapshot) locs.add(o.location_name_snapshot);
  });

  locs.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    sel.appendChild(opt);
  });
}

function updateSidebarBadges() {
  const activeCount = kitchenOrders.filter(o => o.status === 'CONFIRMED' || o.status === 'PREPARING').length;
  const prepCount = kitchenOrders.filter(o => o.status === 'PREPARING').length;
  const dispCount = kitchenOrders.filter(o => o.status === 'DISPATCHED').length;
  const unpickedCount = kitchenOrders.filter(o => o.status === 'UNPICKED').length;
  const doneCount = kitchenOrders.filter(o => o.status === 'DELIVERED' || o.status === 'CLOSED' || o.status === 'CANCELLED').length;

  const bActive = document.getElementById('count-active');
  const bPrep = document.getElementById('count-preparing');
  const bDisp = document.getElementById('count-dispatched');
  const bUnpicked = document.getElementById('count-unpicked');
  const bDone = document.getElementById('count-done');
  const bAll = document.getElementById('count-all');

  if (bActive) bActive.textContent = activeCount;
  if (bPrep) bPrep.textContent = prepCount;
  if (bDisp) bDisp.textContent = dispCount;
  if (bUnpicked) bUnpicked.textContent = unpickedCount;
  if (bDone) bDone.textContent = doneCount;
  if (bAll) bAll.textContent = kitchenOrders.length;
}

function updateBatchCookingSummary() {
  const summaryBox = document.getElementById('kds-batch-summary');
  const chipsContainer = document.getElementById('batch-chips-container');
  if (!summaryBox || !chipsContainer) return;

  // Aggregate items across active tickets (CONFIRMED and PREPARING)
  const activeOrders = kitchenOrders.filter(o => o.status === 'CONFIRMED' || o.status === 'PREPARING');
  if (activeOrders.length === 0) {
    summaryBox.style.display = 'none';
    return;
  }

  const tally = {};
  activeOrders.forEach(o => {
    (o.items || []).forEach(it => {
      const name = it.item_name || it.name || 'Dish';
      tally[name] = (tally[name] || 0) + (it.quantity || 1);
    });
  });

  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    summaryBox.style.display = 'none';
    return;
  }

  summaryBox.style.display = 'block';
  chipsContainer.innerHTML = entries.map(([dish, qty]) => `
    <div class="kds-batch-chip">
      <span class="kds-batch-chip-qty">${qty}x</span>
      <span style="font-weight:700;">${dish}</span>
    </div>
  `).join('');
}

function getFilteredOrders() {
  let list = [...kitchenOrders];

  // Tab filter
  if (activeKitchenTab === 'ACTIVE') {
    list = list.filter(o => o.status === 'CONFIRMED' || o.status === 'PREPARING');
  } else if (activeKitchenTab === 'PREPARING') {
    list = list.filter(o => o.status === 'PREPARING');
  } else if (activeKitchenTab === 'DISPATCHED') {
    list = list.filter(o => o.status === 'DISPATCHED');
  } else if (activeKitchenTab === 'UNPICKED') {
    list = list.filter(o => o.status === 'UNPICKED');
  } else if (activeKitchenTab === 'DONE') {
    list = list.filter(o => o.status === 'DELIVERED' || o.status === 'CLOSED' || o.status === 'CANCELLED');
  }

  // Location filter
  const locSel = document.getElementById('kds-location-filter');
  if (locSel && locSel.value) {
    list = list.filter(o => o.location_name_snapshot === locSel.value);
  }

  // Search filter
  const searchInput = document.getElementById('kds-search');
  if (searchInput && searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    list = list.filter(o => {
      const ordNum = (o.order_number || '').toLowerCase();
      const cust = (o.customer_name || '').toLowerCase();
      const phone = (o.customer_phone || '').toLowerCase();
      const loc = (o.location_name_snapshot || '').toLowerCase();
      const itemsMatch = (o.items || []).some(i => (i.item_name || i.name || '').toLowerCase().includes(q));
      return ordNum.includes(q) || cust.includes(q) || phone.includes(q) || loc.includes(q) || itemsMatch;
    });
  }

  // Sort
  const sortSel = document.getElementById('kds-sort-filter');
  const sortVal = sortSel ? sortSel.value : 'OLDEST';
  if (sortVal === 'OLDEST') {
    list.sort((a, b) => parseDate(a.created_at) - parseDate(b.created_at));
  } else if (sortVal === 'NEWEST') {
    list.sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at));
  } else if (sortVal === 'ITEMS_HIGH') {
    list.sort((a, b) => ((b.items || []).length) - ((a.items || []).length));
  }

  return list;
}

function renderKitchenOrders() {
  const container = document.getElementById('kitchen-content');
  if (!container) return;

  const orders = getFilteredOrders();

  if (orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:5rem 0;background:#141210;border-radius:var(--radius-3xl);border:1px solid #292524;padding:3rem 1.5rem;">
        <i data-lucide="utensils-crossed" style="width:3rem;height:3rem;color:var(--stone-600);margin:0 auto 0.75rem;display:block;"></i>
        <h3 style="font-weight:700;font-size:1.125rem;color:var(--stone-300);">No orders found in this view</h3>
        <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.375rem;max-width:24rem;margin-left:auto;margin-right:auto;">
          Select another category from the sidebar or adjust your date filter to view past order logs.
        </p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const now = new Date();
  let html = '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">';

  orders.forEach(order => {
    const isPending = order.status === 'CONFIRMED';
    const isPrep = order.status === 'PREPARING';
    const isDispatched = order.status === 'DISPATCHED';
    const isUnpicked = order.status === 'UNPICKED';
    const isDelivered = order.status === 'DELIVERED';
    const isClosed = order.status === 'CLOSED' || order.status === 'CANCELLED';

    // Calculate elapsed time in minutes
    const createdTime = parseDate(order.created_at);
    const elapsedMins = Math.max(0, Math.floor((now - createdTime) / 60000));

    let timerClass = 'timer-fresh';
    if (elapsedMins >= 20) timerClass = 'timer-urgent';
    else if (elapsedMins >= 10) timerClass = 'timer-warn';

    let cardClass = 'kds-card';
    if (isPending && elapsedMins >= 20) cardClass += ' urgent';
    else if (isPrep) cardClass += ' preparing';
    else if (isDispatched) cardClass += ' dispatched';

    let statusBadge = '';
    if (isPending) statusBadge = 'badge-amber-pulse';
    else if (isPrep) statusBadge = 'badge-orange';
    else if (isDispatched) statusBadge = 'badge-blue';
    else if (isUnpicked) statusBadge = 'badge-red';
    else if (isDelivered) statusBadge = 'badge-emerald';
    else statusBadge = 'badge-stone';

    const disabled = kitchenUpdatingId === order.id ? 'disabled' : '';

    html += `
    <div class="${cardClass}">
      <div>
        <!-- Card Header -->
        <div class="flex items-center justify-between" style="padding-bottom:0.75rem;border-bottom:1px solid #292524;margin-bottom:0.75rem;">
          <div>
            <span style="font-size:10px;font-weight:800;color:var(--stone-400);text-transform:uppercase;letter-spacing:0.08em;">Order Number</span>
            <h3 style="font-size:1.125rem;font-family:var(--font-mono);font-weight:900;color:#fff;">#${order.order_number}</h3>
          </div>
          <div style="text-align:right;">
            <span class="badge ${statusBadge}">${order.status}</span>
            <span style="display:block;font-size:10px;color:var(--stone-400);margin-top:0.125rem;">
              ${createdTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
            </span>
            <div style="margin-top:0.25rem;">
              <span class="kds-timer ${timerClass}">
                <i data-lucide="clock" style="width:0.75rem;height:0.75rem;"></i>
                <span>${elapsedMins}m ago</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Campus Drop Spot & Customer -->
        <div style="background:#141210;padding:0.75rem;border-radius:var(--radius-xl);border:1px solid #292524;margin-bottom:0.75rem;">
          <div class="flex items-center justify-between" style="font-size:12px;margin-bottom:0.25rem;">
            <div class="flex items-center gap-1.5" style="color:var(--kds-gold);font-weight:700;">
              <i data-lucide="map-pin" style="width:0.875rem;height:0.875rem;flex-shrink:0;"></i>
              <span>${order.location_name_snapshot || 'Campus Location'}</span>
            </div>
            <span style="color:var(--stone-400);font-size:11px;">₹${order.total_amount}</span>
          </div>
          <div class="flex items-center justify-between" style="font-size:11px;color:var(--stone-400);">
            <span>Customer: <strong style="color:#e7e5e4;">${order.customer_name || 'Customer'}</strong></span>
            ${order.customer_phone ? `
              <a href="tel:${order.customer_phone}" class="flex items-center gap-1" style="color:#34d399;font-weight:700;">
                <i data-lucide="phone" style="width:0.75rem;height:0.75rem;"></i>
                <span>${order.customer_phone}</span>
              </a>
            ` : ''}
          </div>
        </div>

        <!-- Special Kitchen Notes -->
        ${order.kitchen_notes ? `
          <div style="background:rgba(120,53,15,0.3);border:1px solid rgba(146,64,14,0.5);border-radius:var(--radius-xl);padding:0.625rem;font-size:11px;color:#fcd34d;margin-bottom:0.75rem;">
            <strong style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#fbbf24;font-weight:800;margin-bottom:0.125rem;">Special Instruction:</strong>
            "${order.kitchen_notes}"
          </div>
        ` : ''}

        <!-- Dishes Checklist -->
        <div style="margin-bottom:1rem;">
          <span style="font-size:10px;font-weight:800;color:var(--stone-400);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:0.375rem;">Dishes to Prepare:</span>
          <div class="space-y-1.5">
            ${(order.items || []).map(item => `
              <div class="flex items-center justify-between" style="background:#141210;padding:0.5rem 0.75rem;border-radius:var(--radius-lg);border:1px solid #292524;font-size:12px;">
                <div class="flex items-center gap-2">
                  <span style="background:#d97706;color:#fff;font-weight:900;font-size:12px;padding:0.125rem 0.5rem;border-radius:var(--radius-md);font-family:var(--font-mono);">${item.quantity}x</span>
                  <span style="font-weight:700;color:#f5f5f4;">${item.item_name || item.name}</span>
                </div>
                <span style="color:var(--stone-400);font-size:11px;">₹${item.subtotal}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="padding-top:0.75rem;border-top:1px solid #292524;">
        ${isPending ? `
          <button class="btn btn-block" style="background:#d97706;color:#fff;font-weight:800;font-size:12px;padding:0.625rem;" ${disabled} onclick="updateKitchenStatus(${order.id}, 'PREPARING')">
            <i data-lucide="flame" style="width:1rem;height:1rem;"></i>
            <span>Accept & Start Cooking</span>
          </button>
        ` : ''}

        ${isPrep ? `
          <button class="btn btn-block" style="background:#2563eb;color:#fff;font-weight:800;font-size:12px;padding:0.625rem;" ${disabled} onclick="updateKitchenStatus(${order.id}, 'DISPATCHED')">
            <i data-lucide="bike" style="width:1rem;height:1rem;"></i>
            <span>Mark Dispatched (Ready for Rider)</span>
          </button>
        ` : ''}

        ${isDispatched ? `
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:#38bdf8;background:rgba(14,165,233,0.15);border-radius:var(--radius-xl);border:1px solid rgba(14,165,233,0.3);display:flex;align-items:center;justify-content:center;gap:0.375rem;">
            <i data-lucide="bike" style="width:0.875rem;height:0.875rem;"></i>
            <span>Dispatched • Rider Handover in Progress</span>
          </div>
        ` : ''}

        ${isUnpicked ? `
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="text-align:center;padding:0.375rem 0.5rem;font-size:11px;font-weight:700;color:#fca5a5;background:rgba(185,28,28,0.2);border-radius:var(--radius-lg);border:1px solid rgba(185,28,28,0.4);">
              <span>⚠️ Customer Unreachable / No-Show</span>
            </div>
            <button class="btn btn-block" style="background:#b91c1c;color:#fff;font-weight:800;font-size:12px;padding:0.5rem;" ${disabled} onclick="if(confirm('Close and archive this unpicked ticket?')) updateKitchenStatus(${order.id}, 'CLOSED')">
              <i data-lucide="archive" style="width:0.875rem;height:0.875rem;"></i>
              <span>Close Order Ticket</span>
            </button>
          </div>
        ` : ''}

        ${isDelivered ? `
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:#34d399;background:rgba(6,95,70,0.3);border-radius:var(--radius-xl);border:1px solid rgba(6,95,70,0.5);display:flex;align-items:center;justify-content:center;gap:0.375rem;">
            <i data-lucide="check-circle-2" style="width:0.875rem;height:0.875rem;"></i>
            <span>Delivered & Handed Over</span>
          </div>
        ` : ''}

        ${isClosed ? `
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:var(--stone-400);background:rgba(41,37,36,0.5);border-radius:var(--radius-xl);border:1px solid #44403c;display:flex;align-items:center;justify-content:center;gap:0.375rem;">
            <i data-lucide="archive" style="width:0.875rem;height:0.875rem;"></i>
            <span>Ticket Closed / Resolved</span>
          </div>
        ` : ''}
      </div>
    </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

async function updateKitchenStatus(orderId, newStatus) {
  kitchenUpdatingId = orderId;
  renderKitchenOrders();

  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, actor: 'Kitchen Command' }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || 'Failed to update order status');
    }
    await loadKitchenOrders();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    kitchenUpdatingId = null;
    renderKitchenOrders();
  }
}

// Init
document.addEventListener('DOMContentLoaded', function() {
  const savedTheme = localStorage.getItem('kds_theme') || 'dark';
  updateThemeUI(savedTheme);
  applyDatePreset('TODAY');
  // Auto refresh live feed every 6 seconds
  setInterval(loadKitchenOrders, 6000);
});
