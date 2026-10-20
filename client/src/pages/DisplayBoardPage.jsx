import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Public Display Board Page (PRD F6 & Section 12)
 * Full-screen public display board for hospital waiting rooms.
 * Shows ONLY token labels (e.g., G-014), room numbers, and status.
 * CRITICAL PRIVACY RULE: NEVER displays patient names, ages, or diagnoses.
 */
export default function DisplayBoardPage({ departmentId: propDeptId }) {
  const params = useParams();
  const departmentId = params?.department || params?.departmentId || propDeptId || 'dept-card';
  const [boardData, setBoardData] = useState({ nowServing: [], nextTokens: [] });
  const [loading, setLoading] = useState(true);

  const fetchBoard = async () => {
    try {
      const res = await fetch(`/api/display/${departmentId}`);
      const json = await res.json();
      if (json.success) {
        setBoardData(json.data);
      }
    } catch (err) {
      console.error('Display board fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 5000); // 5-second refresh for live board
    return () => clearInterval(interval);
  }, [departmentId]);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 flex flex-col justify-between">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-4xl font-black text-indigo-400 tracking-wider">HOSPITAL QUEUE DISPLAY</h1>
          <p className="text-slate-400 text-lg mt-1">Department ID: {departmentId.toUpperCase()} | Live Token Calls</p>
        </div>
        <div className="text-right">
          <span className="px-4 py-2 bg-emerald-500/20 text-emerald-400 font-bold text-sm rounded-full border border-emerald-500/30 animate-pulse">
            LIVE BOARD ACTIVE
          </span>
        </div>
      </div>

      {/* Main Board Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-8 flex-1">
        {/* NOW SERVING SECTION */}
        <div className="bg-slate-900/80 border border-slate-800 p-8 rounded-3xl flex flex-col">
          <h2 className="text-2xl font-black text-emerald-400 tracking-wider uppercase mb-6 flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-emerald-500 animate-ping"></span>
            NOW SERVING
          </h2>

          {boardData.nowServing.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-2xl font-medium">
              No consultations currently active
            </div>
          ) : (
            <div className="space-y-6 flex-1">
              {boardData.nowServing.map((item, idx) => (
                <div key={idx} className="bg-slate-800/90 border border-emerald-500/40 p-6 rounded-2xl flex items-center justify-between shadow-2xl">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">TOKEN NUMBER</span>
                    <span className="text-6xl font-black text-emerald-300 tracking-tight">{item.tokenLabel}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">LOCATION</span>
                    <span className="text-3xl font-extrabold text-white">{item.room || 'Room 1'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* NEXT TOKENS SECTION */}
        <div className="bg-slate-900/80 border border-slate-800 p-8 rounded-3xl flex flex-col">
          <h2 className="text-2xl font-black text-indigo-400 tracking-wider uppercase mb-6">
            PREPARE TO ENTER (NEXT)
          </h2>

          {boardData.nextTokens.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-2xl font-medium">
              No patients waiting
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {boardData.nextTokens.map((item, idx) => (
                <div key={idx} className="bg-slate-800/60 border border-slate-700/80 p-5 rounded-xl flex items-center justify-between">
                  <span className="text-3xl font-black text-white">{item.tokenLabel}</span>
                  <span className="text-xs font-bold px-2.5 py-1 bg-slate-700 text-slate-300 rounded uppercase">
                    #{idx + 1} NEXT
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Notice */}
      <div className="border-t border-slate-800 pt-4 text-center text-slate-500 text-sm">
        Please proceed to your assigned room immediately when your token is displayed.
      </div>
    </div>
  );
}
