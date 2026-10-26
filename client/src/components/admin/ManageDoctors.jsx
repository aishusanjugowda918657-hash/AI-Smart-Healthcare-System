import React, { useState, useEffect } from 'react';
import { Users, Plus, Stethoscope, CheckCircle, AlertCircle, ShieldCheck, Building, RefreshCw } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';
import { generateClientDoctorDisplayId } from '../../utils/doctorDisplayId';

export const ManageDoctors = () => {
  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    departmentId: 'dept-gen',
    qualification: '',
    fee: '100',
    email: '',
    experienceYears: '',
    specialties: '',
    languages: 'English',
    ageGroups: 'Adults',
    bio: ''
  });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchDoctors();
    fetchDepartments();
  }, []);

  const fetchDoctors = async () => {
    try {
      setLoading(true);
      const res = await API.get('/doctors?includeSlotStatus=true');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setDoctors(res.data.data);
      }
    } catch (err) {
      console.warn('Fetch doctors fallback:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await API.get('/departments');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setDepartments(res.data.data);
        if (res.data.data.length > 0 && !formData.departmentId) {
          setFormData((prev) => ({ ...prev, departmentId: res.data.data[0].id }));
        }
      }
    } catch (_) {}
  };

  const deptMap = {};
  departments.forEach((d) => {
    deptMap[d.id] = d.name;
  });

  const handleGenerateSlots = async (doctorId) => {
    try {
      await API.post('/admin/slots/generate', { doctorId, daysAhead: 14 });
      setMessage({ type: 'success', text: `Generated slots for 14 days successfully!` });
      await fetchDoctors();
    } catch (err) {
      console.error('Failed to generate slots:', err);
      setMessage({ type: 'error', text: 'Failed to generate slots.' });
    }
  };

  const handleAddDoctor = (e) => {
    e.preventDefault();
    const resolvedDeptName = deptMap[formData.departmentId] || 'General Medicine';
    const displayId = generateClientDoctorDisplayId(
      { fullName: formData.fullName, departmentId: formData.departmentId, departmentName: resolvedDeptName },
      doctors
    );
    const newDoc = {
      doctorUid: `doc-uid-${Date.now()}`,
      doctorId: `DOC-00${doctors.length + 1}`,
      displayId: displayId,
      doctorDisplayId: displayId,
      fullName: formData.fullName,
      name: formData.fullName,
      departmentId: formData.departmentId,
      departmentName: resolvedDeptName,
      qualification: formData.qualification,
      fee: Number(formData.fee),
      status: 'ACTIVE',
      hasFutureSlots: false
    };

    setDoctors([newDoc, ...doctors]);
    setMessage({ type: 'success', text: `Doctor ${formData.fullName} added to local directory view!` });
    setShowAddForm(false);
    setFormData({
      fullName: '',
      departmentId: departments[0]?.id || 'dept-gen',
      qualification: '',
      fee: '100',
      email: '',
      experienceYears: '',
      specialties: '',
      languages: 'English',
      ageGroups: 'Adults',
      bio: ''
    });
  };

  const activeDoctorsCount = doctors.filter((d) => {
    const s = String(d.status || 'ACTIVE').toLowerCase();
    return s !== 'inactive' && s !== 'disabled';
  }).length;

  const totalDeptsCovered = new Set(doctors.map((d) => d.departmentId).filter(Boolean)).size;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Doctor Onboarding & Clinical Staff Directory</h2>
            <p className="text-xs text-slate-500">Manage physician profiles, qualifications, and department assignments</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchDoctors}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all disabled:opacity-50"
            title="Refresh directory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>{showAddForm ? 'Close Form' : 'Onboard New Doctor'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-slate-900">{doctors.length}</div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Clinical Staff Total</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-emerald-700">{activeDoctorsCount}</div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Staff Profiles</div>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-indigo-700">
              {totalDeptsCovered} <span className="text-sm font-semibold text-slate-400">/ {departments.length || 10}</span>
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Departments Staffed</div>
          </div>
        </div>
      </div>

      {/* Feedback Messages */}
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

      {/* Onboarding Form */}
      {showAddForm && (
        <form onSubmit={handleAddDoctor} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">New Physician Onboarding</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                placeholder="Dr. Full Name"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Department</label>
              <select
                value={formData.departmentId}
                onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              >
                {departments.length > 0 ? (
                  departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code || d.id?.replace('dept-', '').toUpperCase()})
                    </option>
                  ))
                ) : (
                  <>
                    <option value="dept-gen">General Medicine</option>
                    <option value="dept-card">Cardiology</option>
                    <option value="dept-ortho">Orthopaedics</option>
                    <option value="dept-ped">Pediatrics</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Qualification</label>
              <input
                type="text"
                required
                placeholder="MD, MBBS, MS..."
                value={formData.qualification}
                onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Consultation Fee ($)</label>
              <input
                type="number"
                required
                value={formData.fee}
                onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Experience (Years)</label>
              <input
                type="number"
                value={formData.experienceYears}
                onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Specialties (comma-separated)</label>
              <input
                type="text"
                placeholder="E.g. Hypertension, Heart Failure"
                value={formData.specialties}
                onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all"
          >
            Submit Physician Onboarding
          </button>
        </form>
      )}

      {/* Doctors Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white rounded-3xl border border-slate-200">
          <RefreshCw className="w-6 h-6 text-brand-600 animate-spin" />
          <span className="text-xs font-semibold text-slate-500">Loading clinical staff directory...</span>
        </div>
      ) : doctors.length === 0 ? (
        <div className="text-center p-12 bg-white rounded-3xl border border-slate-200">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No doctors registered in the clinical directory yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {doctors.map((doc) => {
            const isInactive = doc.status?.toLowerCase() === 'inactive' || doc.status?.toLowerCase() === 'disabled';
            const deptDisplay = doc.departmentName || deptMap[doc.departmentId] || doc.departmentId || 'General';

            return (
              <div key={doc.doctorId || doc.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-full border border-brand-200">
                      {doc.displayId || doc.doctorId || doc.id}
                    </span>
                    <Badge variant={isInactive ? 'danger' : 'success'}>
                      {isInactive ? 'INACTIVE' : 'ACTIVE'}
                    </Badge>
                  </div>

                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">{doc.name || doc.fullName}</h3>
                    <p className="text-xs text-slate-500">{doc.qualification || 'Medical Practitioner'}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-600 flex items-center">
                      <Building className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      {deptDisplay}
                    </span>
                    <span className="font-bold text-emerald-600">${doc.fee || 100} / visit</span>
                  </div>

                  {doc.hasFutureSlots === false && (
                    <div className="mt-2 p-2 bg-amber-50 text-amber-800 text-[11px] font-semibold rounded-xl border border-amber-200">
                      Notice: No future appointment slots generated
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleGenerateSlots(doc.doctorId || doc.id)}
                  className="mt-2 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
                >
                  Generate slots (next 14 days)
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManageDoctors;
