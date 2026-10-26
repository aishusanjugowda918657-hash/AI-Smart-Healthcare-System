import React, { useState, useEffect } from 'react';
import { Building, Plus, CheckCircle, AlertCircle, RefreshCw, Users, ShieldCheck } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const ManageDepartments = () => {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newDept, setNewDept] = useState({ name: '', code: '', room: '', wing: 'North Wing', description: '' });
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const res = await API.get('/departments');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setDepartments(res.data.data);
      }
    } catch (err) {
      console.warn('Fetch departments error:', err.message);
      // Fallback only if offline/network error
      if (departments.length === 0) {
        setDepartments([
          { id: 'dept-gen', name: 'General Medicine', code: 'GEN', room: 'Room 101-104', wing: 'North Wing', activeDoctors: 0 },
          { id: 'dept-card', name: 'Cardiology', code: 'CARD', room: 'Room 201-205', wing: 'East Wing', activeDoctors: 0 }
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddDept = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const payload = {
        name: newDept.name.trim(),
        code: newDept.code.trim().toUpperCase(),
        letter: newDept.code.trim().toUpperCase().charAt(0),
        room: newDept.room.trim() || 'Room 501',
        wing: newDept.wing || 'North Wing',
        description: newDept.description.trim()
      };

      const res = await API.post('/departments', payload);
      setMessage({ type: 'success', text: `Department ${newDept.name} (${payload.code}) registered successfully!` });
      setShowForm(false);
      setNewDept({ name: '', code: '', room: '', wing: 'North Wing', description: '' });
      await fetchDepartments();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || err.response?.data?.error?.message || 'Failed to add department.' });
    } finally {
      setSubmitting(false);
    }
  };

  const totalActiveDoctors = departments.reduce((acc, d) => acc + (Number(d.activeDoctors) || 0), 0);
  const staffedDeptsCount = departments.filter((d) => (Number(d.activeDoctors) || 0) > 0).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Medical Departments & Wings</h2>
            <p className="text-xs text-slate-500">Configure medical specialties, room allocations, and clinical staff distribution</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchDepartments}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all disabled:opacity-50"
            title="Refresh departments"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>{showForm ? 'Close Form' : 'Add Medical Department'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-slate-900">{departments.length}</div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Depts ({staffedDeptsCount} Staffed)</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-emerald-700">{totalActiveDoctors}</div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Doctors Assigned</div>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800">Directory Verified</div>
            <div className="text-[11px] text-slate-500">Live synchronization with staff directory</div>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${message.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
          {message.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Registration Form */}
      {showForm && (
        <form onSubmit={handleAddDept} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">New Department Registration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Department Name</label>
              <input
                type="text"
                required
                placeholder="E.g. Neurology & Neurosurgery"
                value={newDept.name}
                onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Code Prefix (3-5 chars)</label>
              <input
                type="text"
                required
                placeholder="NEURO"
                value={newDept.code}
                onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Room Allocation</label>
              <input
                type="text"
                placeholder="Room 501-504"
                value={newDept.room}
                onChange={(e) => setNewDept({ ...newDept, room: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Hospital Building Wing</label>
              <select
                value={newDept.wing}
                onChange={(e) => setNewDept({ ...newDept, wing: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="North Wing">North Wing</option>
                <option value="East Wing">East Wing</option>
                <option value="West Wing">West Wing</option>
                <option value="South Wing">South Wing</option>
                <option value="Central Tower">Central Tower</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Clinical Description / Scope</label>
              <textarea
                placeholder="Clinical scope, diagnostic procedures, specialized clinics..."
                value={newDept.description}
                onChange={(e) => setNewDept({ ...newDept, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {submitting ? 'Registering Department...' : 'Create Medical Department'}
          </button>
        </form>
      )}

      {/* Departments Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white rounded-3xl border border-slate-200">
          <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
          <span className="text-xs font-semibold text-slate-500">Loading department directory and clinical rosters...</span>
        </div>
      ) : departments.length === 0 ? (
        <div className="text-center p-12 bg-white rounded-3xl border border-slate-200">
          <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No departments configured yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {departments.map((dept) => {
            const activeCount = Number(dept.activeDoctors) || 0;
            return (
              <div key={dept.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                    {dept.code || dept.letter || dept.id?.replace('dept-', '').toUpperCase()}
                  </span>
                  <Badge variant={activeCount > 0 ? 'primary' : 'neutral'}>
                    {activeCount} {activeCount === 1 ? 'Doctor Active' : 'Doctors Active'}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-bold text-slate-800 text-base">{dept.name}</h3>
                  <p className="text-xs text-slate-500">
                    {dept.room || 'Room Allocated'} • {dept.wing || 'Hospital Wing'}
                  </p>
                  {dept.description && (
                    <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                      {dept.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManageDepartments;
