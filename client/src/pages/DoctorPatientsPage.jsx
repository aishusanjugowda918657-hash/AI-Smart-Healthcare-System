import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  RefreshCw,
  Share2,
  FileText,
  CheckCircle2
} from 'lucide-react';
import API from '../services/api';

export const DoctorPatientsPage = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabParam === 'shared' ? 'shared' : (tabParam === 'my-patients' ? 'my-patients' : 'search'));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [myPatients, setMyPatients] = useState([]);
  const [sharedPatients, setSharedPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [accessError, setAccessError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setAccessError(null);
    setSearchParams({ tab });
  };

  const formatTimeRemaining = (expiresAt) => {
    if (!expiresAt) return 'Active';
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    return `${mins}m remaining`;
  };

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

  // Fetch Patients who have shared their history with this doctor
  const fetchSharedPatients = async () => {
    try {
      setLoading(true);
      const res = await API.get('/doctor/patients/shared-with-me');
      if (res.data?.success) {
        setSharedPatients(res.data.data || []);
      }
    } catch (err) {
      console.warn('Shared patients lookup notice:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // On mount, also fetch shared patients count so badge is populated
  useEffect(() => {
    fetchSharedPatients();
  }, []);

  useEffect(() => {
    if (activeTab === 'my-patients') {
      fetchMyPatients();
    } else if (activeTab === 'shared') {
      fetchSharedPatients();
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
        const raw = res.data.data || [];
        const seen = new Set();
        const unique = raw.filter((p) => {
          const id = p.healthId || p.patientHealthId || p.id;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setSearchResults(unique);
      }
    } catch (err) {
      console.warn('Patient search notice:', err.message);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPatient = async (patient) => {
    setAccessError(null);
    const healthId = patient.healthId || patient.patientHealthId;
    try {
      const checkRes = await API.get(`/doctor/patients/${healthId}/access-check`);
      if (checkRes.data?.data && checkRes.data.data.hasAccess === false) {
        setAccessError(checkRes.data.data.message || 'No access. Ask the patient to share their history.');
        return;
      }
    } catch (err) {
      console.warn('Access check notice:', err.message);
    }

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
        <div className="flex flex-wrap bg-slate-100 p-1 rounded-xl gap-1">
          <button
            onClick={() => handleTabChange('search')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeTab === 'search'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>{t('searchPatients') || 'Search Patients'}</span>
          </button>
          <button
            onClick={() => handleTabChange('my-patients')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeTab === 'my-patients'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t('myPatients') || 'My Patients (12 Months)'}</span>
          </button>
          <button
            onClick={() => handleTabChange('shared')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeTab === 'shared'
                ? 'bg-white text-teal-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Share2 className="w-3.5 h-3.5 text-teal-600" />
            <span>Shared with Me</span>
            {sharedPatients.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 bg-teal-100 text-teal-800 rounded-full text-[10px] font-bold">
                {sharedPatients.length}
              </span>
            )}
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

      {/* SHARED WITH ME TAB */}
      {activeTab === 'shared' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Patients who have actively shared time-bound access to their medical records with you</span>
            <button
              onClick={fetchSharedPatients}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition flex items-center space-x-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {loading && (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
              <span>Checking shared medical records...</span>
            </div>
          )}

          {!loading && sharedPatients.length === 0 && (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center mx-auto">
                <Share2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-800 text-sm">No Active Patient Shares</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                When a patient shares their medical history using your Doctor ID (e.g. <strong className="text-slate-700">DOC-GEN-ASK-001</strong>), their record will immediately appear here with direct one-click access.
              </p>
            </div>
          )}

          {!loading && sharedPatients.length > 0 && (
            <div className="space-y-3">
              <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-800 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-teal-600 flex-shrink-0" />
                  <span>
                    You have <strong>{sharedPatients.length} active shared patient record{sharedPatients.length > 1 ? 's' : ''}</strong>. You can view their full medical history and timeline.
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
                {sharedPatients.map((p) => (
                  <div
                    key={p.grantId || p.patientHealthId}
                    className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-800 text-sm">{p.fullName || p.name}</span>
                        {p.gender && p.gender !== 'Unknown' && (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-semibold capitalize">
                            {p.gender}
                          </span>
                        )}
                        {p.age && (
                          <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-[11px] font-bold">
                            {p.age} yrs
                          </span>
                        )}
                        {p.bloodGroup && p.bloodGroup !== 'N/A' && (
                          <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded text-[11px] font-bold">
                            {p.bloodGroup}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>
                          Health ID: <strong className="font-mono text-slate-700">{p.patientHealthId}</strong>
                        </span>
                        <span>•</span>
                        <span className="flex items-center space-x-1 text-teal-700 font-medium">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{formatTimeRemaining(p.expiresAt)}</span>
                          {p.expiresAt && (
                            <span className="text-slate-400 text-[11px]">
                              (Expires {new Date(p.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenPatient(p)}
                      className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Medical History</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DoctorPatientsPage;
