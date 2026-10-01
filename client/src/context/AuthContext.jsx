import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import API from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [welcomeAnimation, setWelcomeAnimation] = useState({ show: false, isNew: false, name: '' });

  // Sync user session with backend
  const syncUserSession = async (user) => {
    try {
      const response = await API.post('/auth/login-sync');
      if (response.data && response.data.success) {
        const syncData = response.data.data;
        const { role, mustChangePassword: mustChange } = syncData;
        setUserRole(role);
        setMustChangePassword(!!mustChange);
        setCurrentUser((prev) => ({ ...(prev || {}), ...syncData }));

        if (role === 'patient') {
          fetchPatientProfile();
        }

        return syncData;
      }
    } catch (err) {
      console.warn('⚠️ User session sync warning:', err.message);
      const fallbackRole = localStorage.getItem(`role_${user.uid}`) || 'patient';
      setUserRole(fallbackRole);
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
    // Check if demo user was saved
    const savedDemoUser = localStorage.getItem('healthcare_demo_user');
    if (savedDemoUser) {
      try {
        const parsed = JSON.parse(savedDemoUser);
        setCurrentUser(parsed);
        setUserRole(parsed.role);
        setMustChangePassword(!!parsed.mustChangePassword);
        if (parsed.role === 'patient') {
          fetchPatientProfile();
        }
        setLoading(false);
        return;
      } catch (err) {
        console.error('Error parsing demo user:', err);
      }
    }

    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        await syncUserSession(user);
      } else {
        setCurrentUser(null);
        setUserRole(null);
        setPatientProfile(null);
        setMustChangePassword(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const patientLogin = async (email, password) => {
    let synced;
    if (!auth) {
      const demoUser = { uid: `pat-${Date.now()}`, email, role: 'patient' };
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
          console.warn('⚠️ Firebase Auth Email provider unconfigured. Falling back to backend session sync.');
          const demoUser = { uid: `pat-${Date.now()}`, email, role: 'patient' };
          localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
          setCurrentUser(demoUser);
          setUserRole('patient');
          synced = demoUser;
        } else {
          throw fbErr;
        }
      }
    }

    // Trigger Welcome Animation for login
    let displayName = synced?.fullName || email?.split('@')[0] || 'Patient';
    try {
      const profRes = await API.get('/patients/me');
      if (profRes.data && profRes.data.success) {
        setPatientProfile(profRes.data.data);
        displayName = profRes.data.data.fullName || displayName;
      }
    } catch (e) {
      // ignore
    }

    setWelcomeAnimation({ show: true, isNew: false, name: displayName });
    return synced;
  };

  const patientRegister = async (formData) => {
    let uid;
    let email = formData.email;

    if (auth) {
      try {
        const credential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
        uid = credential.user.uid;
        setCurrentUser(credential.user);
      } catch (fbErr) {
        if (fbErr.code === 'auth/configuration-not-found' || fbErr.code === 'auth/operation-not-allowed') {
          console.warn('⚠️ Firebase Auth Email provider unconfigured. Falling back to backend profile creation.');
          uid = `pat-${Date.now()}`;
          const demoUser = { uid, email, role: 'patient' };
          localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
          setCurrentUser(demoUser);
        } else {
          throw fbErr;
        }
      }
    } else {
      uid = `pat-${Date.now()}`;
      const demoUser = { uid, email, role: 'patient' };
      localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
      setCurrentUser(demoUser);
    }

    setUserRole('patient');

    // Register patient profile & generate Health ID in Firestore
    const res = await API.post('/patients/profile', formData);
    try {
      await syncUserSession(auth?.currentUser || { uid });
    } catch (e) {
      // sync fallback
    }

    if (res.data && res.data.data) {
      setPatientProfile(res.data.data);
    }

    // Trigger Welcome Animation for new registration
    setWelcomeAnimation({
      show: true,
      isNew: true,
      name: formData.fullName || email.split('@')[0]
    });

    return res.data;
  };

  const doctorLogin = async (email, password) => {
    if (!auth) {
      const demoUser = { uid: 'doc-001', email, role: 'doctor', mustChangePassword: false };
      localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
      setCurrentUser(demoUser);
      setUserRole('doctor');
      setMustChangePassword(false);
      return demoUser;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      setCurrentUser(credential.user);
      const synced = await syncUserSession(credential.user);
      return synced;
    } catch (fbErr) {
      if (fbErr.code === 'auth/configuration-not-found' || fbErr.code === 'auth/operation-not-allowed') {
        console.warn('⚠️ Firebase Auth Email provider unconfigured. Falling back to doctor session.');
        const demoUser = { uid: 'doc-001', email, role: 'doctor', mustChangePassword: false };
        localStorage.setItem('healthcare_demo_user', JSON.stringify(demoUser));
        setCurrentUser(demoUser);
        setUserRole('doctor');
        setMustChangePassword(false);
        return demoUser;
      }
      throw fbErr;
    }
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
    localStorage.removeItem('healthcare_demo_user');
    if (auth) {
      await signOut(auth);
    }
    setCurrentUser(null);
    setUserRole(null);
    setPatientProfile(null);
    setMustChangePassword(false);
    setWelcomeAnimation({ show: false, isNew: false, name: '' });
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
    patientLogin,
    patientRegister,
    doctorLogin,
    changeDoctorPassword,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
