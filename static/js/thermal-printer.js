/**
 * Thermal Printer Integration - Direct USB Printer Connection
 * ESC/POS Protocol for 80mm Thermal Receipt Printers
 * Prints 2 copies per order
 */

class ThermalPrinterManager {
  constructor() {
    this.device = null;
    this.isConnected = false;
    this.printedOrders = new Set();
    this.printQueue = [];
    this.isPrinting = false;
  }

  /**
   * Request USB device access from the browser
   */
  async requestDevice() {
    try {
      const devices = await navigator.usb.getDevices();
      if (devices.length > 0) {
        this.device = devices[0];
        await this.connectDevice();
        return true;
      }

      const device = await navigator.usb.requestDevice({
        filters: [
          { vendorId: 0x0483 }, // STMicroelectronics
          { vendorId: 0x04b4 }, // Cypress
          { vendorId: 0x067b }, // Prolific
          { vendorId: 0x10a5 }, // Applied Micro
          { vendorId: 0x05e0 }, // Symbol
          { vendorId: 0x0bca }, // XPrinter
          { vendorId: 0x1504 }, // AirPrint
        ],
      });

      this.device = device;
      await this.connectDevice();
      return true;
    } catch (err) {
      console.error('USB Device Request Failed:', err);
      return false;
    }
  }

  /**
   * Connect to the USB device
   */
  async connectDevice() {
    if (!this.device) return false;
    try {
      await this.device.open();
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      await this.device.claimInterface(0);
      this.isConnected = true;
      console.log('Printer connected:', this.device.productName);
      return true;
    } catch (err) {
      console.error('Connection error:', err);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Send raw ESC/POS commands to printer
   */
  async sendCommand(data) {
    if (!this.isConnected || !this.device) {
      console.warn('Printer not connected');
      return false;
    }

    try {
      const endpointNumber = this.device.configurations[0].interfaces[0]
        .alternates[0].endpoints[0].endpointNumber;
      const direction = this.device.configurations[0].interfaces[0]
        .alternates[0].endpoints[0].direction;

      await this.device.transferOut(endpointNumber, data);
      return true;
    } catch (err) {
      console.error('Print command error:', err);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Convert string to Uint8Array
   */
  stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    return new Uint8Array(bytes);
  }

  /**
   * Build ESC/POS receipt for thermal printer
   */
  buildEscPosReceipt(order) {
    let receipt = '';

    // Initialize printer
    receipt += '\x1B\x40'; // ESC @ - Reset printer

    // Set alignment to center
    receipt += '\x1B\x61\x01'; // ESC a 1 - Center align

    // Brand name - bold and large
    receipt += '\x1B\x21\x30'; // ESC ! 0 - Normal size
    receipt += '\x1D\x21\x11'; // GS ! - Set character size (1x height, 1x width)
    receipt += '===============\n';
    receipt += '\x1D\x21\x11';
    receipt += 'SRM GOODFOODS\n';
    receipt += '===============\n';
    receipt += '\x1B\x21\x00'; // Normal size
    receipt += 'Kitchen Order Slip\n\n';

    // Set alignment to left
    receipt += '\x1B\x61\x00'; // ESC a 0 - Left align

    // Order details
    receipt += '--------------------------------\n';
    receipt += 'ORDER ID    : ' + (order.order_number || order.id) + '\n';
    receipt += 'DATE/TIME   : ' + this.getTimeStamp() + '\n';
    receipt += 'LOCATION    : ' + (order.location_name_snapshot || 'Campus') + '\n';
    receipt += 'CUSTOMER    : ' + (order.customer_name || 'Guest') + '\n';
    receipt += 'PHONE       : ' + (order.customer_phone || 'N/A') + '\n';
    receipt += '--------------------------------\n\n';

    // Items
    receipt += 'DISHES TO PREPARE:\n';
    receipt += '--------------------------------\n';
    (order.items || []).forEach((item) => {
      const qty = item.quantity || 1;
      const name = (item.item_name || item.name || 'Item').substring(0, 30);
      const price = Number(item.subtotal || 0).toFixed(2);
      receipt += `${qty}x ${name}\n`;
      receipt += `                      Rs.${price}\n`;
    });

    receipt += '--------------------------------\n\n';

    // Total
    receipt += '\x1D\x21\x11'; // GS ! - Larger font for total
    const total = Number(order.total_amount || 0).toFixed(2);
    receipt += `TOTAL: Rs.${total}\n`;
    receipt += '\x1B\x21\x00'; // Normal size

    // Special notes
    if (order.kitchen_notes) {
      receipt += '\n--------------------------------\n';
      receipt += 'SPECIAL NOTES:\n';
      receipt += order.kitchen_notes.substring(0, 40) + '\n';
      receipt += '--------------------------------\n';
    }

    receipt += '\n';

    // Center footer
    receipt += '\x1B\x61\x01'; // ESC a 1 - Center align
    receipt += 'Thank you!\n';
    receipt += 'SRM GoodFoods Kitchen\n';
    receipt += '\n\n';

    // Barcode (Order ID) - optional
    receipt += '\x1D\x68\x32'; // GS h - Set barcode height
    receipt += '\x1D\x67\x65'; // GS g - Print barcode (CODE128)
    receipt += '\x1D\x6B\x49'; // GS k I - Barcode type 128
    receipt += order.order_number || order.id;

    receipt += '\n\n';
    receipt += '\x1B\x61\x01'; // Center
    receipt += 'Copy 1 of 2\n';

    // Cut paper
    receipt += '\x1D\x56\x42'; // GS V B - Partial cut
    receipt += '\n';

    return receipt;
  }

  /**
   * Get timestamp for receipt
   */
  getTimeStamp() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }

  /**
   * Print order - 2 copies
   */
  async printOrder(order) {
    if (!order) return false;

    if (this.printedOrders.has(order.id)) {
      console.warn(`Order ${order.id} already printed`);
      return false;
    }

    this.printQueue.push(order);

    if (!this.isPrinting) {
      await this.processPrintQueue();
    }

    return true;
  }

  /**
   * Process print queue
   */
  async processPrintQueue() {
    if (this.isPrinting || this.printQueue.length === 0) {
      return;
    }

    this.isPrinting = true;

    while (this.printQueue.length > 0) {
      const order = this.printQueue.shift();

      // Print 2 copies
      for (let copy = 1; copy <= 2; copy++) {
        try {
          let receipt = this.buildEscPosReceipt(order);

          // Replace "Copy 1 of 2" with actual copy number
          receipt = receipt.replace(
            'Copy 1 of 2',
            `Copy ${copy} of 2`
          );

          const bytes = this.stringToBytes(receipt);
          const success = await this.sendCommand(bytes);

          if (!success && copy === 1) {
            // Reconnect on first failure
            await this.reconnect();
            const bytes2 = this.stringToBytes(receipt);
            await this.sendCommand(bytes2);
          }

          // Delay between copies
          await this.delay(2000);
        } catch (err) {
          console.error(`Error printing copy ${copy}:`, err);
        }
      }

      // Mark order as printed
      this.printedOrders.add(order.id);

      // Delay between orders
      await this.delay(1000);
    }

    this.isPrinting = false;
  }

  /**
   * Reconnect to printer
   */
  async reconnect() {
    try {
      if (this.device) {
        await this.device.close();
      }
      await this.connectDevice();
      return this.isConnected;
    } catch (err) {
      console.error('Reconnect failed:', err);
      return false;
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Disconnect printer
   */
  async disconnect() {
    try {
      if (this.device) {
        await this.device.close();
      }
      this.isConnected = false;
      this.device = null;
      console.log('Printer disconnected');
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }

  /**
   * Check if printer is available
   */
  isSupported() {
    return navigator && navigator.usb !== undefined;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      supported: this.isSupported(),
      connected: this.isConnected,
      device: this.device ? this.device.productName : null,
      printedOrders: this.printedOrders.size,
      queuedOrders: this.printQueue.length,
      isPrinting: this.isPrinting,
    };
  }

  /**
   * Clear printed orders (for testing/reset)
   */
  clearPrintedOrders() {
    this.printedOrders.clear();
  }
}

// Global instance
const thermalPrinter = new ThermalPrinterManager();
