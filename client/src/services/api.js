import axios from 'axios';
import { auth } from '../config/firebase';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
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

export default API;
