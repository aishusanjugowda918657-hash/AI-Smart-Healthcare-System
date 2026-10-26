import axios from 'axios';
import { auth } from '../config/firebase';

export const resolveBaseUrl = () => {
  // When running locally in browser (localhost / 127.0.0.1), use the Vite local proxy (/api)
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return '/api';
  }
  return import.meta.env.VITE_API_BASE_URL || 'https://ai-smart-healthcare-system-w87k.onrender.com/api';
};

const API = axios.create({
  baseURL: resolveBaseUrl(),
  headers: {
    'Content-Type': 'application/json'
  }
});

// Attach Authorization Bearer token or demo headers
API.interceptors.request.use(
  async (config) => {
    try {
      if (auth && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        // Fallback for local testing / demo mode state stored in localStorage
        const demoUser = JSON.parse(localStorage.getItem('healthcare_demo_user') || 'null');
        if (demoUser) {
          config.headers['x-demo-uid'] = demoUser.uid;
          config.headers['x-demo-email'] = demoUser.email;
          config.headers['x-demo-role'] = demoUser.role;
        }
      }
    } catch (err) {
      console.warn('Error attaching token in API interceptor:', err);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Automatic token refresh on 401 Unauthorized
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (auth && auth.currentUser) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              return API(originalRequest);
            })
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const newToken = await auth.currentUser.getIdToken(true);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          processQueue(null, newToken);
          return API(originalRequest);
        } catch (refreshErr) {
          processQueue(refreshErr, null);
          return Promise.reject(error);
        } finally {
          isRefreshing = false;
        }
      }
    }
    return Promise.reject(error);
  }
);

export default API;
