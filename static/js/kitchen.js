/* ================================================================
   SRM Kitchen Command (KDS) Logic — Sidebar, Batch Tally, Timers, No OTP
   ================================================================ */

let kitchenOrders = [];
let activeKitchenTab = 'ACTIVE';
let audioEnabled = true;
let previousOrderIds = new Set();
let firstLoadDone = false;

// ---- Print state ----
// Printed order ids are remembered in this browser so a refresh never reprints.
const PRINTED_KEY = 'kds_printed_ids_v1';
const AUTO_QUEUE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // only auto-print orders newer than 12h
function loadPrintedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]').map(Number)); }
  catch (e) { return new Set(); }
}
function savePrintedIds() {
  try { localStorage.setItem(PRINTED_KEY, JSON.stringify([...printedOrderIds].slice(-800))); }
  catch (e) { /* ignore */ }
}
let printedOrderIds = loadPrintedIds();
// Orders waiting for the printer: id -> { order, copiesDone, reprint, copies }
const printQueue = new Map();
let queueRunning = false;
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

function getReceiptStamp() {
  const now = new Date();
  return now.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Shared styles for the browser-print templates (small fonts for 80mm paper)
const RECEIPT_CSS = `
  * { box-sizing: border-box; }
  @page { size: 80mm auto; margin: 0; }
  body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; }
  .receipt { width: 100%; max-width: 300px; margin: 0 auto; padding: 8px 8px; background: #fff; }
  .brand { text-align: center; font-weight: 800; font-size: 13px; letter-spacing: 0.05em; margin-bottom: 3px; }
  .sub { text-align: center; font-size: 8px; letter-spacing: 0.08em; font-weight: 700; color: #374151; margin-bottom: 7px; text-transform: uppercase; }
  .divider { border-top: 1px dashed #111827; margin: 6px 0; }
  .meta { font-size: 9px; line-height: 1.5; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { text-align: left; font-size: 8px; padding: 2px 0; border-bottom: 1px solid #111827; }
  th.r, td.r { text-align: right; white-space: nowrap; }
  td { padding: 2px 0; vertical-align: top; border-bottom: 1px dashed #d1d5db; }
  td:last-child { text-align: right; white-space: nowrap; }
  .total { font-size: 11px; font-weight: 800; margin-top: 5px; display: flex; justify-content: space-between; }
  .line { font-size: 9px; display: flex; justify-content: space-between; margin-top: 2px; }
  .footer { margin-top: 8px; text-align: center; font-size: 8px; line-height: 1.5; color: #374151; }
  @media print { html, body { width: 80mm; margin: 0; padding: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function buildKitchenReceiptHtml(order) {
  if (!order) return '';

  const itemsHtml = (order.items || []).map(item => {
    const qty = item.quantity || 1;
    const name = item.item_name || item.name || 'Item';
    const subtotal = Number(item.subtotal || 0);
    return `<tr><td>${qty}x ${name}</td><td>₹${subtotal}</td></tr>`;
  }).join('');

  return `<!doctype html>
    <html><head><meta charset="UTF-8" /><title>SRM GoodFoods Receipt</title>
      <style>${RECEIPT_CSS}</style></head>
      <body>
        <div class="receipt">
          <div class="brand">SRM GOODFOODS</div>
          <div class="sub">Kitchen Order Slip</div>
          <div class="meta">
            <div><strong>Order ID:</strong> ${order.order_number || order.id}</div>
            <div><strong>Date:</strong> ${getReceiptStamp()}</div>
            <div><strong>Location:</strong> ${order.location_name_snapshot || 'Campus'}</div>
            <div><strong>Customer:</strong> ${order.customer_name || 'Guest'}</div>
            <div><strong>Phone:</strong> ${order.customer_phone || 'N/A'}</div>
          </div>
          <div class="divider"></div>
          <table><tbody>${itemsHtml || '<tr><td>No items</td><td></td></tr>'}</tbody></table>
          <div class="divider"></div>
          <div class="total"><span>Total</span><span>₹${Number(order.total_amount || 0)}</span></div>
          <div class="footer">
            ${order.kitchen_notes ? `Note: ${order.kitchen_notes}<br>` : ''}
            Thank you<br>SRM GoodFoods
          </div>
        </div>
      </body></html>`;
}

// Customer bill (browser-print version)
function buildBillHtml(order) {
  if (!order) return '';
  let sum = 0;
  const rows = (order.items || []).map(item => {
    const qty = item.quantity || 1;
    const sub = Number(item.subtotal != null ? item.subtotal : (item.price || 0) * qty);
    const rate = Number(item.price != null ? item.price : sub / qty);
    sum += sub;
    return `<tr><td>${item.item_name || item.name || 'Item'}</td><td class="r">${qty}</td><td class="r">${rate.toFixed(2)}</td><td class="r">${sub.toFixed(2)}</td></tr>`;
  }).join('');
  const total = Number(order.total_amount || 0);
  const extra = total - sum;
  const extraHtml = Math.abs(extra) > 0.005
    ? `<div class="line"><span>Item total</span><span>₹${sum.toFixed(2)}</span></div>
       <div class="line"><span>${extra > 0 ? 'Other charges' : 'Discount'}</span><span>₹${Math.abs(extra).toFixed(2)}</span></div>` : '';
  const pay = String(order.payment_status || '').toUpperCase();

  return `<!doctype html>
    <html><head><meta charset="UTF-8" /><title>SRM GoodFoods Bill</title>
      <style>${RECEIPT_CSS}</style></head>
      <body>
        <div class="receipt">
          <div class="brand">SRM GOODFOODS</div>
          <div class="sub">Customer Bill</div>
          <div class="meta">
            <div><strong>Bill No:</strong> #${order.order_number || order.id}</div>
            <div><strong>Order date:</strong> ${parseDate(order.created_at).toLocaleString([], {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
            <div><strong>Customer:</strong> ${order.customer_name || 'Guest'}</div>
            ${order.customer_phone ? `<div><strong>Phone:</strong> ${order.customer_phone}</div>` : ''}
            <div><strong>Deliver to:</strong> ${order.location_name_snapshot || 'Campus'}</div>
          </div>
          <div class="divider"></div>
          <table>
            <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">No items</td></tr>'}</tbody>
          </table>
          <div class="divider"></div>
          ${extraHtml}
          <div class="total"><span>Total</span><span>₹${total.toFixed(2)}</span></div>
          <div class="divider"></div>
          ${pay ? `<div class="line"><span>Payment</span><span>${pay}</span></div>` : ''}
          <div class="line"><span>Printed</span><span>${getReceiptStamp()}</span></div>
          <div class="footer">Thank you! Visit again<br>SRM GoodFoods</div>
        </div>
      </body></html>`;
}

function markPrinted(orderId) {
  printedOrderIds.add(Number(orderId));
  savePrintedIds();
}

/* ------------------------- Customer bill printing ------------------------- */
// Bills are printed by hand (button on each order card). We remember which orders
// have had a bill printed, and when, in this browser.
const BILL_KEY = 'kds_bill_printed_v1';
function loadBillPrinted() {
  try { return JSON.parse(localStorage.getItem(BILL_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
let billPrinted = loadBillPrinted();   // { orderId: ISO time }
function markBillPrinted(orderId) {
  billPrinted[Number(orderId)] = new Date().toISOString();
  const ids = Object.keys(billPrinted);
  if (ids.length > 800) {   // keep the newest 800 only
    ids.sort((a, b) => billPrinted[a].localeCompare(billPrinted[b]))
       .slice(0, ids.length - 800).forEach(k => delete billPrinted[k]);
  }
  try { localStorage.setItem(BILL_KEY, JSON.stringify(billPrinted)); } catch (e) { /* ignore */ }
}

function browserPrintHtml(html, onPrinted) {
  const w = window.open('', '_blank', 'width=320,height=700');
  if (!w) { kdsToast('Popup blocked. Allow popups for this site to use browser printing.', 'error'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); if (onPrinted) onPrinted(); } catch (e) { console.warn('Print failed:', e); }
    setTimeout(() => { try { w.close(); } catch (e) {} }, 1500);
  }, 250);
}

async function printBillForOrder(orderId) {
  const order = kitchenOrders.find((o) => Number(o.id) === Number(orderId));
  if (!order) return;
  unlockAudio();
  const again = !!billPrinted[Number(orderId)];

  if (typeof thermalPrinter !== 'undefined' && thermalPrinter.isConnected) {
    kdsToast(`Printing bill for #${order.order_number}...`, 'info');
    const ok = await thermalPrinter.printBill(order, { reprint: again });
    if (ok) {
      markBillPrinted(orderId);
      kdsToast(`Bill printed for #${order.order_number}`, 'ok');
      renderKitchenOrders();
    } else {
      kdsToast(`Bill NOT printed for #${order.order_number}. ${thermalPrinter.lastError || 'Check the printer.'}`, 'error');
    }
    updatePrinterUI();
    return;
  }
  // USB printer not connected: use the browser print dialog
  kdsToast('USB printer not connected. Opening browser print.', 'error');
  browserPrintHtml(buildBillHtml(order), () => { markBillPrinted(orderId); renderKitchenOrders(); });
}

// Browser print dialog fallback (used by Reprint when the USB printer is not connected)
function printKitchenReceipt(order) {
  if (!order) return;
  try {
    const printWindow = window.open('', '_blank', 'width=320,height=700');
    if (!printWindow) {
      kdsToast('Popup blocked. Allow popups for this site to use browser printing.', 'error');
      return;
    }
    printWindow.document.write(buildKitchenReceiptHtml(order));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      try {
        printWindow.print();
        markPrinted(order.id);
        renderKitchenOrders();
      } catch (e) {
        console.warn('Print failed:', e);
      }
      setTimeout(() => { try { printWindow.close(); } catch (e) {} }, 1500);
    }, 250);
  } catch (e) {
    console.warn('Unable to print receipt:', e);
  }
}

/* ---------------------------- Toast helper ---------------------------- */
function kdsToast(msg, type) {
  let box = document.getElementById('kds-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'kds-toasts';
    box.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;max-width:22rem;';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  const bg = type === 'error' ? '#b91c1c' : type === 'ok' ? '#047857' : '#1f2937';
  t.style.cssText = `background:${bg};color:#fff;padding:.625rem .875rem;border-radius:.625rem;font-size:12px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.35);`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/* ------------------------------ Print queue ------------------------------ */

// Add an order to the queue (no-op if it is already printed, unless forced)
function enqueueOrder(order, opts = {}) {
  if (!order) return;
  const id = Number(order.id);
  if (!opts.force && printedOrderIds.has(id)) return;
  if (printQueue.has(id)) return;
  printQueue.set(id, {
    order,
    copiesDone: 0,
    reprint: !!opts.reprint,
    copies: opts.copies || undefined,
  });
}

// Print everything in the queue, oldest first. Anything that fails stays queued
// and is retried automatically (every poll / when the printer comes back).
async function processPrintQueue() {
  if (queueRunning || printQueue.size === 0) { updatePrinterUI(); return; }
  if (typeof thermalPrinter === 'undefined' || !thermalPrinter.isConnected) { updatePrinterUI(); return; }

  queueRunning = true;
  try {
    for (const [id, job] of [...printQueue.entries()]) {
      if (!thermalPrinter.isConnected) break;
      const copies = job.copies || PRINTER_CONFIG.COPIES;
      const done = await thermalPrinter.printOrder(job.order, {
        copies,
        alreadyDone: job.copiesDone,
        reprint: job.reprint,
      });
      job.copiesDone = done;
      if (done >= copies) {
        printQueue.delete(id);
        markPrinted(id);
        renderKitchenOrders();
      } else {
        break; // printer problem: keep the rest queued and retry later
      }
    }
  } finally {
    queueRunning = false;
    updatePrinterUI();
  }
}

/* --------------------------- Printer connection --------------------------- */

async function connectThermalPrinter(showAll) {
  unlockAudio();
  if (typeof thermalPrinter === 'undefined' || !thermalPrinter.isSupported()) {
    kdsToast('USB printing needs Chrome or Edge on a computer (https or localhost).', 'error');
    return false;
  }
  const ok = await thermalPrinter.requestDevice(!!showAll);
  if (ok) {
    kdsToast('Printer connected: ' + thermalPrinter.deviceName, 'ok');
    processPrintQueue();
  } else if (thermalPrinter.lastError) {
    kdsToast(thermalPrinter.lastError, 'error');
  }
  updatePrinterUI();
  return ok;
}

async function reconnectPrinter() {
  unlockAudio();
  let ok = await thermalPrinter.restore();
  if (!ok) ok = await thermalPrinter.requestDevice(false);
  if (ok) { kdsToast('Printer connected', 'ok'); processPrintQueue(); }
  else if (thermalPrinter.lastError) kdsToast(thermalPrinter.lastError, 'error');
  updatePrinterUI();
}

async function testPrintClick() {
  if (!thermalPrinter.isConnected) { kdsToast('Connect the printer first.', 'error'); return; }
  const ok = await thermalPrinter.printTest();
  kdsToast(ok ? 'Test slip sent to printer' : ('Test print failed. ' + (thermalPrinter.lastError || '')), ok ? 'ok' : 'error');
}

function clearPrintQueue() {
  if (printQueue.size === 0) return;
  if (!confirm(`Remove ${printQueue.size} waiting ticket(s) from the print queue? They will be marked as printed and will not print automatically.`)) return;
  printQueue.forEach((job, id) => printedOrderIds.add(id));
  savePrintedIds();
  printQueue.clear();
  renderKitchenOrders();
  updatePrinterUI();
}

// Reprint button on each card
async function reprintOrder(orderId) {
  const order = kitchenOrders.find((o) => Number(o.id) === Number(orderId));
  if (!order) return;
  unlockAudio();

  if (printQueue.has(Number(orderId))) {
    kdsToast(`#${order.order_number} is already waiting in the print queue.`, 'info');
    processPrintQueue();
    return;
  }

  if (typeof thermalPrinter !== 'undefined' && thermalPrinter.isConnected) {
    enqueueOrder(order, { force: true, reprint: true, copies: 1 });
    kdsToast(`Reprinting #${order.order_number}...`, 'info');
    processPrintQueue();
    return;
  }
  // Printer not connected: offer the browser print dialog instead
  kdsToast('USB printer not connected. Opening browser print.', 'error');
  printKitchenReceipt(order);
}

/* ----------------------------- Status button ----------------------------- */

function getPrinterState() {
  const waiting = printQueue.size;
  if (typeof thermalPrinter === 'undefined' || !thermalPrinter.isSupported()) {
    return { key: 'unsupported', color: '#9ca3af', label: 'USB printing unavailable', waiting };
  }
  if (!thermalPrinter.isConnected) {
    return { key: 'off', color: '#ef4444', label: 'Printer not connected', waiting };
  }
  if (thermalPrinter.busy) return { key: 'busy', color: '#3b82f6', label: 'Printing...', waiting };
  const st = thermalPrinter.lastStatus;
  if (st && st.paperOut) return { key: 'warn', color: '#f59e0b', label: 'Printer: paper out', waiting };
  if (st && st.coverOpen) return { key: 'warn', color: '#f59e0b', label: 'Printer: cover open', waiting };
  if (st && st.offline) return { key: 'warn', color: '#f59e0b', label: 'Printer offline', waiting };
  if (waiting > 0 && thermalPrinter.lastError) return { key: 'error', color: '#ef4444', label: 'Print failed, retrying', waiting };
  return { key: 'ok', color: '#10b981', label: 'Printer connected', waiting };
}

function updatePrinterUI() {
  const pill = document.getElementById('prn-pill');
  if (!pill) return;
  const st = getPrinterState();
  const dot = document.getElementById('prn-dot');
  const label = document.getElementById('prn-label');
  const count = document.getElementById('prn-count');
  if (dot) { dot.style.background = st.color; dot.classList.toggle('prn-pulse', st.key === 'ok' || st.key === 'busy'); }
  if (label) label.textContent = st.label;
  if (count) {
    count.style.display = st.waiting > 0 ? 'inline-flex' : 'none';
    count.textContent = st.waiting + ' waiting';
  }

  const detail = document.getElementById('prn-detail');
  if (!detail) return;
  const p = typeof thermalPrinter !== 'undefined' ? thermalPrinter : null;
  const row = (k, v) => `<div class="prn-row"><span>${k}</span><strong>${v}</strong></div>`;
  let html = '';
  if (!p || !p.isSupported()) {
    html += `<p class="prn-note">This browser cannot talk to USB printers. Open the kitchen portal in <b>Chrome</b> or <b>Edge</b> on the computer the printer is plugged into (https or localhost).</p>`;
  } else {
    html += row('Connection', p.isConnected ? '<span style="color:#10b981">Connected</span>' : '<span style="color:#ef4444">Not connected</span>');
    if (p.device) html += row('Device', p.deviceName);
    if (p.isConnected) {
      if (p.lastStatus) {
        const s = p.lastStatus;
        html += row('Paper', s.paperOut ? '<span style="color:#f59e0b">Out</span>' : s.paperNear ? '<span style="color:#f59e0b">Running low</span>' : 'OK');
        html += row('Cover', s.coverOpen ? '<span style="color:#f59e0b">Open</span>' : 'Closed');
        html += row('Last check', new Date(s.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } else {
        html += `<p class="prn-note">Connected. This printer does not report paper/cover status.</p>`;
      }
    }
    if (p.lastError) html += `<p class="prn-note prn-err">${p.lastError}</p>`;
  }

  html += row('Waiting to print', printQueue.size);
  if (printQueue.size) {
    const nums = [...printQueue.values()].map((j) => '#' + (j.order.order_number || j.order.id)).slice(0, 12).join(', ');
    html += `<p class="prn-note">${nums}${printQueue.size > 12 ? ' ...' : ''}</p>`;
  }

  html += '<div class="prn-actions">';
  if (p && p.isSupported()) {
    html += p.isConnected
      ? `<button class="prn-btn" onclick="testPrintClick()">Print test slip</button>`
      : `<button class="prn-btn prn-primary" onclick="connectThermalPrinter()">Connect printer</button>`;
    if (p.isConnected) html += `<button class="prn-btn" onclick="reconnectPrinter()">Reconnect</button>`;
    if (printQueue.size && p.isConnected) html += `<button class="prn-btn prn-primary" onclick="processPrintQueue()">Print waiting now</button>`;
    if (printQueue.size) html += `<button class="prn-btn" onclick="clearPrintQueue()">Clear queue</button>`;
    if (!p.isConnected) html += `<button class="prn-btn" onclick="connectThermalPrinter(true)" title="Show every USB device in the list">Printer not listed?</button>`;
  }
  html += '</div>';
  detail.innerHTML = html;
}

function togglePrinterPanel(force) {
  const panel = document.getElementById('prn-panel');
  if (!panel) return;
  const show = typeof force === 'boolean' ? force : panel.style.display !== 'block';
  panel.style.display = show ? 'block' : 'none';
  if (show) updatePrinterUI();
}

async function printerHealthTick() {
  if (typeof thermalPrinter === 'undefined' || !thermalPrinter.isSupported()) return;
  await thermalPrinter.checkHealth();
  updatePrinterUI();
  if (thermalPrinter.isConnected && printQueue.size) processPrintQueue();
}

/* ------------------------------ Order sound ------------------------------ */
// One shared AudioContext. Browsers keep audio locked until the page gets a
// click/tap/key press, so we unlock it on the first interaction.
let kdsAudioCtx = null;
function getAudioCtx() {
  if (!kdsAudioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) kdsAudioCtx = new C();
  }
  return kdsAudioCtx;
}

function updateAudioLabel() {
  const txt = document.getElementById('audio-text');
  const icon = document.getElementById('audio-icon');
  if (!txt) return;
  const locked = audioEnabled && (!kdsAudioCtx || kdsAudioCtx.state !== 'running');
  txt.textContent = audioEnabled ? (locked ? 'Alert: click page to arm' : 'Alert: ON') : 'Alert: OFF';
  if (icon) icon.setAttribute('data-lucide', audioEnabled ? 'volume-2' : 'volume-x');
  if (window.lucide) lucide.createIcons();
}

function unlockAudio() {
  const c = getAudioCtx();
  if (c && c.state === 'suspended') {
    c.resume().then(updateAudioLabel).catch(() => {});
  }
  updateAudioLabel();
}

function beep(c, freq, start, dur, vol) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

// New order alert: three two-tone chimes (about 2.5 seconds)
function playOrderAlert(force) {
  if (!audioEnabled && !force) return;
  try {
    const c = getAudioCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t0 = c.currentTime + 0.05;
    [0, 0.85, 1.7].forEach((off) => {
      beep(c, 880, t0 + off, 0.3, 0.6);
      beep(c, 1318.5, t0 + off + 0.3, 0.45, 0.6);
    });
  } catch (e) {
    // audio still locked: it unlocks on the first click on the page
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
  unlockAudio();
  if (audioEnabled) playOrderAlert(true); // short preview so you can hear it works
  updateAudioLabel();
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
  firstLoadDone = false; // a different date range is not a "new order"
  loadKitchenOrders();
}

function applyCustomDateRange() {
  customStartDate = document.getElementById('filter-start-date').value;
  customEndDate = document.getElementById('filter-end-date').value;
  firstLoadDone = false;
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

    // Brand new incoming orders: sound + toast (not on the very first load)
    const brandNew = orders.filter(o => o.status === 'CONFIRMED' && !previousOrderIds.has(o.id));
    if (firstLoadDone && brandNew.length > 0) {
      playOrderAlert();
      kdsToast(brandNew.length === 1
        ? `New order #${brandNew[0].order_number}`
        : `${brandNew.length} new orders`, 'ok');
    }
    firstLoadDone = true;

    // Print queue: every unprinted CONFIRMED order waits here until it really prints
    const nowMs = Date.now();
    orders.forEach(o => {
      if (o.status === 'CONFIRMED' && !printedOrderIds.has(Number(o.id)) &&
          (nowMs - parseDate(o.created_at).getTime()) < AUTO_QUEUE_MAX_AGE_MS) {
        enqueueOrder(o);
      }
      // drop queued tickets whose order was cancelled/closed before printing
      if ((o.status === 'CANCELLED' || o.status === 'CLOSED') && printQueue.has(Number(o.id))) {
        printQueue.delete(Number(o.id));
      }
    });
    processPrintQueue();

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
      <div style="text-align:center;padding:5rem 0;background:var(--kds-card-bg);border-radius:var(--radius-3xl);border:1px solid var(--kds-border);padding:3rem 1.5rem;">
        <i data-lucide="utensils-crossed" style="width:3rem;height:3rem;color:var(--kds-text-secondary);margin:0 auto 0.75rem;display:block;"></i>
        <h3 style="font-weight:700;font-size:1.125rem;color:var(--kds-text-primary);">No orders found in this view</h3>
        <p style="font-size:0.75rem;color:var(--kds-text-secondary);margin-top:0.375rem;max-width:24rem;margin-left:auto;margin-right:auto;">
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
    const isPrinted = printedOrderIds.has(Number(order.id)) || order.printed === true || order.ticket_printed === true;

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
        <div class="flex items-center justify-between" style="padding-bottom:0.75rem;border-bottom:1px solid var(--kds-border);margin-bottom:0.75rem;position:relative;">
          <div>
            <span style="font-size:10px;font-weight:800;color:var(--kds-text-secondary);text-transform:uppercase;letter-spacing:0.08em;">Order Number</span>
            <div class="flex items-center gap-2">
              <h3 style="font-size:1.125rem;font-family:var(--font-mono);font-weight:900;color:var(--kds-text-primary);">#${order.order_number}</h3>
              <button class="reprint-btn" onclick="reprintOrder(${order.id})" title="Reprint ticket">
                <i data-lucide="printer" style="width:0.75rem;height:0.75rem;"></i>
              </button>
            </div>
          </div>
          <div style="text-align:right;position:relative;">
            <span class="badge ${statusBadge}">${order.status}</span>
            <span style="display:block;font-size:10px;color:var(--kds-text-secondary);margin-top:0.125rem;">
              ${createdTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
            </span>
            <div style="margin-top:0.25rem;">
              <span class="kds-timer ${timerClass}">
                <i data-lucide="clock" style="width:0.75rem;height:0.75rem;"></i>
                <span>${elapsedMins}m ago</span>
              </span>
            </div>
            <div style="position:absolute;top:-8px;right:-8px;width:1.5rem;height:1.5rem;background:${isPrinted ? '#10b981' : '#ef4444'};border:2px solid var(--kds-card-bg);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.2);" title="${isPrinted ? 'Ticket Printed ✓' : (printQueue.has(Number(order.id)) ? 'Waiting in print queue' : 'Not Printed Yet')}">
              ${isPrinted ? '✓' : '✕'}
            </div>
          </div>
        </div>

        <!-- Campus Drop Spot & Customer -->
        <div style="background:var(--kds-card-inner);padding:0.75rem;border-radius:var(--radius-xl);border:1px solid var(--kds-border);margin-bottom:0.75rem;">
          <div class="flex items-center justify-between" style="font-size:12px;margin-bottom:0.25rem;">
            <div class="flex items-center gap-1.5" style="color:var(--kds-gold);font-weight:700;">
              <i data-lucide="map-pin" style="width:0.875rem;height:0.875rem;flex-shrink:0;"></i>
              <span>${order.location_name_snapshot || 'Campus Location'}</span>
            </div>
            <span style="color:var(--kds-text-secondary);font-size:11px;">₹${order.total_amount}</span>
          </div>
          <div class="flex items-center justify-between" style="font-size:11px;color:var(--kds-text-secondary);">
            <span>Customer: <strong style="color:var(--kds-text-primary);">${order.customer_name || 'Customer'}</strong></span>
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
          <span style="font-size:10px;font-weight:800;color:var(--kds-text-secondary);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:0.375rem;">Dishes to Prepare:</span>
          <div class="space-y-1.5">
            ${(order.items || []).map(item => `
              <div class="flex items-center justify-between" style="background:var(--kds-card-inner);padding:0.5rem 0.75rem;border-radius:var(--radius-lg);border:1px solid var(--kds-border);font-size:12px;">
                <div class="flex items-center gap-2">
                  <span style="background:#d97706;color:#fff;font-weight:900;font-size:12px;padding:0.125rem 0.5rem;border-radius:var(--radius-md);font-family:var(--font-mono);">${item.quantity}x</span>
                  <span style="font-weight:700;color:var(--kds-text-primary);">${item.item_name || item.name}</span>
                </div>
                <span style="color:var(--kds-text-secondary);font-size:11px;">₹${item.subtotal}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="padding-top:0.75rem;border-top:1px solid var(--kds-border);">
        ${order.status !== 'CANCELLED' ? `
          <div class="bill-row">
            <span class="bill-chip ${billPrinted[Number(order.id)] ? 'done' : 'pending'}" title="${billPrinted[Number(order.id)] ? 'Customer bill has been printed' : 'Customer bill not printed yet'}">
              ${billPrinted[Number(order.id)]
                ? '✓ Bill printed ' + new Date(billPrinted[Number(order.id)]).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
                : '✕ Bill not printed'}
            </span>
            <button class="bill-btn" onclick="printBillForOrder(${order.id})" title="Print customer bill">
              <i data-lucide="receipt" style="width:0.75rem;height:0.75rem;"></i>
              <span>${billPrinted[Number(order.id)] ? 'Reprint Bill' : 'Print Bill'}</span>
            </button>
          </div>
        ` : ''}
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
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:#38bdf8;background:rgba(14,165,233,0.15);border-radius:var(--radius-xl);border:1px solid rgba(14,165,233,0.3);">
            <i data-lucide="bike" style="width:0.875rem;height:0.875rem;"></i>
            <span>Dispatched • Rider Handover in Progress</span>
          </div>
        ` : ''}

        ${isUnpicked ? `
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="text-align:center;padding:0.375rem 0.5rem;font-size:11px;font-weight:700;color:#fca5a5;background:rgba(185,28,28,0.2);border-radius:var(--radius-lg);border:1px solid rgba(185,28,28,0.3);">
              <span>⚠️ Customer Unreachable / No-Show</span>
            </div>
            <button class="btn btn-block" style="background:#b91c1c;color:#fff;font-weight:800;font-size:12px;padding:0.5rem;" ${disabled} onclick="if(confirm('Close and archive this unpicked ticket?')) updateKitchenStatus(${order.id}, 'CLOSED')">
              <i data-lucide="archive" style="width:0.875rem;height:0.875rem;"></i>
              <span>Close Order Ticket</span>
            </button>
          </div>
        ` : ''}

        ${isDelivered ? `
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:#34d399;background:rgba(6,95,70,0.3);border-radius:var(--radius-xl);border:1px solid rgba(6,95,70,0.5);">
            <i data-lucide="check-circle-2" style="width:0.875rem;height:0.875rem;"></i>
            <span>Delivered & Handed Over</span>
          </div>
        ` : ''}

        ${isClosed ? `
          <div style="text-align:center;padding:0.5rem;font-size:11px;font-weight:700;color:var(--kds-text-secondary);background:rgba(41,37,36,0.5);border-radius:var(--radius-xl);border:1px solid var(--kds-border);">
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
document.addEventListener('DOMContentLoaded', async function() {
  const savedTheme = localStorage.getItem('kds_theme') || 'dark';
  updateThemeUI(savedTheme);

  // Browsers keep sound locked until the first click/tap/key press
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, unlockAudio, { passive: true }));
  updateAudioLabel();

  // Close the printer panel when clicking elsewhere
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('prn-wrap');
    if (wrap && !wrap.contains(e.target)) togglePrinterPanel(false);
  });

  if (typeof thermalPrinter !== 'undefined') {
    thermalPrinter.onChange = () => {
      updatePrinterUI();
      if (thermalPrinter.isConnected && !thermalPrinter.busy && printQueue.size) processPrintQueue();
    };
    // Silent reconnect to a printer that was allowed before (no click needed)
    await thermalPrinter.restore();
  }
  updatePrinterUI();

  applyDatePreset('TODAY');
  // Auto refresh live feed every 6 seconds
  setInterval(loadKitchenOrders, 6000);
  // Printer health check (alive / paper / cover) every 15 seconds
  setInterval(printerHealthTick, 15000);
});
