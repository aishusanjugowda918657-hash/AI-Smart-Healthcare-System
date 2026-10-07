import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import {
  Search,
  Users,
  UserCheck,
  Calendar,
  Lock,
  ChevronRight,
  AlertCircle,
  Clock,
  ShieldAlert,
  Loader2,
  RefreshCw
} from 'lucide-react';
import API from '../services/api';

export const DoctorPatientsPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'my-patients'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [myPatients, setMyPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [accessError, setAccessError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch My Patients (seen in last 12 months)
  const fetchMyPatients = async () => {
    try {
      setLoading(true);
      const res = await API.get('/doctor/patients/my-patients');
      if (res.data?.success) {
        setMyPatients(res.data.data || []);
      }
    } catch (err) {
      console.warn('My patients lookup notice:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-patients') {
      fetchMyPatients();
    }
  }, [activeTab]);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setAccessError(null);
    setHasSearched(true);

    try {
      const res = await API.get(`/doctor/patients/search?query=${encodeURIComponent(searchQuery.trim())}`);
      if (res.data?.success) {
        setSearchResults(res.data.data || []);
      }
    } catch (err) {
      console.warn('Patient search notice:', err.message);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPatient = (patient) => {
    setAccessError(null);
    const healthId = patient.healthId || patient.patientHealthId;
    navigate(`/patient-history`, {
      state: {
        patientHealthId: healthId,
        patientName: patient.name || patient.fullName
      }
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto" data-testid="doctor-patients-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('myPatients') || 'Patients Directory'}</h1>
          <p className="text-xs text-slate-500">
            Search patient records by name prefix, Health ID or token, or view your past patients
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => {
              setActiveTab('search');
              setAccessError(null);
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'search'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t('searchPatients') || 'Search Patients'}
          </button>
          <button
            onClick={() => {
              setActiveTab('my-patients');
              setAccessError(null);
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'my-patients'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t('myPatients') || 'My Patients (12 Months)'}
          </button>
        </div>
      </div>

      {/* Access Denied Banner */}
      {accessError && (
        <div
          className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start space-x-3 text-amber-900"
          data-testid="patient-access-denied-banner"
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-xs">Access Restricted</h4>
            <p className="text-xs mt-0.5">{accessError}</p>
          </div>
          <button
            onClick={() => setAccessError(null)}
            className="text-xs font-bold text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SEARCH TAB */}
      {activeTab === 'search' && (
        <div className="space-y-6">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by patient name prefix, Health ID (e.g. HID-...), or token label..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center space-x-1.5"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Search</span>
            </button>
          </form>

          {/* Results List */}
          {loading && (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
              <span>Searching patient database...</span>
            </div>
          )}

          {!loading && hasSearched && searchResults.length === 0 && (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="font-bold text-slate-700 text-sm">No matching patients found</h3>
              <p className="text-xs text-slate-500">
                Check spelling, try entering the exact Health ID or search with a different prefix.
              </p>
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="space-y-3">
              {/* Multi-match notice if multiple patients returned */}
              {searchResults.length > 1 && (
                <div className="p-3 bg-slate-100 rounded-xl text-xs text-slate-600 flex items-center space-x-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span>
                    Found {searchResults.length} matching patients. Select a patient by verifying their age and Health ID.
                  </span>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
                {searchResults.map((p) => (
                  <div
                    key={p.healthId}
                    className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-800 text-sm">{p.name || p.fullName}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-semibold capitalize">
                          {p.gender}
                        </span>
                        <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-[11px] font-bold">
                          {p.age}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>
                          Health ID:{' '}
                          <strong className="font-mono text-slate-700">{p.healthId}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Last Visit: <strong>{p.lastVisitDate}</strong>
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenPatient(p)}
                      className="px-4 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-700 rounded-xl text-xs font-bold transition flex items-center space-x-1"
                    >
                      <span>Open History</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MY PATIENTS TAB */}
      {activeTab === 'my-patients' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Patients seen in your clinic over the last 12 months</span>
            <button
              onClick={fetchMyPatients}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition flex items-center space-x-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {loading && (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
              <span>Loading your patient records...</span>
            </div>
          )}

          {!loading && myPatients.length === 0 && (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="font-bold text-slate-700 text-sm">No recent patients</h3>
              <p className="text-xs text-slate-500">
                You have not completed consultations for any patients in the last 12 months.
              </p>
            </div>
          )}

          {!loading && myPatients.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
              {myPatients.map((p) => (
                <div
                  key={p.healthId}
                  className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-800 text-sm">{p.name || p.fullName}</span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-semibold capitalize">
                        {p.gender}
                      </span>
                      <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-[11px] font-bold">
                        {p.age}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>
                        Health ID: <strong className="font-mono text-slate-700">{p.healthId}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Last Seen: <strong>{p.lastVisitDate}</strong>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenPatient(p)}
                    className="px-4 py-2 bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-700 rounded-xl text-xs font-bold transition flex items-center space-x-1"
                  >
                    <span>Open History</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DoctorPatientsPage;
