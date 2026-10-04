import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import API from '../services/api';
import { mapAuthError } from '../utils/errorMapper';

const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [welcomeAnimation, setWelcomeAnimation] = useState({ show: false, isNew: false, name: '' });
  const [envWarning, setEnvWarning] = useState(null);

  // Environment Guard Check (REQ 5)
  useEffect(() => {
    const checkEnvironment = async () => {
      try {
        const res = await API.get('/health/env');
        const serverProjectId = res.data?.data?.projectId;
        const clientProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project';

        if (serverProjectId && clientProjectId && serverProjectId !== clientProjectId) {
          setEnvWarning(
            `⚠️ Environment Mismatch Warning: Client Firebase Project (${clientProjectId}) does not match Server Firebase Project (${serverProjectId}).`
          );
        } else {
          setEnvWarning(null);
        }
      } catch (err) {
        // Ignore health check errors in offline/test env
      }
    };
    checkEnvironment();
  }, []);

  // Clear stale state helper (REQ 6)
  const clearStaleSession = () => {
    localStorage.removeItem('healthcare_demo_user');
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('role_') || key.startsWith('auth_') || key.startsWith('patient_')) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
    setCurrentUser(null);
    setUserRole(null);
    setPatientProfile(null);
    setMustChangePassword(false);
    setWelcomeAnimation({ show: false, isNew: false, name: '' });
  };

  // Sync user session with backend (REQ 2, 4)
  const syncUserSession = async (user) => {
    try {
      const response = await API.post('/auth/login-sync');
      if (response.data && response.data.success) {
        const syncData = response.data.data;
        const { role, mustChangePassword: mustChange } = syncData;

        // Strict role validation (REQ 4: unknown role -> logout)
        if (!role || !ALLOWED_ROLES.includes(role)) {
          console.warn('⚠️ Unknown or unassigned role returned by loginSync:', role);
          await logout();
          throw new Error('Unknown or unauthorized user role. Session terminated.');
        }

        setUserRole(role);
        setMustChangePassword(!!mustChange);
        setCurrentUser((prev) => ({ ...(prev || {}), ...syncData }));

        if (role === 'patient') {
          fetchPatientProfile();
        }

        return syncData;
      }
    } catch (err) {
      if (err.response?.status === 403 || err.response?.data?.error?.code === 'PROFILE_MISSING') {
        await logout();
        throw err;
      }
      console.warn('⚠️ User session sync warning:', err.message);
      throw err;
    }
  };

  const fetchPatientProfile = async () => {
    try {
      const res = await API.get('/patients/me');
      if (res.data && res.data.success) {
        setPatientProfile(res.data.data);
      }
    } catch (err) {
      console.warn('⚠️ Patient profile fetch warning:', err.message);
    }
  };

  useEffect(() => {
    // Check demo user
    const savedDemoUser = localStorage.getItem('healthcare_demo_user');
    if (savedDemoUser) {
      try {
        const parsed = JSON.parse(savedDemoUser);
        if (parsed && ALLOWED_ROLES.includes(parsed.role)) {
          setCurrentUser(parsed);
          setUserRole(parsed.role);
          setMustChangePassword(!!parsed.mustChangePassword);
          if (parsed.role === 'patient') {
            fetchPatientProfile();
          }
          setLoading(false);
          return;
        } else {
          clearStaleSession();
        }
      } catch (err) {
        clearStaleSession();
      }
    }

    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        try {
          await syncUserSession(user);
        } catch (e) {
          clearStaleSession();
        }
      } else {
        clearStaleSession();
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (rawEmail, password) => {
    const email = String(rawEmail || '').trim().toLowerCase(); // Trim & lowercase email
    let synced;

    if (!auth) {
      const demoUser = { uid: `usr-${Date.now()}`, email, role: 'patient' };
      localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
      setCurrentUser(demoUser);
      setUserRole('patient');
      synced = demoUser;
    } else {
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        setCurrentUser(credential.user);
        synced = await syncUserSession(credential.user);
      } catch (fbErr) {
        if (fbErr.code === 'auth/configuration-not-found' || fbErr.code === 'auth/operation-not-allowed') {
          const demoUser = { uid: `usr-${Date.now()}`, email, role: 'patient' };
          localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
          setCurrentUser(demoUser);
          setUserRole('patient');
          synced = demoUser;
        } else {
          throw fbErr;
        }
      }
    }

    if (synced?.role === 'patient') {
      let displayName = synced?.displayName || synced?.fullName || email?.split('@')[0] || 'Patient';
      try {
        const profRes = await API.get('/patients/me');
        if (profRes.data && profRes.data.success) {
          setPatientProfile(profRes.data.data);
          displayName = profRes.data.data.name || displayName;
        }
      } catch (e) {
        // ignore
      }
      setWelcomeAnimation({ show: true, isNew: false, name: displayName });
    }

    return synced;
  };

  const patientRegister = async (formData) => {
    const cleanEmail = String(formData.email || '').trim().toLowerCase(); // Trim & lowercase email
    const cleanData = { ...formData, email: cleanEmail, role: 'patient' }; // Force role patient

    let uid;
    if (auth) {
      try {
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, formData.password);
        uid = credential.user.uid;
        setCurrentUser(credential.user);
      } catch (fbErr) {
        if (fbErr.code === 'auth/configuration-not-found' || fbErr.code === 'auth/operation-not-allowed') {
          uid = `pat-${Date.now()}`;
          const demoUser = { uid, email: cleanEmail, role: 'patient' };
          localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
          setCurrentUser(demoUser);
        } else {
          throw fbErr;
        }
      }
    } else {
      uid = `pat-${Date.now()}`;
      const demoUser = { uid, email: cleanEmail, role: 'patient' };
      localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
      setCurrentUser(demoUser);
    }

    setUserRole('patient');

    const res = await API.post('/auth/register', cleanData);
    try {
      await syncUserSession(auth?.currentUser || { uid });
    } catch (e) {
      // sync fallback
    }

    if (res.data && res.data.data) {
      setPatientProfile(res.data.data);
    }

    setWelcomeAnimation({
      show: true,
      isNew: true,
      name: cleanData.fullName || cleanEmail.split('@')[0]
    });

    return res.data;
  };

  const changeDoctorPassword = async (newPassword) => {
    const res = await API.post('/auth/change-password', { newPassword });
    if (res.data && res.data.success) {
      setMustChangePassword(false);
      if (currentUser && currentUser.uid) {
        const updatedUser = { ...currentUser, mustChangePassword: false };
        setCurrentUser(updatedUser);
        if (localStorage.getItem('healthcare_demo_user')) {
          localStorage.setItem('healthcare_demo_user', JSON.stringify(updatedUser));
        }
      }
    }
    return res.data;
  };

  const logout = async () => {
    if (auth) {
      try {
        await signOut(auth);
      } catch (e) {
        // ignore
      }
    }
    clearStaleSession();
  };

  const dismissWelcome = () => {
    setWelcomeAnimation({ show: false, isNew: false, name: '' });
  };

  const value = {
    currentUser,
    userRole,
    setUserRole,
    patientProfile,
    fetchPatientProfile,
    mustChangePassword,
    welcomeAnimation,
    dismissWelcome,
    envWarning,
    login,
    patientRegister,
    changeDoctorPassword,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {envWarning && (
        <div className="bg-amber-500 text-white text-xs font-bold text-center py-2 px-4 shadow-md">
          {envWarning}
        </div>
      )}
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
