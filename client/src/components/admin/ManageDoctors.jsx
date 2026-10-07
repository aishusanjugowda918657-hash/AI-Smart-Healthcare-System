import React, { useState, useEffect } from 'react';
import { Users, Plus, Stethoscope, CheckCircle, ShieldCheck, Building } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const ManageDoctors = () => {
  const [doctors, setDoctors] = useState([
    { doctorUid: 'doc-uid-001', doctorId: 'DOC-001', fullName: 'Dr. Sarah Smith', departmentId: 'dept-card', departmentName: 'Cardiology', qualification: 'MD (Cardiology)', fee: 150, status: 'active' },
    { doctorUid: 'doc-uid-002', doctorId: 'DOC-002', fullName: 'Dr. James Wilson', departmentId: 'dept-gen', departmentName: 'General Medicine', qualification: 'MD (Gen Med)', fee: 100, status: 'active' },
    { doctorUid: 'doc-uid-003', doctorId: 'DOC-003', fullName: 'Dr. Emily Brown', departmentId: 'dept-ped', departmentName: 'Pediatrics', qualification: 'MD (Pediatrics)', fee: 120, status: 'active' }
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    departmentId: 'dept-gen',
    qualification: '',
    fee: '100',
    email: ''
  });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchDoctors();
  }, []);

  const fetchDoctors = async () => {
    try {
      const res = await API.get('/doctors?includeSlotStatus=true');
      if (res.data?.data && res.data.data.length > 0) {
        setDoctors(res.data.data);
      }
    } catch (err) {
      console.warn('Fetch doctors fallback:', err.message);
    }
  };

  const handleGenerateSlots = async (doctorId) => {
    try {
      await API.post('/admin/slots/generate', { doctorId, daysAhead: 14 });
      setMessage({ type: 'success', text: `Generated slots for 14 days successfully!` });
      fetchDoctors();
    } catch (err) {
      console.error('Failed to generate slots:', err);
      setMessage({ type: 'error', text: 'Failed to generate slots.' });
    }
  };

  const handleAddDoctor = (e) => {
    e.preventDefault();
    const newDoc = {
      doctorUid: `doc-uid-${Date.now()}`,
      doctorId: `DOC-00${doctors.length + 1}`,
      fullName: formData.fullName,
      departmentId: formData.departmentId,
      departmentName: formData.departmentId === 'dept-card' ? 'Cardiology' : formData.departmentId === 'dept-ped' ? 'Pediatrics' : 'General Medicine',
      qualification: formData.qualification,
      fee: Number(formData.fee),
      status: 'active',
      hasFutureSlots: false
    };

    setDoctors([...doctors, newDoc]);
    setMessage({ type: 'success', text: `Doctor ${formData.fullName} onboarded successfully!` });
    setShowAddForm(false);
    setFormData({ fullName: '', departmentId: 'dept-gen', qualification: '', fee: '100', email: '' });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Doctor Onboarding & Clinical Staff Directory</h2>
            <p className="text-xs text-slate-500">Manage physician profiles, qualifications, and department assignments</p>
          </div>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>{showAddForm ? 'Close Form' : 'Onboard New Doctor'}</span>
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${message.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

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
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Department</label>
              <select
                value={formData.departmentId}
                onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              >
                <option value="dept-gen">General Medicine</option>
                <option value="dept-card">Cardiology</option>
                <option value="dept-ped">Pediatrics</option>
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
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Consultation Fee ($)</label>
              <input
                type="number"
                required
                value={formData.fee}
                onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Experience (Years)</label>
              <input
                type="number"
                value={formData.experienceYears}
                onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Specialties (comma-separated)</label>
              <input
                type="text"
                value={formData.specialties}
                onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Languages (comma-separated)</label>
              <input
                type="text"
                value={formData.languages}
                onChange={(e) => setFormData({ ...formData, languages: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Age Groups (comma-separated)</label>
              <input
                type="text"
                value={formData.ageGroups}
                onChange={(e) => setFormData({ ...formData, ageGroups: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                rows={2}
              ></textarea>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {doctors.map((doc) => (
          <div key={doc.doctorId || doc.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-full border border-brand-200">
                {doc.doctorId || doc.id}
              </span>
              <Badge variant="success">ACTIVE</Badge>
            </div>

            <div>
              <h3 className="font-bold text-slate-800 text-sm">{doc.name || doc.fullName}</h3>
              <p className="text-xs text-slate-500">{doc.qualification}</p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-600 flex items-center">
                <Building className="w-3.5 h-3.5 mr-1 text-slate-400" />
                {doc.departmentName || doc.departmentId}
              </span>
              <span className="font-bold text-emerald-600">${doc.fee || 100} / visit</span>
            </div>

            {doc.hasFutureSlots === false && (
              <div className="mt-2 p-2 bg-red-50 text-red-700 text-xs font-semibold rounded border border-red-200">
                Warning: {doc.name || doc.fullName} has no future slots
              </div>
            )}

            <button
              onClick={() => handleGenerateSlots(doc.doctorId || doc.id)}
              className="mt-2 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Generate slots (next 14 days)
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ManageDoctors;
