/* Firebase Configuration & Auth Helpers */
(function() {
  const cfg = window.__FIREBASE_CONFIG__;
  if (cfg && cfg.apiKey) {
    firebase.initializeApp(cfg);
    window._firebaseAuth = firebase.auth();
    window._googleProvider = new firebase.auth.GoogleAuthProvider();
    console.log('[Firebase] Initialized successfully');
  } else {
    console.warn('[Firebase] No config found — auth will be unavailable');
  }
})();
