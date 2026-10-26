import React, { useState, useEffect } from 'react';
import { Clock, ShieldCheck, Activity, Users, AlertCircle, RefreshCw } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const QueueMonitor = () => {
  const [systemQueue, setSystemQueue] = useState([]);
  const [metrics, setMetrics] = useState({
    currentlyServing: 0,
    inWaitingLine: 0,
    systemAvgWaitMinutes: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLiveQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await API.get('/admin/live-queue');
      if (res.data?.data) {
        setSystemQueue(res.data.data.queue || []);
        setMetrics({
          currentlyServing: res.data.data.currentlyServing || 0,
          inWaitingLine: res.data.data.inWaitingLine || 0,
          systemAvgWaitMinutes: res.data.data.systemAvgWaitMinutes || 0
        });
      }
    } catch (err) {
      console.warn('Fetch live queue error:', err);
      setError(err.message || 'Failed to fetch live queue data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveQueue();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Live Queue & Wait Time Monitor</h2>
            <p className="text-xs text-slate-500">Real-time system-wide patient token status & priority score enforcement</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="warning">LIVE QUEUE MONITOR</Badge>
          <button
            onClick={fetchLiveQueue}
            disabled={loading}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
            title="Refresh Live Queue"
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Currently Serving</span>
          <span className="text-3xl font-extrabold text-teal-600 font-mono">
            {metrics.currentlyServing} Patients
          </span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">In Waiting Line</span>
          <span className="text-3xl font-extrabold text-amber-500 font-mono">
            {metrics.inWaitingLine} Patients
          </span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">System Avg Wait</span>
          <span className="text-3xl font-extrabold text-brand-600 font-mono">
            {metrics.systemAvgWaitMinutes > 0 ? `${metrics.systemAvgWaitMinutes} mins` : '0 mins'}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Live System Queue Token Status</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Token #</th>
                <th className="py-3 px-3">Department</th>
                <th className="py-3 px-3">Patient Health ID</th>
                <th className="py-3 px-3">Priority Category</th>
                <th className="py-3 px-3">Est. Wait</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-mono">
              {loading && systemQueue.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-brand-500" />
                    Checking live hospital queue...
                  </td>
                </tr>
              ) : systemQueue.length > 0 ? (
                systemQueue.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-800">{item.tokenNumber}</td>
                    <td className="py-3 px-3 font-sans font-semibold text-slate-700">{item.department}</td>
                    <td className="py-3 px-3 text-brand-700 font-bold">{item.patientHealthId}</td>
                    <td className="py-3 px-3">
                      <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border">
                        {item.priorityCategory} ({item.priorityScore})
                      </span>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-600">
                      {item.waitMin > 0 ? `~${item.waitMin} mins` : 'In Consultation'}
                    </td>
                    <td className="py-3 px-3 font-sans capitalize">
                      {['serving', 'in_room', 'called'].includes(item.status) && <Badge variant="warning">In Room</Badge>}
                      {item.status === 'waiting' && <Badge variant="info">Waiting</Badge>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400 font-sans italic">
                    No active patients in queue right now. The waiting area is currently clear.
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

export default QueueMonitor;
