import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Download, Bell, ShieldCheck } from 'lucide-react';

export const PwaInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    // Check if dismissed during current session
    if (sessionStorage.getItem('pwa_prompt_dismissed') === 'true') {
      return;
    }

    // Check if already in standalone mode
    const isStandalone =
      window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

    if (isStandalone) {
      return; // App is already installed and running in PWA mode
    }

    // Detect iOS
    const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIos(iosDevice);

    if (iosDevice) {
      setShowPrompt(true);
    }

    // Handle Android / Chrome beforeinstallprompt event
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
    console.log(`User installation choice: ${outcome}`);
    setDeferredPrompt(null);
    setShowPrompt(false);
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission === 'granted') {
        console.log('Notification permission granted by user.');
      }
    } catch (err) {
      console.warn('Error requesting notification permission:', err);
    }
  };

  if (!showPrompt && notificationStatus === 'granted') return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 bg-slate-900/95 text-white p-4 sm:p-5 rounded-3xl border border-slate-800 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom duration-300 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 to-teal-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-white">Install SmartCare AI</h4>
            <p className="text-[11px] text-slate-400">Standalone App Experience</p>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          title="Dismiss Prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isIos ? (
        <p className="text-xs text-slate-300 leading-relaxed bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60">
          Install SmartCare AI on your iPhone: Tap <Share className="w-3.5 h-3.5 inline text-brand-400 mx-0.5" /> then select{' '}
          <strong className="text-white">"Add to Home Screen"</strong> <PlusSquare className="w-3.5 h-3.5 inline text-brand-400 mx-0.5" />.
        </p>
      ) : (
        deferredPrompt && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-slate-300">Add to home screen for full-screen mode.</p>
            <button
              onClick={handleInstallClick}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>
          </div>
        )
      )}

      {/* Notification Permission Request Section */}
      {notificationStatus !== 'granted' && (
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5 text-slate-300">
            <Bell className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>Enable Push Alerts</span>
          </div>

          {notificationStatus === 'denied' ? (
            <span className="text-[11px] font-semibold text-rose-400">Notifications Blocked in Browser</span>
          ) : (
            <button
              onClick={requestNotificationPermission}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-[11px] rounded-xl transition-all"
            >
              Enable Notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PwaInstallPrompt;
