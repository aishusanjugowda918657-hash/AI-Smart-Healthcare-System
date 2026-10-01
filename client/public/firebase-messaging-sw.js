// Firebase Messaging Service Worker for Background Push Notifications
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyDemoKeyForSmartHealthcareSystem123",
  authDomain: "ai-smart-healthcare.firebaseapp.com",
  projectId: "ai-smart-healthcare-demo",
  storageBucket: "ai-smart-healthcare.appspot.com",
  messagingSenderId: "100000000000",
  appId: "1:100000000000:web:abcdef1234567890"
};

try {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message: ', payload);
    const notificationTitle = payload.notification?.title || 'SmartCare AI Notification';
    const notificationOptions = {
      body: payload.notification?.body || 'You have a healthcare status update.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data || {}
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (err) {
  console.warn('[firebase-messaging-sw.js] Background messaging fallback active');
}
