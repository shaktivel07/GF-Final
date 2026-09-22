/* ================================================================
   SRM Good Foods — Main Application Logic
   Handles: navigation, auth state, menu loading, food cards
   ================================================================ */

// ---- Global State ----
let currentUser = null;       // { id, firebase_uid, email, name, phone, role }
let currentView = 'store';
let menuItems = [];
let categories = [];
let locations = [];
let settings = null;
let activeCategory = 'all';

// ---- API Helper ----
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ---- View Switching ----
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-panel').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('active');
  });
  const target = document.getElementById('view-' + view);
  if (target) { target.style.display = 'block'; target.classList.add('active'); }

  // Update nav pills
  document.querySelectorAll('.nav-pill[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.mobile-menu-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'tracking' && currentUser) {
    loadTrackingOrders();
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Mobile Menu ----
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  menu.classList.toggle('open');
}
function closeMobileMenu() {
  document.getElementById('mobile-menu').classList.remove('open');
}

// ---- Auth ----
function openAuthModal() { document.getElementById('auth-modal').style.display = 'flex'; }
function closeAuthModal() { document.getElementById('auth-modal').style.display = 'none'; hideEl('auth-error'); }

let isSyncingUser = false;

async function syncFirebaseUser(fbUser) {
  if (!fbUser || isSyncingUser) return;
  isSyncingUser = true;

  try {
    const data = await apiFetch('/api/auth/sync-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firebase_uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName || 'SRM Customer',
        phone: fbUser.phoneNumber || null,
      }),
    });

    currentUser = data.user || data;
    closeAuthModal();
    updateAuthUI();

    if (!currentUser.phone) {
      openPhoneModal();
    }
  } catch (err) {
    console.error('User sync failed:', err);
  } finally {
    isSyncingUser = false;
  }
}

async function signInWithGoogle() {
  if (!window._firebaseAuth || !window._googleProvider) {
    showAuthError('Firebase not configured');
    return;
  }
  const btn = document.getElementById('google-signin-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:1rem;height:1rem;"></span> Signing in...';
  hideEl('auth-error');

  try {
    const result = await window._firebaseAuth.signInWithPopup(window._googleProvider);
    await syncFirebaseUser(result.user);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAuthError(err.message || 'Sign-in failed');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg><span>Continue with Google</span>';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  document.getElementById('auth-error-text').textContent = msg;
  el.style.display = 'flex';
}

function updateAuthUI() {
  const section = document.getElementById('auth-section');
  if (currentUser) {
    section.innerHTML = `
      <div class="flex items-center gap-2">
        <div style="width:2rem;height:2rem;border-radius:var(--radius-full);background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.75rem;">
          ${(currentUser.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div class="hide-mobile">
          <span style="font-weight:700;font-size:0.75rem;color:var(--stone-900);display:block;line-height:1;">${currentUser.name || 'Customer'}</span>
          <span style="font-size:10px;color:var(--stone-400);">${currentUser.email || ''}</span>
        </div>
        <button onclick="signOut()" style="padding:0.375rem;color:var(--stone-400);border-radius:var(--radius-full);" title="Sign out">
          <i data-lucide="log-out" style="width:1rem;height:1rem;"></i>
        </button>
      </div>`;
    if (window.lucide) lucide.createIcons();
  } else {
    section.innerHTML = `
      <button class="btn-signin" id="signin-btn" onclick="openAuthModal()">
        <i data-lucide="user-circle" class="icon-md"></i>
        <span class="hide-mobile">Sign In</span>
      </button>`;
    if (window.lucide) lucide.createIcons();
  }
}

function signOut() {
  if (window._firebaseAuth) window._firebaseAuth.signOut();
  currentUser = null;
  updateAuthUI();
  if (currentView === 'tracking') {
    renderTrackingSignedOut();
  }
}

// ---- Phone Modal ----
function openPhoneModal() { document.getElementById('phone-modal').style.display = 'flex'; }
function closePhoneModal() { document.getElementById('phone-modal').style.display = 'none'; }

async function submitPhone(e) {
  e.preventDefault();
  const phone = document.getElementById('phone-input').value.trim();
  hideEl('phone-error');

  if (phone.length < 10) {
    showEl('phone-error');
    document.getElementById('phone-error-text').textContent = 'Please enter a valid 10-digit phone number';
    return;
  }

  const btn = document.getElementById('phone-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const data = await apiFetch('/api/auth/update-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firebase_uid: currentUser.firebase_uid, phone }),
    });
    currentUser = data.user || { ...currentUser, phone };
    closePhoneModal();
    updateAuthUI();
  } catch (err) {
    showEl('phone-error');
    document.getElementById('phone-error-text').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Continue';
  }
}

// ---- Staff Login ----
let selectedPortal = 'admin';
function openStaffModal() { document.getElementById('staff-modal').style.display = 'flex'; }
function closeStaffModal() { document.getElementById('staff-modal').style.display = 'none'; hideEl('staff-error'); }

function setPortalTab(tab) {
  selectedPortal = tab;
  ['admin', 'kitchen', 'delivery'].forEach(t => {
    const el = document.getElementById('portal-tab-' + t);
    el.classList.toggle('active', t === tab);
  });
  // Update placeholder
  const placeholders = { admin: 'admin', kitchen: 'kitchen / srm', delivery: 'delivery' };
  document.getElementById('staff-username').placeholder = placeholders[tab] || 'username';
}

async function submitStaffLogin(e) {
  e.preventDefault();
  hideEl('staff-error');
  const username = document.getElementById('staff-username').value.trim();
  const password = document.getElementById('staff-password').value;
  const btn = document.getElementById('staff-submit-btn');
  btn.disabled = true;

  try {
    const data = await apiFetch('/api/auth/portal-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    closeStaffModal();
    // Redirect to portal
    if (data.portal === 'KITCHEN') window.location.href = '/kitchen';
    else if (data.portal === 'DELIVERY') window.location.href = '/delivery';
    else if (data.portal === 'ADMIN') window.location.href = '/admin';
  } catch (err) {
    showEl('staff-error');
    document.getElementById('staff-error-text').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ---- Load Data ----
async function loadInitialData() {
  try {
    const [catsData, itemsData, locsData, settingsData] = await Promise.all([
      apiFetch('/api/categories').catch(() => []),
      apiFetch('/api/items').catch(() => []),
      apiFetch('/api/locations').catch(() => []),
      apiFetch('/api/settings').catch(() => null),
    ]);
    categories = catsData || [];
    menuItems = itemsData || [];
    locations = locsData || [];
    settings = settingsData;

    renderCategoryPills();
    renderFoodGrid();
    populateLocationDropdown();
    updateHeroStatus();
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }
}

function updateHeroStatus() {
  const statusText = document.getElementById('hero-status-text');
  const closedOverlay = document.getElementById('closed-overlay');
  if (settings) {
    if (settings.is_open_today) {
      const open = (settings.opening_time || '07:00:00').slice(0, 5);
      const close = (settings.closing_time || '23:00:00').slice(0, 5);
      statusText.textContent = `Open ${open} – ${close}`;
      closedOverlay.classList.add('hidden');
      closedOverlay.style.display = 'none';
    } else {
      statusText.textContent = 'Closed Today';
      closedOverlay.classList.remove('hidden');
      closedOverlay.style.display = 'flex';
      document.getElementById('closed-message-text').textContent = settings.closed_message || 'Kitchen is closed today.';
    }
  }
  document.getElementById('hero-location-count').textContent = locations.length + ' Spots';
}

// ---- Category Pills ----
function renderCategoryPills() {
  const container = document.getElementById('category-filter-pills');
  let html = '<button class="nav-pill active" data-cat="all" onclick="filterByCategory(\'all\', this)">All Items</button>';
  categories.forEach(cat => {
    html += `<button class="nav-pill" data-cat="${cat.id}" onclick="filterByCategory(${cat.id}, this)">${cat.name}</button>`;
  });
  container.innerHTML = html;
}

function filterByCategory(catId, btn) {
  activeCategory = catId;
  document.querySelectorAll('#category-filter-pills .nav-pill').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFoodGrid();
}

function filterMenu() {
  renderFoodGrid();
}

// ---- Food Grid ----
function renderFoodGrid() {
  const grid = document.getElementById('food-grid');
  const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase();

  let filtered = menuItems;
  if (activeCategory !== 'all') {
    filtered = filtered.filter(item => item.category_id == activeCategory);
  }
  if (searchVal) {
    filtered = filtered.filter(item =>
      (item.name || '').toLowerCase().includes(searchVal) ||
      (item.description || '').toLowerCase().includes(searchVal) ||
      (item.category_name || '').toLowerCase().includes(searchVal)
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem 1rem;">
        <i data-lucide="search" class="icon-xl" style="color:var(--stone-300);margin:0 auto 0.75rem;display:block;width:3rem;height:3rem;"></i>
        <h3 style="font-weight:700;color:var(--stone-800);font-size:1rem;">No dishes found</h3>
        <p style="font-size:0.75rem;color:var(--stone-500);margin-top:0.25rem;">Try a different search or category</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const cartQty = getCartItemQty(item.id);
    const isTimeLimited = item.available_start_time && item.available_end_time;
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    let timeAvailable = true;
    let timeLabel = '';
    if (isTimeLimited) {
      const start = item.available_start_time.slice(0, 5);
      const end = item.available_end_time.slice(0, 5);
      timeLabel = start + ' – ' + end;
      timeAvailable = currentTime >= start && currentTime <= end;
    }

    const canAdd = item.is_available && timeAvailable && settings?.is_open_today !== false;

    html += `
    <div class="food-card" id="food-card-${item.id}">
      <div class="food-card-img">
        ${item.image_url
          ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'height:100%;display:flex;align-items:center;justify-content:center;background:var(--red-50);color:var(--color-primary);font-weight:800;font-size:1.5rem;font-family:var(--font-serif);\\'>SRM</div>'">`
          : `<div style="height:100%;display:flex;align-items:center;justify-content:center;background:var(--red-50);color:var(--color-primary);font-weight:800;font-size:1.5rem;font-family:var(--font-serif);">SRM</div>`
        }
        ${isTimeLimited ? `
          <div class="food-card-time-badge ${timeAvailable ? 'available' : 'unavailable'}">
            <i data-lucide="clock" style="width:0.625rem;height:0.625rem;display:inline;vertical-align:middle;margin-right:0.125rem;"></i>
            ${timeLabel}
          </div>` : ''}
        ${item.category_name ? `<div class="food-card-category">${item.category_name}</div>` : ''}
      </div>
      <div class="food-card-body">
        <div class="flex justify-between items-start gap-2">
          <h3 class="food-card-name">${item.name}</h3>
          <span class="food-card-price">₹${item.price}</span>
        </div>
        ${item.description ? `<p class="food-card-desc">${item.description}</p>` : ''}
      </div>
      <div class="food-card-footer">
        <span class="status-text">${!item.is_available ? 'Currently unavailable' : (!timeAvailable ? 'Outside serving hours' : 'Available now')}</span>
        ${cartQty > 0 ? `
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateCartQty(${item.id}, ${cartQty - 1})">
              <i data-lucide="minus" style="width:0.875rem;height:0.875rem;"></i>
            </button>
            <span class="qty-count">${cartQty}</span>
            <button class="qty-btn" onclick="updateCartQty(${item.id}, ${cartQty + 1})">
              <i data-lucide="plus" style="width:0.875rem;height:0.875rem;"></i>
            </button>
          </div>
        ` : `
          <button class="btn-add" ${!canAdd ? 'disabled' : ''} onclick="addToCart(${item.id})">
            <i data-lucide="plus" style="width:0.875rem;height:0.875rem;"></i>
            <span>Add</span>
          </button>
        `}
      </div>
    </div>`;
  });

  grid.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// ---- Populate Location Dropdown ----
function populateLocationDropdown() {
  const sel = document.getElementById('cart-location');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select your campus drop point...</option>';
  locations.forEach(loc => {
    sel.innerHTML += `<option value="${loc.id}">${loc.name}${loc.description ? ' — ' + loc.description : ''}</option>`;
  });
}

// ---- Utilities ----
function showEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// ---- Firebase Auth State Listener ----
document.addEventListener('DOMContentLoaded', function() {
  loadInitialData();

  // Handle require_login redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('require_login')) {
    const portal = params.get('require_login');
    openStaffModal();
    const userField = document.getElementById('staff-username');
    if (userField) {
      userField.value = portal;
    }
  }

  if (window._firebaseAuth) {
    window._firebaseAuth.onAuthStateChanged(async (fbUser) => {
      if (fbUser) {
        await syncFirebaseUser(fbUser);
      }
    });
  }
});
