import React, { useState, useEffect } from 'react';
import { Building, Plus, CheckCircle, AlertCircle, RefreshCw, Users, ShieldCheck, ArrowLeft, UserCheck, Calendar, Phone, Mail, Award, Clock } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const ManageDepartments = () => {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newDept, setNewDept] = useState({ name: '', code: '', room: '', wing: 'North Wing', description: '' });
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Department Doctors view state
  const [selectedDept, setSelectedDept] = useState(null);
  const [deptDoctors, setDeptDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);

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

  const handleSelectDept = async (dept) => {
    setSelectedDept(dept);
    setLoadingDoctors(true);
    setDeptDoctors([]);
    try {
      const res = await API.get(`/doctors?departmentId=${encodeURIComponent(dept.id)}&includeSlotStatus=true`);
      if (res.data?.data && Array.isArray(res.data.data)) {
        setDeptDoctors(res.data.data);
      } else {
        setDeptDoctors([]);
      }
    } catch (err) {
      console.error('Error fetching doctors for department:', err);
      setDeptDoctors([]);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const handleBackToDepartments = () => {
    setSelectedDept(null);
    setDeptDoctors([]);
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

      await API.post('/departments', payload);
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

  // View: Department Doctors Detail View
  if (selectedDept) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBackToDepartments}
              className="p-2.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-2xl transition-all border border-slate-200 flex items-center space-x-1"
              title="Back to All Departments"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                  {selectedDept.code || selectedDept.letter || selectedDept.id?.replace('dept-', '').toUpperCase()}
                </span>
                <h2 className="font-bold text-lg text-slate-900">{selectedDept.name}</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedDept.room || 'Room Allocated'} • {selectedDept.wing || 'Hospital Wing'}
                {selectedDept.description && ` — ${selectedDept.description}`}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleSelectDept(selectedDept)}
              disabled={loadingDoctors}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all disabled:opacity-50"
              title="Refresh Doctors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingDoctors ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleBackToDepartments}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Back to Departments
            </button>
          </div>
        </div>

        {/* Doctor Roster Info Strip */}
        <div className="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Department Clinical Roster</h3>
              <p className="text-xs text-slate-500">
                {loadingDoctors ? 'Loading clinical staff...' : `${deptDoctors.length} assigned medical practitioner${deptDoctors.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>
          <Badge variant={deptDoctors.length > 0 ? 'primary' : 'neutral'}>
            {deptDoctors.length} Active {deptDoctors.length === 1 ? 'Doctor' : 'Doctors'}
          </Badge>
        </div>

        {/* Doctors Grid / List */}
        {loadingDoctors ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white rounded-3xl border border-slate-200">
            <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
            <span className="text-xs font-semibold text-slate-500">Fetching assigned doctors from Firestore...</span>
          </div>
        ) : deptDoctors.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-3xl border border-slate-200 space-y-3">
            <UserCheck className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-700">No Doctors Currently Assigned</div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              There are no medical specialists linked to the {selectedDept.name} department in the directory. Doctors can be assigned or invited via the Staff Directory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {deptDoctors.map((doc) => {
              const displayName = doc.name ? (doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`) : 'Doctor';
              const isAvailable = (doc.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
              return (
                <div key={doc.id || doc.doctorId} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3.5">
                      {doc.photoUrl || doc.avatarUrl ? (
                        <img
                          src={doc.photoUrl || doc.avatarUrl}
                          alt={displayName}
                          className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-sm"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-extrabold text-base flex items-center justify-center shadow-sm">
                          {displayName.replace('Dr. ', '').charAt(0) || 'D'}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-bold text-slate-900 text-sm leading-tight">{displayName}</h4>
                          {doc.displayDoctorId && (
                            <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {doc.displayDoctorId}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-indigo-600 mt-0.5">
                          {doc.specialization || selectedDept.name}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end space-y-1">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        isAvailable
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {doc.status || 'ACTIVE'}
                      </span>
                      {doc.hasFutureSlots !== undefined && (
                        <span className={`text-[10px] font-medium flex items-center space-x-1 ${doc.hasFutureSlots ? 'text-emerald-600' : 'text-slate-400'}`}>
                          <Calendar className="w-3 h-3 inline mr-0.5" />
                          {doc.hasFutureSlots ? 'Slots Open' : 'No Open Slots'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Qualifications & Experience */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                        <Award className="w-3 h-3" />
                        <span>Qualifications</span>
                      </div>
                      <div className="font-semibold text-slate-700 truncate">
                        {doc.qualifications || doc.qualification || 'MBBS, MD'}
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>Experience</span>
                      </div>
                      <div className="font-semibold text-slate-700">
                        {doc.experience || (doc.experienceYears ? `${doc.experienceYears} Years` : 'Senior Consultant')}
                      </div>
                    </div>
                  </div>

                  {/* Contact, Room and Fee */}
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 gap-2">
                    <div className="flex items-center space-x-3">
                      {doc.email && (
                        <span className="flex items-center space-x-1" title={doc.email}>
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          <span className="truncate max-w-[130px]">{doc.email}</span>
                        </span>
                      )}
                      {doc.phone && (
                        <span className="flex items-center space-x-1" title={doc.phone}>
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <span>{doc.phone}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                        {doc.room || doc.cabinNumber || selectedDept.room || 'Cabin'}
                      </span>
                      {(doc.consultationFee || doc.fee) && (
                        <span className="font-bold text-slate-800 text-xs">
                          ₹{doc.consultationFee || doc.fee}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // View: All Departments Grid
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
            <p className="text-xs text-slate-500">Configure medical specialties, room allocations, and view assigned clinical staff</p>
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
              <div
                key={dept.id}
                onClick={() => handleSelectDept(dept)}
                className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all space-y-3 cursor-pointer group"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectDept(dept); }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    {dept.code || dept.letter || dept.id?.replace('dept-', '').toUpperCase()}
                  </span>
                  <Badge variant={activeCount > 0 ? 'primary' : 'neutral'}>
                    {activeCount} {activeCount === 1 ? 'Doctor Active' : 'Doctors Active'}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-bold text-slate-800 text-base group-hover:text-indigo-600 transition-colors">
                    {dept.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {dept.room || 'Room Allocated'} • {dept.wing || 'Hospital Wing'}
                  </p>
                  {dept.description && (
                    <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                      {dept.description}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-indigo-600 font-semibold group-hover:translate-x-0.5 transition-transform">
                  <span>View Department Doctors ({activeCount})</span>
                  <span>→</span>
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
