/* ================================================================
   Checkout — Razorpay payment flow
   ================================================================ */

async function handleCheckout() {
  if (!currentUser) {
    closeCartDrawer();
    openAuthModal();
    return;
  }
  if (!currentUser.phone) {
    openPhoneModal();
    return;
  }

  const cart = getCart();
  if (cart.length === 0) return;

  const locationId = document.getElementById('cart-location')?.value;
  if (!locationId) {
    alert('Please select a delivery location before placing your order.');
    return;
  }

  const btn = document.getElementById('checkout-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:1rem;height:1rem;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span> Creating order...';

  try {
    // 1. Create Razorpay order on server
    const rzpOrder = await apiFetch('/api/orders/create-razorpay-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(c => ({ food_item_id: c.food_item_id, quantity: c.quantity, name: c.name })),
        firebase_uid: currentUser.firebase_uid,
      }),
    });

    // 2. Open Razorpay checkout popup
    const options = {
      key: window.__RAZORPAY_KEY_ID__,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency || 'INR',
      name: 'SRM Good Foods',
      description: 'Campus Food Delivery',
      image: window.__LOGO_URL__,
      order_id: rzpOrder.razorpay_order_id,
      prefill: {
        name: currentUser.name || '',
        email: currentUser.email || '',
        contact: currentUser.phone || '',
      },
      theme: { color: '#942626' },
      handler: async function(response) {
        // 3. Verify payment and place order
        btn.innerHTML = '<span class="spinner" style="width:1rem;height:1rem;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span> Verifying payment...';

        try {
          const kitchenNotes = document.getElementById('cart-notes')?.value || '';
          const result = await apiFetch('/api/orders/verify-and-place', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              firebase_uid: currentUser.firebase_uid,
              delivery_location_id: parseInt(locationId),
              kitchen_notes: kitchenNotes,
              items: cart.map(c => ({ food_item_id: c.food_item_id, quantity: c.quantity, name: c.name })),
            }),
          });

          // Success!
          clearCart();
          closeCartDrawer();

          // Show success & switch to tracking
          if (result.order) {
            switchView('tracking');
          }
        } catch (err) {
          alert('Payment verified but order placement failed: ' + err.message);
        }
      },
      modal: {
        ondismiss: function() {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="lock" style="width:0.875rem;height:0.875rem;"></i><span>Pay with Razorpay</span>';
          if (window.lucide) lucide.createIcons();
        },
      },
    };

    const rzp = new Razorpay(options);
    rzp.open();

  } catch (err) {
    alert('Failed to create order: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="lock" style="width:0.875rem;height:0.875rem;"></i><span>Pay with Razorpay</span>';
    if (window.lucide) lucide.createIcons();
  }
}
