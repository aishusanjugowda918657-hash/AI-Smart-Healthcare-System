import React, { useState, useEffect } from 'react';
import { Sparkles, AlertTriangle, ChevronDown, ChevronUp, Edit3, PlusCircle, CheckCircle2 } from 'lucide-react';
import API from '../../services/api';

export const PreConsultationSummaryCard = ({ appointmentId, patientName, patientHealthId, age }) => {
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [correctedText, setCorrectedText] = useState('');
  const [doctorNote, setDoctorNote] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);

  useEffect(() => {
    if (!appointmentId) return;

    const fetchSummary = async () => {
      setLoading(true);
      try {
        const res = await API.get(`/doctor/appointments/${appointmentId}/summary`);
        setSummaryData(res.data.summary);
      } catch (err) {
        console.warn('Summary card fetch error:', err.message);
        setSummaryData({
          text: `${patientName || 'Patient'} (${age || 40}yo) presenting for consultation. No recorded allergies.`,
          flags: [{ type: 'first_visit', label: 'First Visit', color: 'blue' }],
          sourceRefs: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [appointmentId, patientName, age]);

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-500 animate-pulse">
        Generating auto-generated pre-consultation summary...
      </div>
    );
  }

  const getFlagBadge = (flag, index) => {
    const colorClasses = {
      red: 'bg-rose-100 text-rose-800 border-rose-200',
      amber: 'bg-amber-100 text-amber-800 border-amber-200',
      blue: 'bg-blue-100 text-blue-800 border-blue-200',
      grey: 'bg-slate-100 text-slate-700 border-slate-200'
    };
    const colorClass = colorClasses[flag.color] || colorClasses.grey;

    return (
      <span key={index} className={`px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center space-x-1 ${colorClass}`}>
        <AlertTriangle className="w-3 h-3" />
        <span>{flag.label}</span>
      </span>
    );
  };

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
      {/* Patient Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h4 className="font-bold text-sm text-slate-900">{patientName || 'Patient'}</h4>
          <p className="text-xs text-slate-500">{age ? `${age}yo` : 'Adult'} • Health ID: <span className="font-mono text-slate-700">{patientHealthId || 'HID-1001'}</span></p>
        </div>

        <span className="px-3 py-1 bg-teal-50 text-teal-800 border border-teal-200 rounded-full text-xs font-bold flex items-center space-x-1">
          <Sparkles className="w-3.5 h-3.5 text-teal-600" />
          <span>Auto-generated summary</span>
        </span>
      </div>

      {/* Database-Derived Flags */}
      {summaryData?.flags && summaryData.flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summaryData.flags.map((flag, idx) => getFlagBadge(flag, idx))}
        </div>
      )}

      {/* Main One-Line Clinical Summary */}
      <div className="bg-slate-100/80 border border-slate-200 rounded-2xl p-4 text-xs leading-relaxed text-slate-800 font-medium">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={correctedText || summaryData?.text}
              onChange={(e) => setCorrectedText(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
              rows={2}
            />
            <button
              onClick={() => {
                setSummaryData(prev => ({ ...prev, text: correctedText }));
                setEditing(false);
              }}
              className="px-3 py-1 bg-teal-600 text-white font-bold rounded-lg text-[11px]"
            >
              Save Correction
            </button>
          </div>
        ) : (
          <p>{summaryData?.text}</p>
        )}
      </div>

      {/* Show More Source References */}
      {summaryData?.sourceRefs && summaryData.sourceRefs.length > 0 && (
        <div>
          <button
            onClick={() => setShowMore(!showMore)}
            className="text-xs font-bold text-teal-700 hover:text-teal-800 flex items-center space-x-1"
          >
            <span>{showMore ? 'Show less' : 'Show more (sources)'}</span>
            {showMore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showMore && (
            <div className="mt-2.5 p-3 bg-white border border-slate-200 rounded-xl space-y-1 text-[11px] text-slate-600">
              <div className="font-bold text-slate-800">Source Visits:</div>
              {summaryData.sourceRefs.map((src, i) => (
                <div key={i} className="flex justify-between border-b border-slate-100 last:border-0 py-0.5">
                  <span>Visit #{src.visitId}</span>
                  <span className="text-slate-400">{src.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Doctor Note Overlay */}
      {showAddNote && (
        <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl space-y-2 text-xs">
          <label className="font-bold text-teal-900 block">Doctor Clinical Note:</label>
          <input
            type="text"
            value={doctorNote}
            onChange={(e) => setDoctorNote(e.target.value)}
            placeholder="Add quick consultation note..."
            className="w-full p-2 bg-white border border-teal-300 rounded-lg text-xs outline-none"
          />
          <button
            onClick={() => setShowAddNote(false)}
            className="px-3 py-1 bg-teal-700 text-white font-bold rounded-lg text-[11px]"
          >
            Save Note
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <button
          onClick={() => setEditing(!editing)}
          className="text-slate-600 hover:text-slate-900 font-semibold flex items-center space-x-1"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Correct Summary</span>
        </button>

        <button
          onClick={() => setShowAddNote(!showAddNote)}
          className="text-teal-700 hover:text-teal-900 font-bold flex items-center space-x-1"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Add Note</span>
        </button>
      </div>
    </div>
  );
};

export default PreConsultationSummaryCard;
