import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { firebaseConfig } from './config/firebase.js';

// Register FCM & PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hasValidConfig = Boolean(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);
    const swUrl = hasValidConfig
      ? `/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(firebaseConfig))}`
      : '/firebase-messaging-sw.js';

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log(
          'FCM Service Worker registered successfully:',
          registration.scope
        );
      })
      .catch((err) => {
        console.error(
          'Service Worker registration failed:',
          err
        );
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
