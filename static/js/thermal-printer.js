/**
 * Thermal Printer Manager - WebUSB + ESC/POS
 *
 * - Connect once with a click (browser rule); afterwards the printer is
 *   re-attached silently on every page load and when it is re-plugged.
 * - Finds the bulk OUT endpoint by itself (no hardcoded interface/endpoint).
 * - Health check: tracks connection and, when the printer answers, paper/cover/offline.
 * - printOrder() returns how many copies were really sent, so the caller can
 *   keep an order in the queue until it has truly printed.
 */

const PRINTER_CONFIG = {
  PAPER_COLS: 42,          // characters per line. 80mm paper: 42-48, 58mm paper: 32
  COPIES: 2,               // copies per new order
  BRAND: 'SRM GOODFOODS',
  STORAGE_KEY: 'kds_printer_id',
};

class ThermalPrinterManager {
  constructor() {
    this.device = null;
    this.outEp = null;
    this.inEp = null;
    this.ifaceNum = null;
    this.isConnected = false;
    this.busy = false;
    this.lastError = '';
    this.lastStatus = null;      // { offline, coverOpen, paperOut, paperNear, checkedAt }
    this.statusSupported = true; // set to false if the printer never answers status queries
    this.onChange = null;

    if (this.isSupported()) {
      navigator.usb.addEventListener('connect', () => this.restore());
      navigator.usb.addEventListener('disconnect', (e) => {
        if (this.device && e.device === this.device) {
          this.isConnected = false;
          this.lastError = 'Printer was unplugged';
          this._notify();
        }
      });
    }
  }

  isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb;
  }

  _notify() {
    if (typeof this.onChange === 'function') {
      try { this.onChange(); } catch (e) { console.error(e); }
    }
  }

  get deviceName() {
    if (!this.device) return '';
    return this.device.productName ||
      `USB ${this.device.vendorId.toString(16)}:${this.device.productId.toString(16)}`;
  }

  /* ------------------------------ connecting ------------------------------ */

  // Find the bulk OUT (and bulk IN) endpoint, preferring the printer-class (7) interface
  _findEndpoints(dev) {
    const cfg = dev.configuration || (dev.configurations && dev.configurations[0]);
    if (!cfg) return null;
    let best = null;
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        const out = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
        if (!out) continue;
        const inn = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
        const cand = {
          iface: iface.interfaceNumber,
          alt: alt.alternateSetting,
          out: out.endpointNumber,
          in: inn ? inn.endpointNumber : null,
          isPrinterClass: alt.interfaceClass === 7,
        };
        if (!best || (cand.isPrinterClass && !best.isPrinterClass)) best = cand;
      }
    }
    return best;
  }

  _looksLikePrinter(dev) {
    const cfg = dev.configuration || (dev.configurations && dev.configurations[0]);
    if (!cfg) return false;
    return cfg.interfaces.some((i) => i.alternates.some((a) => a.interfaceClass === 7));
  }

  async _attach(dev) {
    try {
      if (!dev.opened) await dev.open();
      if (dev.configuration === null) await dev.selectConfiguration(1);

      const ep = this._findEndpoints(dev);
      if (!ep) throw new Error('No print endpoint found on this USB device (is it really the printer?)');

      await dev.claimInterface(ep.iface);
      if (ep.alt) await dev.selectAlternateInterface(ep.iface, ep.alt);

      this.device = dev;
      this.ifaceNum = ep.iface;
      this.outEp = ep.out;
      this.inEp = ep.in;
      this.isConnected = true;
      this.lastError = '';
      try {
        localStorage.setItem(PRINTER_CONFIG.STORAGE_KEY,
          JSON.stringify({ v: dev.vendorId, p: dev.productId }));
      } catch (e) { /* ignore */ }
      this._notify();
      return true;
    } catch (err) {
      this.isConnected = false;
      const msg = String((err && err.message) || err);
      this.lastError = /access denied|claimInterface|busy/i.test(msg)
        ? 'Windows driver is blocking the printer. Install the WinUSB driver (Zadig) and close other apps using it.'
        : msg;
      console.error('Printer attach failed:', err);
      this._notify();
      return false;
    }
  }

  /** Silent reconnect to an already-permitted printer. No click needed. */
  async restore() {
    if (!this.isSupported()) return false;
    if (this.isConnected && this.device && this.device.opened) return true;
    try {
      const devices = await navigator.usb.getDevices();
      if (!devices.length) return false;

      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(PRINTER_CONFIG.STORAGE_KEY) || 'null'); } catch (e) {}

      const pick =
        (saved && devices.find((d) => d.vendorId === saved.v && d.productId === saved.p)) ||
        devices.find((d) => this._looksLikePrinter(d)) ||
        null;
      if (!pick) return false;
      return await this._attach(pick);
    } catch (err) {
      console.error('Printer restore failed:', err);
      return false;
    }
  }

  /** Must be called from a click handler. */
  async requestDevice(showAll = false) {
    if (!this.isSupported()) return false;
    try {
      const filters = showAll ? [] : [
        { classCode: 7 },            // any USB printer
        { vendorId: 0x0471 },        // Gprinter GP-C80250 (Philips-registered ID)
        { vendorId: 0x0483 }, { vendorId: 0x04b4 }, { vendorId: 0x067b },
        { vendorId: 0x10a5 }, { vendorId: 0x05e0 }, { vendorId: 0x0bca },
        { vendorId: 0x1504 }, { vendorId: 0x0416 }, { vendorId: 0x0fe6 },
        { vendorId: 0x1fc9 }, { vendorId: 0x28e9 }, { vendorId: 0x0456 },
      ];
      const dev = await navigator.usb.requestDevice({ filters });
      if (this.device && this.device !== dev && this.device.opened) {
        try { await this.device.close(); } catch (e) {}
      }
      return await this._attach(dev);
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        this.lastError = 'No printer was selected';
      } else {
        this.lastError = String((err && err.message) || err);
      }
      this._notify();
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.device && this.device.opened) {
        try { await this.device.releaseInterface(this.ifaceNum); } catch (e) {}
        await this.device.close();
      }
    } catch (e) { /* ignore */ }
    this.isConnected = false;
    this._notify();
  }

  /* --------------------------------- health -------------------------------- */

  _withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((res) => setTimeout(() => res(null), ms))]);
  }

  async _realtimeStatus(n) {
    await this.device.transferOut(this.outEp, Uint8Array.of(0x10, 0x04, n)); // DLE EOT n
    const res = await this._withTimeout(this.device.transferIn(this.inEp, 8), 1200);
    if (!res || res.status !== 'ok' || !res.data || !res.data.byteLength) return null;
    return res.data.getUint8(0);
  }

  /** Is the printer still there, and (if it answers) is it ready? */
  async checkHealth() {
    if (!this.isSupported()) return false;

    // Connection check
    if (this.device && !this.device.opened) this.isConnected = false;
    if (!this.isConnected) {
      const ok = await this.restore();
      if (!ok) { this._notify(); return false; }
    }
    if (this.busy) return true;

    // Status query (only if the printer has an IN endpoint and has answered before)
    if (this.inEp !== null && this.statusSupported) {
      try {
        const st = await this._realtimeStatus(1);
        if (st === null) {
          this.statusSupported = false;   // printer does not answer: don't ask again
          this.lastStatus = null;
        } else {
          const paper = await this._realtimeStatus(4);
          const cover = await this._realtimeStatus(2);
          this.lastStatus = {
            offline: !!(st & 0x08),
            coverOpen: cover !== null && !!(cover & 0x04),
            paperOut: paper !== null && !!(paper & 0x60),
            paperNear: paper !== null && !!(paper & 0x0c),
            checkedAt: Date.now(),
          };
        }
      } catch (err) {
        // Cannot talk to it at all -> treat as disconnected
        this.isConnected = false;
        this.lastError = 'Lost connection to the printer';
      }
    }
    this._notify();
    return this.isConnected;
  }

  /* -------------------------------- printing ------------------------------- */

  async _write(bytes) {
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const res = await this.device.transferOut(this.outEp, bytes.slice(i, i + CHUNK));
      if (res.status !== 'ok') throw new Error('USB transfer status: ' + res.status);
    }
  }

  /**
   * Print `copies` copies (starting after `alreadyDone`).
   * Returns the total number of copies that are now printed.
   */
  async printOrder(order, opts = {}) {
    const copies = opts.copies || PRINTER_CONFIG.COPIES;
    let done = opts.alreadyDone || 0;
    if (!this.isConnected || !this.device) return done;

    this.busy = true;
    this._notify();
    try {
      while (done < copies) {
        const bytes = this.buildReceipt(order, { copy: done + 1, copies, reprint: !!opts.reprint });
        await this._write(bytes);
        done++;
      }
      this.lastError = '';
    } catch (err) {
      console.error('Print failed:', err);
      this.lastError = String((err && err.message) || err);
      if (!this.device || !this.device.opened) this.isConnected = false;
    } finally {
      this.busy = false;
      this._notify();
    }
    return done;
  }

  async printTest() {
    if (!this.isConnected) return false;
    const order = {
      order_number: 'TEST-' + Math.floor(Math.random() * 900 + 100),
      customer_name: 'Printer Test',
      customer_phone: '-',
      location_name_snapshot: 'Kitchen',
      total_amount: 280,
      items: [
        { quantity: 1, item_name: 'Veg Biryani', subtotal: 120 },
        { quantity: 2, item_name: 'Paneer Roll', subtotal: 160 },
      ],
      kitchen_notes: 'If you can read this, the printer works.',
    };
    const n = await this.printOrder(order, { copies: 1 });
    return n >= 1;
  }

  /* -------------------------------- receipt -------------------------------- */

  _ascii(s) {
    return String(s == null ? '' : s)
      .replace(/₹/g, 'Rs.')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[^\x20-\x7E]/g, '?');
  }

  _line(left, right) {
    const cols = PRINTER_CONFIG.PAPER_COLS;
    left = this._ascii(left);
    right = this._ascii(right || '');
    const room = cols - right.length - 1;
    if (left.length > room) left = left.slice(0, Math.max(room, 1));
    return left + ' '.repeat(Math.max(cols - left.length - right.length, 1)) + right + '\n';
  }

  _wrap(text, width) {
    const words = this._ascii(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines;
  }

  getTimeStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  buildReceipt(order, { copy = 1, copies = 1, reprint = false } = {}) {
    const cols = PRINTER_CONFIG.PAPER_COLS;
    const dash = '-'.repeat(cols) + '\n';
    const ESC = '\x1B', GS = '\x1D';
    let r = '';

    r += ESC + '@';                       // reset
    r += ESC + 'a\x01';                   // center
    r += GS + '!\x11' + ESC + 'E\x01';    // double size + bold
    r += PRINTER_CONFIG.BRAND + '\n';
    r += GS + '!\x00' + ESC + 'E\x00';
    r += 'Kitchen Order Slip\n';
    if (reprint) r += ESC + 'E\x01' + '*** REPRINT ***\n' + ESC + 'E\x00';
    r += '\n';

    r += ESC + 'a\x00';                   // left
    r += dash;
    r += this._line('ORDER ID', '#' + (order.order_number || order.id));
    r += this._line('TIME', this.getTimeStamp());
    r += this._line('LOCATION', order.location_name_snapshot || 'Campus');
    r += this._line('CUSTOMER', order.customer_name || 'Guest');
    r += this._line('PHONE', order.customer_phone || 'N/A');
    r += dash;
    r += 'DISHES TO PREPARE:\n';
    r += dash;

    (order.items || []).forEach((item) => {
      const qty = item.quantity || 1;
      const name = item.item_name || item.name || 'Item';
      const price = 'Rs.' + Number(item.subtotal || 0).toFixed(2);
      r += ESC + 'E\x01';
      r += this._line(`${qty}x ${name}`, price);
      r += ESC + 'E\x00';
    });

    r += dash;
    r += ESC + 'a\x02';                   // right align total
    r += GS + '!\x11' + ESC + 'E\x01';
    r += 'TOTAL: Rs.' + Number(order.total_amount || 0).toFixed(2) + '\n';
    r += GS + '!\x00' + ESC + 'E\x00';
    r += ESC + 'a\x00';

    if (order.kitchen_notes) {
      r += '\n' + dash + 'SPECIAL NOTES:\n';
      this._wrap(order.kitchen_notes, cols).forEach((l) => { r += l + '\n'; });
      r += dash;
    }

    r += '\n' + ESC + 'a\x01';
    r += 'Thank you!\n';
    r += `Copy ${copy} of ${copies}\n`;
    r += '\n\n\n\n';
    r += GS + 'V\x42\x00';                // partial cut

    // string -> bytes (everything is ASCII by now)
    const bytes = new Uint8Array(r.length);
    for (let i = 0; i < r.length; i++) bytes[i] = r.charCodeAt(i) & 0xff;
    return bytes;
  }
}

// Global instance
const thermalPrinter = new ThermalPrinterManager();
