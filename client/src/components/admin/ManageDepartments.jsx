import React, { useState } from 'react';
import { Building, Plus, CheckCircle, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';

export const ManageDepartments = () => {
  const [departments, setDepartments] = useState([
    { id: 'dept-gen', name: 'General Medicine', code: 'GEN', room: 'Room 101-104', wing: 'North Wing', activeDoctors: 3 },
    { id: 'dept-card', name: 'Cardiology', code: 'CARD', room: 'Room 201-205', wing: 'East Wing', activeDoctors: 2 },
    { id: 'dept-ped', name: 'Pediatrics', code: 'PED', room: 'Room 301-303', wing: 'West Wing', activeDoctors: 2 },
    { id: 'dept-derm', name: 'Dermatology', code: 'DERM', room: 'Room 401-402', wing: 'South Wing', activeDoctors: 1 }
  ]);

  const [showForm, setShowForm] = useState(false);
  const [newDept, setNewDept] = useState({ name: '', code: '', room: '', wing: 'North Wing' });
  const [message, setMessage] = useState(null);

  const handleAddDept = (e) => {
    e.preventDefault();
    const created = {
      id: `dept-${Date.now()}`,
      name: newDept.name,
      code: newDept.code.toUpperCase(),
      room: newDept.room || 'Room 501',
      wing: newDept.wing,
      activeDoctors: 1
    };
    setDepartments([...departments, created]);
    setMessage({ type: 'success', text: `Department ${newDept.name} (${newDept.code}) added!` });
    setShowForm(false);
    setNewDept({ name: '', code: '', room: '', wing: 'North Wing' });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Medical Departments & Wings</h2>
            <p className="text-xs text-slate-500">Configure medical specialties, room allocations, and department codes</p>
          </div>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>{showForm ? 'Close Form' : 'Add Medical Department'}</span>
        </button>
      </div>

      {message && (
        <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-xs font-semibold flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleAddDept} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">New Department Registration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Department Name</label>
              <input
                type="text"
                required
                placeholder="E.g. Neurology"
                value={newDept.name}
                onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Code Prefix (3-4 chars)</label>
              <input
                type="text"
                required
                placeholder="NEURO"
                value={newDept.code}
                onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Room Allocation</label>
              <input
                type="text"
                placeholder="Room 501-504"
                value={newDept.room}
                onChange={(e) => setNewDept({ ...newDept, room: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Hospital Building Wing</label>
              <select
                value={newDept.wing}
                onChange={(e) => setNewDept({ ...newDept, wing: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              >
                <option value="North Wing">North Wing</option>
                <option value="East Wing">East Wing</option>
                <option value="West Wing">West Wing</option>
                <option value="South Wing">South Wing</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all"
          >
            Create Medical Department
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {departments.map((dept) => (
          <div key={dept.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                {dept.code}
              </span>
              <Badge variant="primary">{dept.activeDoctors} Doctors Active</Badge>
            </div>

            <div>
              <h3 className="font-bold text-slate-800 text-base">{dept.name}</h3>
              <p className="text-xs text-slate-500">{dept.room} • {dept.wing}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ManageDepartments;
