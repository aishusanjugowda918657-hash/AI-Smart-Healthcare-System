import React, { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck, Activity, PhoneCall, QrCode, RefreshCw } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const ManagePatients = () => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPatients = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await API.get('/admin/patients');
      if (res.data?.data) {
        setPatients(res.data.data);
      }
    } catch (err) {
      console.warn('Fetch admin patients error:', err);
      setError(err.message || 'Failed to load registered patients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Patient Directory & Health ID Records</h2>
            <p className="text-xs text-slate-500">Live directory of verified patients registered in the SmartCare AI system</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="primary">{patients.length} Registered Patients</Badge>
          <button
            onClick={fetchPatients}
            disabled={loading}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
            title="Refresh Patient Directory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand-600' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 text-xs font-semibold rounded-2xl border border-red-200">
          ⚠️ {error}
        </div>
      )}

      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Verified Patient Registry</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Unique Health ID</th>
                <th className="py-3 px-3">Patient Name</th>
                <th className="py-3 px-3">Blood Group</th>
                <th className="py-3 px-3">DOB</th>
                <th className="py-3 px-3">Phone</th>
                <th className="py-3 px-3">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && patients.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-brand-500" />
                    Loading verified patients...
                  </td>
                </tr>
              ) : patients.length > 0 ? (
                patients.map((pt) => (
                  <tr key={pt.patientHealthId || pt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-teal-700">{pt.patientHealthId}</td>
                    <td className="py-3 px-3 font-bold text-slate-800">{pt.fullName}</td>
                    <td className="py-3 px-3 font-bold text-rose-500">{pt.bloodGroup}</td>
                    <td className="py-3 px-3 text-slate-500">{pt.dob}</td>
                    <td className="py-3 px-3 text-slate-600">{pt.phone}</td>
                    <td className="py-3 px-3">
                      <span className="text-emerald-600 flex items-center text-[11px] font-semibold">
                        <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Verified
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400 italic">
                    No registered patients found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ManagePatients;
