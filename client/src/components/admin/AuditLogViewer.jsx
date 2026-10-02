import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, Search, Lock } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const AuditLogViewer = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/audit-logs');
      if (res.data?.data) {
        setLogs(res.data.data);
      }
    } catch (err) {
      console.warn('Audit log fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    const q = search.toLowerCase();
    return (
      (log.action && log.action.toLowerCase().includes(q)) ||
      (log.actorRole && log.actorRole.toLowerCase().includes(q)) ||
      (log.targetId && log.targetId.toLowerCase().includes(q)) ||
      (log.actorUid && log.actorUid.toLowerCase().includes(q))
    );
  });

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4" id="audit-log-viewer">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-base flex items-center space-x-2">
            <Lock className="w-5 h-5 text-indigo-600" />
            <span>Healthcare System Audit & Security Trail</span>
          </h3>
          <p className="text-xs text-slate-500">Immutable audit records of user role changes, medical data access & overrides</p>
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search action, role, target..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-3">Timestamp</th>
              <th className="py-3 px-3">Actor / Role</th>
              <th className="py-3 px-3">Action</th>
              <th className="py-3 px-3">Target Resource</th>
              <th className="py-3 px-3">Request ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs font-mono">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <tr key={log.id || log.timestamp} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just now'}
                  </td>
                  <td className="py-3 px-3">
                    <span className="font-bold text-slate-800">{log.actorUid || log.actor || 'system'}</span>
                    <Badge variant="secondary" className="ml-2 uppercase">{log.actorRole || log.userRole || 'admin'}</Badge>
                  </td>
                  <td className="py-3 px-3 font-bold text-indigo-600">{log.action}</td>
                  <td className="py-3 px-3 text-slate-600">{log.targetId || log.resourceId || '-'}</td>
                  <td className="py-3 px-3 text-slate-400 font-mono text-[10px]">{log.requestId || 'req-auto'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-400 italic">
                  {loading ? 'Fetching security logs...' : 'No matching audit records found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLogViewer;
