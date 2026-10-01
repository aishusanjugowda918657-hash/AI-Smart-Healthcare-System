import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Calendar, Heart, Shield, Loader2, AlertCircle, CheckCircle2, QrCode, X, Trash2 } from 'lucide-react';
import API from '../../services/api';
import HealthIdCard from './HealthIdCard';

export const FamilyMembersManager = () => {
  const [familyMembers, setFamilyMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState('');
  const [formError, setFormError] = useState('');

  // Selected dependent for viewing Health ID Card
  const [selectedDependent, setSelectedDependent] = useState(null);

  const [formData, setFormData] = useState({
    fullName: '',
    dob: '',
    gender: 'male',
    relationship: 'Son',
    customRelationship: ''
  });

  const relationshipOptions = [
    'Father',
    'Mother',
    'Husband',
    'Wife',
    'Son',
    'Daughter',
    'Brother',
    'Sister',
    'Grandfather',
    'Grandmother',
    'Other'
  ];

  useEffect(() => {
    fetchFamilyMembers();
  }, []);

  const fetchFamilyMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await API.get('/patients/family');
      if (res.data && res.data.success) {
        setFamilyMembers(res.data.data || []);
      }
    } catch (err) {
      console.warn('⚠️ Error fetching family members:', err.message);
      setError('Unable to load family members. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!formData.fullName.trim() || !formData.dob || !formData.gender || !formData.relationship) {
      setFormError('Please fill in all mandatory fields (Full Name, DOB, Gender, Relationship).');
      return;
    }

    if (formData.relationship === 'Other' && !formData.customRelationship.trim()) {
      setFormError('Please specify the custom relationship.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await API.post('/patients/family', formData);
      if (res.data && res.data.success) {
        setFormSuccess(`Family member ${formData.fullName} added successfully with Health ID ${res.data.data?.patientHealthId}.`);
        setFormData({
          fullName: '',
          dob: '',
          gender: 'male',
          relationship: 'Son',
          customRelationship: ''
        });
        setTimeout(() => {
          setShowAddModal(false);
          setFormSuccess('');
          fetchFamilyMembers();
        }, 1500);
      }
    } catch (err) {
      console.error('Error adding family member:', err.message);
      const msg = err.response?.data?.message || err.message || 'Failed to add family member.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (memberId, memberName) => {
    if (!window.confirm(`Are you sure you want to remove ${memberName}?`)) return;
    try {
      await API.delete(`/patients/family/${memberId}`);
      fetchFamilyMembers();
    } catch (err) {
      console.error('Error removing family member:', err.message);
      alert(err.response?.data?.message || 'Failed to remove family member.');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Family Members &amp; Dependents</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your family's unique Health IDs and book appointments on their behalf.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Family Member</span>
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-8 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
          <p className="text-xs font-semibold text-slate-600">Loading family members...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && familyMembers.length === 0 && (
        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-6 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No family members registered yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Add your family members (parents, spouse, children) to generate individual unique Health IDs and book appointments for them.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all inline-flex items-center space-x-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Dependent Now</span>
          </button>
        </div>
      )}

      {/* Family Members Grid */}
      {!loading && !error && familyMembers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {familyMembers.map((member) => (
            <div
              key={member.patientUid || member.patientHealthId}
              className="bg-slate-50 hover:bg-indigo-50/40 border border-slate-200/90 rounded-2xl p-4 shadow-xs transition-all flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 uppercase tracking-wider mb-1">
                      {member.relationship}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900">{member.fullName}</h4>
                  </div>
                  <button
                    onClick={() => handleDeleteMember(member.patientUid, member.fullName)}
                    title="Remove Family Member"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1 text-xs text-slate-600 font-medium">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Health ID:</span>
                    <span className="font-mono font-bold text-teal-600">{member.patientHealthId}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/60">
                    <span>
                      DOB: <strong className="text-slate-800">{member.dob}</strong>
                    </span>
                    <span>
                      Age: <strong className="text-slate-800">{member.age || 'N/A'}</strong>
                    </span>
                    <span className="capitalize">
                      Gender: <strong className="text-slate-800">{member.gender}</strong>
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedDependent(member)}
                className="w-full py-2 bg-white hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 text-xs font-bold rounded-xl transition-colors flex items-center justify-center space-x-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>View Digital Health Card</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Family Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5 relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-slate-700 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                <UserPlus className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-900">Add Family Member / Dependent</h3>
                <p className="text-xs text-slate-500">Auto-generates a unique National Health ID</p>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  name="fullName"
                  required
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="e.g. Ramesh Sharma"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    name="dob"
                    required
                    value={formData.dob}
                    onChange={handleInputChange}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Gender *
                  </label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Relationship *
                </label>
                <select
                  name="relationship"
                  value={formData.relationship}
                  onChange={handleInputChange}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  {relationshipOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {formData.relationship === 'Other' && (
                <div>
                  <label className="block text-xs font-bold text-indigo-700 uppercase tracking-wider mb-1">
                    Specify Relationship *
                  </label>
                  <input
                    type="text"
                    name="customRelationship"
                    required
                    value={formData.customRelationship}
                    onChange={handleInputChange}
                    placeholder="e.g. Guardian, Cousin, Uncle..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-indigo-300 bg-indigo-50/50 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Add Dependent &amp; Generate Health ID</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dependent Health ID Card Modal */}
      {selectedDependent && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 rounded-3xl max-w-xl w-full p-2 relative border border-slate-700 shadow-2xl">
            <button
              onClick={() => setSelectedDependent(null)}
              className="absolute top-4 right-4 z-10 p-2 text-slate-300 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <HealthIdCard patient={selectedDependent} />
          </div>
        </div>
      )}
    </div>
  );
};

export default FamilyMembersManager;
