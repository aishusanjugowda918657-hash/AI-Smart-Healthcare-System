import React, { useState, useEffect } from 'react';
import API from '../../services/api';
import { AlertTriangle } from 'lucide-react';

export const HealthBanner = () => {
  const [unreachable, setUnreachable] = useState(false);
  const apiBaseUrl = API.defaults?.baseURL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await API.get('/health');
        if (!res.data || !res.data.success) {
          setUnreachable(true);
        } else {
          setUnreachable(false);
        }
      } catch (err) {
        setUnreachable(true);
      }
    };

    checkHealth();
  }, []);

  if (!unreachable) return null;

  return (
    <div className="bg-rose-600 text-white text-xs font-bold text-center py-2.5 px-4 shadow-md flex items-center justify-center gap-2 sticky top-0 z-50">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>Cannot reach the server at {apiBaseUrl}</span>
    </div>
  );
};

export default HealthBanner;
