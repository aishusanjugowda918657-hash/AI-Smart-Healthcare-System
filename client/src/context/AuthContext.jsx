import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { auth } from '../config/firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import API from '../services/api';
import { mapAuthError } from '../utils/errorMapper';

const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loginSynced, setLoginSynced] = useState(false);
  const [patientProfile, setPatientProfile] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [welcomeAnimation, setWelcomeAnimation] = useState({ show: false, isNew: false, name: '' });
  const [envWarning, setEnvWarning] = useState(null);
  const [noRoleError, setNoRoleError] = useState('');
  const prevUidRef = useRef(null);

  // Environment Guard Check
  useEffect(() => {
    const checkEnvironment = async () => {
      try {
        const res = await API.get('/health/env');
        const serverEnv = res.data?.data;
        const serverProjectId = serverEnv?.projectId;
        const serverIsEmulator = !!serverEnv?.isEmulator;

        const clientIsEmulator =
          import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' ||
          import.meta.env.VITE_USE_FIREBASE_EMULATOR === true;
        const clientProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || (clientIsEmulator ? 'demo-project' : 'ai-basedsmarthealthcaresystem');

        if (clientIsEmulator !== serverIsEmulator) {
          setEnvWarning(
            `⚠️ Environment Mode Mismatch: Client is running in ${clientIsEmulator ? 'Emulator' : 'Real Firebase'} mode, but Server is running in ${serverIsEmulator ? 'Emulator' : 'Real Firebase'} mode.`
          );
        } else if (serverProjectId && clientProjectId && serverProjectId !== clientProjectId) {
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

  // Clear all stored auth, role, and session data
  const clearStaleSession = () => {
    localStorage.clear();
    sessionStorage.clear();
    setCurrentUser(null);
    setUserRole(null);
    setLoginSynced(false);
    setPatientProfile(null);
    setMustChangePassword(false);
    setWelcomeAnimation({ show: false, isNew: false, name: '' });
  };

  // Sync user session with backend
  const syncUserSession = async (user) => {
    try {
      const response = await API.post('/auth/login-sync');
      if (response.data && response.data.success) {
        const syncData = response.data.data;
        const { role, mustChangePassword: mustChange } = syncData;
        const cleanRole = String(role || '').trim().toLowerCase();
        const normalizedRole = cleanRole === 'receptionist' ? 'reception' : cleanRole;

        // Strict role validation: missing or unknown role -> show message and logout
        if (!normalizedRole || !ALLOWED_ROLES.includes(normalizedRole)) {
          console.warn('⚠️ Unknown or unassigned role returned by loginSync:', role);
          setNoRoleError('Your account has no role assigned');
          await logout();
          throw new Error('Your account has no role assigned');
        }

        let tokenDoctorId = null;
        try {
          if (user && typeof user.getIdTokenResult === 'function') {
            const tokenResult = await user.getIdTokenResult();
            tokenDoctorId = tokenResult?.claims?.doctorId || null;
          }
        } catch (_) {}

        const resolvedDoctorId = syncData.doctorId || tokenDoctorId || null;

        setUserRole(normalizedRole);
        setMustChangePassword(!!mustChange);
        setLoginSynced(true);
        setCurrentUser((prev) => ({
          ...(prev || {}),
          ...user,
          ...syncData,
          role: normalizedRole,
          doctorId: resolvedDoctorId,
          displayId: syncData.displayId || syncData.doctorDisplayId || (prev && (prev.displayId || prev.doctorDisplayId)) || null,
          doctorDisplayId: syncData.displayId || syncData.doctorDisplayId || (prev && (prev.displayId || prev.doctorDisplayId)) || null
        }));

        if (normalizedRole === 'patient') {
          fetchPatientProfile();
        }

        return syncData;
      } else {
        throw new Error('Login sync failed');
      }
    } catch (err) {
      if (err.message === 'Your account has no role assigned') {
        throw err;
      }
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
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (prevUidRef.current && prevUidRef.current !== user.uid) {
          clearStaleSession();
        }
        prevUidRef.current = user.uid;
        setCurrentUser(user);
        try {
          await syncUserSession(user);
        } catch (e) {
          clearStaleSession();
        }
      } else {
        prevUidRef.current = null;
        clearStaleSession();
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (rawEmail, password) => {
    const email = String(rawEmail || '').trim().toLowerCase();
    setNoRoleError('');

    if (!auth) {
      throw new Error('Firebase Auth unavailable.');
    }

    clearStaleSession();

    const credential = await signInWithEmailAndPassword(auth, email, password);
    setCurrentUser(credential.user);
    const synced = await syncUserSession(credential.user);

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
    const cleanEmail = String(formData.email || '').trim().toLowerCase();
    const cleanData = { ...formData, email: cleanEmail, role: 'patient' };
    setNoRoleError('');

    if (!auth) {
      throw new Error('Firebase Auth unavailable.');
    }

    // Step 1: Server creates the Auth user + Firestore docs atomically
    const res = await API.post('/auth/register', cleanData);

    if (!res.data || !res.data.success) {
      throw new Error(res.data?.error?.message || 'Registration failed.');
    }

    // Step 2: Now sign in on the client side with the same credentials
    const credential = await signInWithEmailAndPassword(auth, cleanEmail, formData.password);
    setCurrentUser(credential.user);
    setUserRole('patient');

    // Step 3: Sync session with backend (fetches role, profile)
    try {
      await syncUserSession(credential.user);
    } catch (e) {
      // sync fallback — profile was created server-side, non-fatal
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

  useEffect(() => {
    window.__smartcare_logout = logout;
  }, []);

  const dismissWelcome = () => {
    setWelcomeAnimation({ show: false, isNew: false, name: '' });
  };

  const value = {
    currentUser,
    userRole,
    setUserRole,
    loginSynced,
    patientProfile,
    fetchPatientProfile,
    mustChangePassword,
    welcomeAnimation,
    dismissWelcome,
    envWarning,
    noRoleError,
    setNoRoleError,
    login,
    patientRegister,
    changeDoctorPassword,
    logout,
    clearStaleSession,
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
