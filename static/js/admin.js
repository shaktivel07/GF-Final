/* ================================================================
   SRM Admin Console Logic — Analytics, Menu, Locations, Settings, Users, Purge
   ================================================================ */

let adminData = {
  analytics: null,
  categories: [],
  items: [],
  locations: [],
  settings: null,
  users: []
};
let currentAdminTab = 'ANALYTICS';

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || 'API request failed');
  }
  return json;
}

function flashMessage(msg) {
  const el = document.getElementById('admin-action-msg');
  const txt = document.getElementById('admin-action-text');
  if (el && txt) {
    txt.textContent = msg;
    el.style.display = 'flex';
    setTimeout(() => {
      el.style.display = 'none';
    }, 4000);
  }
}

function setAdminTab(tab, btn) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-tab-bar .nav-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById('tab-' + tab);
  if (target) target.style.display = 'block';

  renderCurrentTab();
  if (window.lucide) lucide.createIcons();
}

async function loadAdminData() {
  const icon = document.getElementById('admin-refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    const [analytics, categories, items, locations, settings, users] = await Promise.all([
      apiFetch('/api/admin/analytics').catch(() => null),
      apiFetch('/api/categories').catch(() => []),
      apiFetch('/api/items?all=true').catch(() => []),
      apiFetch('/api/locations?all=true').catch(() => []),
      apiFetch('/api/settings').catch(() => null),
      apiFetch('/api/admin/users').catch(() => [])
    ]);

    adminData = { analytics, categories, items, locations, settings, users };
    renderCurrentTab();
  } catch (err) {
    console.error('Error loading admin data:', err);
    flashMessage('Error: ' + err.message);
  } finally {
    if (icon) icon.classList.remove('animate-spin');
    if (window.lucide) lucide.createIcons();
  }
}

function renderCurrentTab() {
  switch (currentAdminTab) {
    case 'ANALYTICS': renderAnalyticsTab(); break;
    case 'MENU': renderMenuTab(); break;
    case 'LOCATIONS': renderLocationsTab(); break;
    case 'SETTINGS': renderSettingsTab(); break;
    case 'USERS': renderUsersTab(); break;
    case 'STORAGE': renderStorageTab(); break;
  }
  if (window.lucide) lucide.createIcons();
}

/* ---------------- 1. ANALYTICS TAB ---------------- */
function renderAnalyticsTab() {
  const an = adminData.analytics || {};
  const container = document.getElementById('analytics-content');
  if (!container) return;

  container.innerHTML = `
    <!-- Stat Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4" style="margin-bottom:1.5rem;">
      <div class="stat-card">
        <div class="stat-icon red"><i data-lucide="indian-rupee" class="icon-md"></i></div>
        <div>
          <span class="stat-label">Total Sales</span>
          <span class="stat-value">₹${an.total_revenue || 0}</span>
          <p style="font-size:10px;color:var(--stone-400);margin-top:2px;">Paid via Razorpay</p>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon emerald"><i data-lucide="trending-up" class="icon-md"></i></div>
        <div>
          <span class="stat-label">Today's Revenue</span>
          <span class="stat-value" style="color:var(--emerald-600);">₹${an.today_revenue || 0}</span>
          <p style="font-size:10px;color:var(--stone-400);margin-top:2px;">${an.today_orders || 0} order(s) today</p>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><i data-lucide="shopping-bag" class="icon-md"></i></div>
        <div>
          <span class="stat-label">Active Orders</span>
          <span class="stat-value" style="color:var(--amber-600);">${an.active_orders || 0}</span>
          <p style="font-size:10px;color:var(--stone-400);margin-top:2px;">In prep or delivery</p>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i data-lucide="users" class="icon-md"></i></div>
        <div>
          <span class="stat-label">Registered Users</span>
          <span class="stat-value">${an.total_users || adminData.users.length}</span>
          <p style="font-size:10px;color:var(--stone-400);margin-top:2px;">Firebase Verified</p>
        </div>
      </div>
    </div>

    <!-- Top Items & Recent Orders -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);padding:1.25rem;box-shadow:var(--shadow-sm);">
        <h3 style="font-weight:700;font-size:0.875rem;color:var(--stone-900);margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
          <i data-lucide="utensils-crossed" style="color:var(--color-primary);width:1rem;height:1rem;"></i>
          <span>Top-Selling Delicacies</span>
        </h3>
        ${(an.top_items && an.top_items.length > 0) ? `
          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            ${an.top_items.map((it, idx) => `
              <div class="flex items-center justify-between" style="font-size:0.75rem;">
                <div class="flex items-center gap-2">
                  <span style="width:1.5rem;height:1.5rem;border-radius:9999px;background:var(--stone-100);font-weight:700;color:var(--stone-600);display:flex;align-items:center;justify-content:center;font-size:10px;">${idx + 1}</span>
                  <span style="font-weight:700;color:var(--stone-800);">${it.name}</span>
                </div>
                <div style="text-align:right;">
                  <span style="font-weight:700;color:var(--stone-900);">${it.total_quantity} sold</span>
                  <span style="display:block;font-size:10px;color:var(--stone-400);">₹${it.total_sales}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <p style="font-size:0.75rem;color:var(--stone-400);text-align:center;padding:2rem 0;">No completed order metrics yet</p>
        `}
      </div>

      <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);padding:1.25rem;box-shadow:var(--shadow-sm);">
        <h3 style="font-weight:700;font-size:0.875rem;color:var(--stone-900);margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
          <i data-lucide="activity" style="color:var(--color-primary);width:1rem;height:1rem;"></i>
          <span>Recent Activity Feed</span>
        </h3>
        ${(an.recent_orders && an.recent_orders.length > 0) ? `
          <div style="display:flex;flex-direction:column;gap:0.625rem;max-height:18rem;overflow-y:auto;">
            ${an.recent_orders.map(o => `
              <div class="flex items-center justify-between" style="padding:0.5rem 0.75rem;background:var(--stone-50);border-radius:var(--radius-xl);font-size:0.75rem;">
                <div>
                  <span style="font-weight:700;font-family:var(--font-mono);color:var(--stone-900);">#${o.order_number}</span>
                  <span style="color:var(--stone-500);font-size:11px;margin-left:0.5rem;">${o.user_name || 'Customer'}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span style="font-weight:700;color:var(--stone-800);">₹${o.total_amount}</span>
                  <span class="badge ${o.status === 'DELIVERED' ? 'badge-emerald' : o.status === 'CANCELLED' ? 'badge-red' : 'badge-amber'}">${o.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <p style="font-size:0.75rem;color:var(--stone-400);text-align:center;padding:2rem 0;">No live activity stream</p>
        `}
      </div>
    </div>
  `;
}

/* ---------------- 2. MENU TAB ---------------- */
function renderMenuTab() {
  const container = document.getElementById('menu-content');
  if (!container) return;

  const cats = adminData.categories || [];
  const items = adminData.items || [];

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3" style="margin-bottom:1.5rem;">
      <div>
        <h2 style="font-size:1.125rem;font-weight:800;font-family:var(--font-serif);color:var(--stone-900);">Dishes & Categories</h2>
        <p style="font-size:0.75rem;color:var(--stone-500);">Manage restaurant menu, pricing, timings, and stock availability</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-outline btn-sm" onclick="openCategoryModal()">
          <i data-lucide="folder-plus" class="icon-sm"></i>
          <span>Add Category</span>
        </button>
        <button class="btn btn-primary btn-sm" onclick="openItemModal()">
          <i data-lucide="plus" class="icon-sm"></i>
          <span>Add Food Dish</span>
        </button>
      </div>
    </div>

    <!-- Category Filter Bar -->
    <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none" style="margin-bottom:1.25rem;">
      <button class="filter-pill active" onclick="filterMenuAdmin(null, this)">All (${items.length})</button>
      ${cats.map(c => `
        <button class="filter-pill" onclick="filterMenuAdmin(${c.id}, this)">
          ${c.name} (${items.filter(i => i.category_id === c.id).length})
        </button>
      `).join('')}
    </div>

    <!-- Items Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="admin-items-grid">
      ${renderItemsList(items)}
    </div>
  `;
}

function renderItemsList(itemsList) {
  if (itemsList.length === 0) {
    return `<div style="grid-column:1/-1;text-align:center;padding:3rem 0;color:var(--stone-400);font-size:0.875rem;">No dishes match your filter</div>`;
  }

  return itemsList.map(it => `
    <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);overflow:hidden;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;justify-content:between;">
      <div style="height:8rem;position:relative;background:var(--stone-100);">
        <img src="${it.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80'}" alt="${it.name}" style="width:100%;height:100%;object-fit:cover;">
        <span class="badge ${it.is_available ? 'badge-emerald' : 'badge-red'}" style="position:absolute;top:0.5rem;right:0.5rem;">
          ${it.is_available ? 'In Stock' : 'Sold Out'}
        </span>
      </div>
      <div style="padding:1rem;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
        <div>
          <div class="flex items-center justify-between" style="margin-bottom:0.25rem;">
            <h4 style="font-weight:700;font-size:0.875rem;color:var(--stone-900);">${it.name}</h4>
            <span style="font-weight:800;color:var(--color-primary);font-size:0.875rem;">₹${it.price}</span>
          </div>
          <p style="font-size:11px;color:var(--stone-500);line-height:1.4;margin-bottom:0.75rem;">${it.description || 'No description'}</p>
          ${(it.available_start_time || it.available_end_time) ? `
            <div class="flex items-center gap-1" style="font-size:10px;color:var(--stone-400);margin-bottom:0.5rem;">
              <i data-lucide="clock" style="width:0.75rem;height:0.75rem;"></i>
              <span>${it.available_start_time || '00:00'} - ${it.available_end_time || '23:59'}</span>
            </div>
          ` : ''}
        </div>
        <div class="flex items-center gap-2" style="border-top:1px solid var(--stone-100);padding-top:0.75rem;">
          <button class="btn btn-outline btn-sm flex-1" onclick="handleToggleItemStock(${it.id}, ${!it.is_available})">
            ${it.is_available ? 'Set Out of Stock' : 'Set Available'}
          </button>
          <button class="btn btn-outline btn-sm" onclick='openEditItemModal(${JSON.stringify(it).replace(/'/g, "&apos;")})' title="Edit">
            <i data-lucide="edit-3" class="icon-sm"></i>
          </button>
          <button class="btn btn-outline btn-sm" style="color:#b91c1c;" onclick="handleDeleteItem(${it.id})" title="Delete">
            <i data-lucide="trash-2" class="icon-sm"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function filterMenuAdmin(catId, btn) {
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const items = catId ? (adminData.items || []).filter(i => i.category_id === catId) : (adminData.items || []);
  const grid = document.getElementById('admin-items-grid');
  if (grid) {
    grid.innerHTML = renderItemsList(items);
    if (window.lucide) lucide.createIcons();
  }
}

/* ---------------- 3. LOCATIONS TAB ---------------- */
function renderLocationsTab() {
  const container = document.getElementById('locations-content');
  if (!container) return;

  const locs = adminData.locations || [];

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3" style="margin-bottom:1.5rem;">
      <div>
        <h2 style="font-size:1.125rem;font-weight:800;font-family:var(--font-serif);color:var(--stone-900);">SRM Campus Delivery Spots</h2>
        <p style="font-size:0.75rem;color:var(--stone-500);">Configure drop locations (Hostels, Tech Parks, UB, Library, Java Green)</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openLocationModal()">
        <i data-lucide="plus" class="icon-sm"></i>
        <span>Add Campus Spot</span>
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${locs.map(l => `
        <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);padding:1.25rem;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div class="flex items-center justify-between" style="margin-bottom:0.5rem;">
              <div class="flex items-center gap-2">
                <i data-lucide="map-pin" style="color:var(--color-primary);width:1rem;height:1rem;"></i>
                <h4 style="font-weight:700;font-size:0.875rem;color:var(--stone-900);">${l.name}</h4>
              </div>
              <span class="badge ${l.is_active ? 'badge-emerald' : 'badge-stone'}">
                ${l.is_active ? 'Active' : 'Disabled'}
              </span>
            </div>
            <p style="font-size:0.75rem;color:var(--stone-500);margin-bottom:1rem;">${l.description || 'Campus building drop point'}</p>
          </div>
          <div class="flex items-center gap-2" style="border-top:1px solid var(--stone-100);padding-top:0.75rem;">
            <button class="btn btn-outline btn-sm flex-1" onclick="handleToggleLocation(${l.id}, ${!l.is_active})">
              ${l.is_active ? 'Disable Spot' : 'Enable Spot'}
            </button>
            <button class="btn btn-outline btn-sm" style="color:#b91c1c;" onclick="handleDeleteLocation(${l.id})">
              <i data-lucide="trash-2" class="icon-sm"></i>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---------------- 4. SETTINGS TAB ---------------- */
function renderSettingsTab() {
  const container = document.getElementById('settings-content');
  if (!container) return;

  const s = adminData.settings || {};

  container.innerHTML = `
    <div style="max-width:36rem;margin:0 auto;background:#fff;border-radius:var(--radius-3xl);border:1px solid var(--stone-200);padding:1.5rem;box-shadow:var(--shadow-sm);">
      <h2 style="font-size:1.125rem;font-weight:800;font-family:var(--font-serif);color:var(--stone-900);margin-bottom:0.25rem;">Restaurant Operating Settings</h2>
      <p style="font-size:0.75rem;color:var(--stone-500);margin-bottom:1.5rem;">Controls order intake, minimum cart thresholds, and announcement notifications</p>

      <form onsubmit="handleSaveSettings(event)">
        <!-- Accepting Orders Toggle -->
        <div class="flex items-center justify-between" style="padding:1rem;background:var(--stone-50);border-radius:var(--radius-2xl);margin-bottom:1rem;">
          <div>
            <span style="font-weight:700;font-size:0.875rem;color:var(--stone-900);display:block;">Accepting Orders</span>
            <span style="font-size:11px;color:var(--stone-500);">Toggle campus store live ordering switch</span>
          </div>
          <input type="checkbox" id="setting-accepting" ${s.is_accepting_orders ? 'checked' : ''} style="width:1.5rem;height:1.5rem;accent-color:var(--emerald-600);">
        </div>

        <div class="grid grid-cols-2 gap-3" style="margin-bottom:1rem;">
          <div>
            <label class="form-label">Minimum Order (₹)</label>
            <input type="number" id="setting-min-order" class="form-input" value="${s.min_order_amount || 0}" min="0">
          </div>
          <div>
            <label class="form-label">Delivery Fee (₹)</label>
            <input type="number" id="setting-delivery-fee" class="form-input" value="${s.delivery_fee || 0}" min="0">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3" style="margin-bottom:1rem;">
          <div>
            <label class="form-label">Opening Time (HH:MM)</label>
            <input type="time" id="setting-opening-time" class="form-input" value="${s.opening_time || '08:00'}">
          </div>
          <div>
            <label class="form-label">Closing Time (HH:MM)</label>
            <input type="time" id="setting-closing-time" class="form-input" value="${s.closing_time || '23:00'}">
          </div>
        </div>

        <div style="margin-bottom:1rem;">
          <label class="form-label">Estimated Prep Time (Mins)</label>
          <input type="number" id="setting-prep-time" class="form-input" value="${s.estimated_prep_time_mins || 25}" min="5">
        </div>

        <div style="margin-bottom:1.5rem;">
          <label class="form-label">Announcement Banner Text</label>
          <input type="text" id="setting-banner" class="form-input" value="${s.announcement_banner || ''}" placeholder="e.g. SRM Campus Festival: 10% off Biryani today!">
        </div>

        <button type="submit" class="btn btn-primary btn-block">
          <i data-lucide="check" class="icon-sm"></i>
          <span>Save Restaurant Settings</span>
        </button>
      </form>
    </div>
  `;
}

/* ---------------- 5. USERS TAB ---------------- */
function renderUsersTab() {
  const container = document.getElementById('users-content');
  if (!container) return;

  const users = adminData.users || [];

  container.innerHTML = `
    <div style="margin-bottom:1.5rem;">
      <h2 style="font-size:1.125rem;font-weight:800;font-family:var(--font-serif);color:var(--stone-900);">Registered Campus Customers</h2>
      <p style="font-size:0.75rem;color:var(--stone-500);">Firebase authenticated customer profiles and order volume</p>
    </div>

    <div style="background:#fff;border-radius:var(--radius-2xl);border:1px solid var(--stone-200);overflow:hidden;box-shadow:var(--shadow-sm);">
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;text-align:left;">
          <thead>
            <tr style="background:var(--stone-50);border-bottom:1px solid var(--stone-200);color:var(--stone-500);text-transform:uppercase;font-size:10px;letter-spacing:0.05em;">
              <th style="padding:0.75rem 1rem;">Customer</th>
              <th style="padding:0.75rem 1rem;">Email</th>
              <th style="padding:0.75rem 1rem;">Phone</th>
              <th style="padding:0.75rem 1rem;">Role</th>
              <th style="padding:0.75rem 1rem;">Orders Placed</th>
              <th style="padding:0.75rem 1rem;">Joined Date</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr style="border-bottom:1px solid var(--stone-100);">
                <td style="padding:0.75rem 1rem;font-weight:700;color:var(--stone-900);">${u.name || 'SRM Student/Faculty'}</td>
                <td style="padding:0.75rem 1rem;color:var(--stone-600);">${u.email || '—'}</td>
                <td style="padding:0.75rem 1rem;color:var(--stone-600);">${u.phone || '—'}</td>
                <td style="padding:0.75rem 1rem;"><span class="badge ${u.role === 'ADMIN' ? 'badge-red' : 'badge-stone'}">${u.role || 'USER'}</span></td>
                <td style="padding:0.75rem 1rem;font-weight:700;color:var(--stone-800);">${u.order_count || 0}</td>
                <td style="padding:0.75rem 1rem;color:var(--stone-400);">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------- 6. STORAGE TAB ---------------- */
function renderStorageTab() {
  const container = document.getElementById('storage-content');
  if (!container) return;

  container.innerHTML = `
    <div style="max-width:32rem;margin:0 auto;background:#fff;border-radius:var(--radius-3xl);border:1px solid #fecaca;padding:1.5rem;box-shadow:var(--shadow-sm);">
      <div class="flex items-center gap-3" style="margin-bottom:1rem;">
        <div style="width:2.5rem;height:2.5rem;border-radius:var(--radius-2xl);background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;">
          <i data-lucide="database" class="icon-lg"></i>
        </div>
        <div>
          <h2 style="font-size:1.125rem;font-weight:800;font-family:var(--font-serif);color:#b91c1c;">Database Maintenance</h2>
          <p style="font-size:0.75rem;color:var(--stone-500);">Clean up legacy orders and optimize Supabase PostgreSQL performance</p>
        </div>
      </div>

      <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:var(--radius-2xl);padding:1rem;margin-bottom:1.5rem;font-size:0.75rem;color:#991b1b;line-height:1.5;">
        Regular order clearing prevents the database connection limits from bloating and accelerates kitchen & delivery dashboard queries.
      </div>

      <button class="btn btn-block" style="background:#b91c1c;color:#fff;" onclick="openClearModal()">
        <i data-lucide="trash-2" class="icon-sm"></i>
        <span>Open Order Purge Assistant</span>
      </button>
    </div>
  `;
}

/* ---------------- MODAL & FORM HANDLERS ---------------- */
function openItemModal() {
  document.getElementById('item-id').value = '';
  document.getElementById('item-name').value = '';
  document.getElementById('item-price').value = '99';
  document.getElementById('item-image').value = '';
  document.getElementById('item-desc').value = '';
  document.getElementById('item-start-time').value = '';
  document.getElementById('item-end-time').value = '';
  document.getElementById('item-available').checked = true;
  document.getElementById('item-modal-title').textContent = 'Add Food Dish';

  // populate categories
  const catSelect = document.getElementById('item-category');
  catSelect.innerHTML = (adminData.categories || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  document.getElementById('item-modal').style.display = 'flex';
}

function openEditItemModal(item) {
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-price').value = item.price;
  document.getElementById('item-image').value = item.image_url || '';
  document.getElementById('item-desc').value = item.description || '';
  document.getElementById('item-start-time').value = item.available_start_time || '';
  document.getElementById('item-end-time').value = item.available_end_time || '';
  document.getElementById('item-available').checked = !!item.is_available;
  document.getElementById('item-modal-title').textContent = 'Edit Food Dish';

  const catSelect = document.getElementById('item-category');
  catSelect.innerHTML = (adminData.categories || []).map(c => `<option value="${c.id}" ${c.id === item.category_id ? 'selected' : ''}>${c.name}</option>`).join('');

  document.getElementById('item-modal').style.display = 'flex';
}

function closeItemModal() {
  document.getElementById('item-modal').style.display = 'none';
}

async function handleSaveItem(e) {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    name: document.getElementById('item-name').value,
    category_id: parseInt(document.getElementById('item-category').value, 10),
    price: parseFloat(document.getElementById('item-price').value),
    image_url: document.getElementById('item-image').value,
    description: document.getElementById('item-desc').value,
    available_start_time: document.getElementById('item-start-time').value || null,
    available_end_time: document.getElementById('item-end-time').value || null,
    is_available: document.getElementById('item-available').checked
  };

  try {
    if (id) {
      await apiFetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      flashMessage('Dish updated successfully');
    } else {
      await apiFetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      flashMessage('New dish added to menu');
    }
    closeItemModal();
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

async function handleToggleItemStock(id, isAvailable) {
  try {
    await apiFetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: isAvailable })
    });
    flashMessage('Item availability updated');
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

async function handleDeleteItem(id) {
  if (!confirm('Are you sure you want to remove this dish from the database?')) return;
  try {
    await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    flashMessage('Dish removed');
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

function openCategoryModal() {
  document.getElementById('category-name').value = '';
  document.getElementById('category-order').value = '1';
  document.getElementById('category-active').checked = true;
  document.getElementById('category-modal').style.display = 'flex';
}

function closeCategoryModal() {
  document.getElementById('category-modal').style.display = 'none';
}

async function handleSaveCategory(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('category-name').value,
    display_order: parseInt(document.getElementById('category-order').value, 10),
    is_active: document.getElementById('category-active').checked
  };

  try {
    await apiFetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    flashMessage('Menu category created');
    closeCategoryModal();
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

function openLocationModal() {
  document.getElementById('location-name').value = '';
  document.getElementById('location-desc').value = '';
  document.getElementById('location-active').checked = true;
  document.getElementById('location-modal').style.display = 'flex';
}

function closeLocationModal() {
  document.getElementById('location-modal').style.display = 'none';
}

async function handleSaveLocation(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('location-name').value,
    description: document.getElementById('location-desc').value,
    is_active: document.getElementById('location-active').checked
  };

  try {
    await apiFetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    flashMessage('Campus delivery spot added');
    closeLocationModal();
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

async function handleToggleLocation(id, isActive) {
  try {
    await apiFetch(`/api/locations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive })
    });
    flashMessage('Campus spot updated');
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

async function handleDeleteLocation(id) {
  if (!confirm('Are you sure you want to remove this delivery spot?')) return;
  try {
    await apiFetch(`/api/locations/${id}?hard=true`, { method: 'DELETE' });
    flashMessage('Location removed');
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const payload = {
    is_accepting_orders: document.getElementById('setting-accepting').checked,
    min_order_amount: parseFloat(document.getElementById('setting-min-order').value || 0),
    delivery_fee: parseFloat(document.getElementById('setting-delivery-fee').value || 0),
    opening_time: document.getElementById('setting-opening-time').value,
    closing_time: document.getElementById('setting-closing-time').value,
    estimated_prep_time_mins: parseInt(document.getElementById('setting-prep-time').value || 25, 10),
    announcement_banner: document.getElementById('setting-banner').value
  };

  try {
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    flashMessage('Restaurant settings updated');
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

function openClearModal() {
  document.getElementById('clear-orders-modal').style.display = 'flex';
}

function closeClearModal() {
  document.getElementById('clear-orders-modal').style.display = 'none';
}

async function handleExecuteClearOrders() {
  const mode = document.querySelector('input[name="clearMode"]:checked').value;
  try {
    const res = await apiFetch('/api/admin/clear-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    flashMessage(res.message || 'Orders table cleared successfully');
    closeClearModal();
    loadAdminData();
  } catch (err) {
    flashMessage('Error: ' + err.message);
  }
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  loadAdminData();
});
