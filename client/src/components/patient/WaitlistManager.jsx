import React, { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, CheckCircle, Calendar } from 'lucide-react';
import API from '../../services/api';

export const WaitlistManager = ({ departmentId, doctorId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  const fetchEntries = async () => {
    try {
      const res = await API.get('/waitlist/my-entries');
      setEntries(res.data.entries || []);
    } catch (err) {
      console.warn('Fetch waitlist entries error:', err.message);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const handleJoin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await API.post('/waitlist', {
        departmentId: departmentId || 'dept-gen',
        doctorId: doctorId || null,
        dateFrom,
        dateTo
      });
      alert('Successfully joined the waiting list! We will notify you when a slot opens.');
      setShowForm(false);
      fetchEntries();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to join waitlist.');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async (id) => {
    try {
      await API.delete(`/waitlist/${id}`);
      fetchEntries();
    } catch (err) {
      alert('Failed to leave waitlist.');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900">Waiting List Auto-Fill</h4>
            <p className="text-xs text-slate-500">Get notified immediately when a slot opens</p>
          </div>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center space-x-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Join Waitlist</span>
        </button>
      </div>

      {/* Form Overlay */}
      {showForm && (
        <form onSubmit={handleJoin} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
          <div className="font-bold text-slate-900">Register Waitlist Preference:</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-600 block mb-1">From Date:</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-xl outline-none"
                required
              />
            </div>
            <div>
              <label className="text-slate-600 block mb-1">To Date:</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-xl outline-none"
                required
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 bg-teal-600 text-white font-bold rounded-xl text-xs disabled:opacity-50"
            >
              Confirm Registration
            </button>
          </div>
        </form>
      )}

      {/* Active Waitlist Entries */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-700">Active Waitlist Requests:</div>
          <div className="space-y-2">
            {entries.map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    <span>{item.dateFrom} to {item.dateTo}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Status: <span className="font-bold text-teal-700 uppercase">{item.status}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleLeave(item.id)}
                  className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                  title="Remove from waitlist"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WaitlistManager;
