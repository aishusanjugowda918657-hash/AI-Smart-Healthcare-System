import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Download, Bell } from 'lucide-react';

const DISMISSAL_KEY = 'smartcare_pwa_dismissed_at';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const PwaInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const pushSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const flagPushOn =
    import.meta.env.VITE_FLAG_PUSH === 'true' ||
    import.meta.env.VITE_FLAG_PUSH === true ||
    import.meta.env.FLAG_PUSH === 'true';

  useEffect(() => {
    // Check 7-day localStorage dismissal
    try {
      const dismissedAt = localStorage.getItem(DISMISSAL_KEY);
      if (dismissedAt) {
        const elapsed = Date.now() - Number(dismissedAt);
        if (elapsed < SEVEN_DAYS_MS) {
          return; // Still within 7-day dismissal window
        }
      }
    } catch (e) {
      // ignore localStorage errors
    }

    // Check if already in standalone mode
    const isStandalone =
      (typeof window !== 'undefined' && window.navigator?.standalone) ||
      (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    if (isStandalone) {
      return;
    }

    // Detect iOS
    const iosDevice =
      typeof navigator !== 'undefined' &&
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !window.MSStream;
    setIsIos(iosDevice);

    // Show install prompt only when browser says app is installable
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowPrompt(false);
    try {
      localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
    } catch (e) {}
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
    } catch (e) {}
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
    } catch (err) {
      console.warn('Error requesting notification permission:', err);
    }
  };

  const isInstallable = Boolean(deferredPrompt);
  const showPush = pushSupported && flagPushOn && notificationStatus !== 'granted';

  // If dismissed, already installed, or not installable and no push alerts allowed, do not show
  if (!showPrompt && !showPush) return null;
  if (!isInstallable && !showPush) return null;

  return (
    <div
      role="region"
      aria-label="App Installation and Notification Banner"
      className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:right-6 sm:left-auto sm:max-w-sm z-40 bg-slate-900/95 text-white p-3 sm:p-4 rounded-none sm:rounded-2xl border-t sm:border border-slate-700 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom duration-300 space-y-2 pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-sm shrink-0">
            <Download className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-xs text-white truncate">Install SmartCare AI</h4>
            <p className="text-[10px] text-slate-400 truncate">Fast access & offline triage</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isInstallable && (
            <button
              onClick={handleInstallClick}
              className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-all flex items-center space-x-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
          )}

          <button
            onClick={handleDismiss}
            aria-label="Dismiss banner"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-1"
            title="Dismiss for 7 days"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isIos && !deferredPrompt && (
        <p className="text-[11px] text-slate-300 bg-slate-800/80 p-2 rounded-xl border border-slate-700/60 leading-tight">
          To install on iOS: Tap <Share className="w-3 h-3 inline text-teal-400 mx-0.5" /> then <strong className="text-white">"Add to Home Screen"</strong> <PlusSquare className="w-3 h-3 inline text-teal-400 mx-0.5" />.
        </p>
      )}

      {/* Push Notifications: Only shown if push supported AND FLAG_PUSH is on */}
      {showPush && (
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs gap-2">
          <div className="flex items-center space-x-1.5 text-slate-300 min-w-0">
            <Bell className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] truncate">Push alerts</span>
          </div>

          {notificationStatus === 'denied' ? (
            <span className="text-[10px] font-semibold text-rose-400">Blocked in browser</span>
          ) : (
            <button
              onClick={requestNotificationPermission}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-teal-300 font-bold text-[11px] rounded-lg transition-all border border-slate-700"
            >
              Enable
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PwaInstallPrompt;
