import React, { useState, useEffect } from 'react';
import { Database, AlertTriangle, Pill, Clock, Activity, ShieldAlert, FileText } from 'lucide-react';
import API from '../../services/api';

export const ClinicalListsViewer = () => {
  const [activeTab, setActiveTab] = useState('redflags');
  const [clinicalData, setClinicalData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchClinicalLists = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/clinical-lists');
      if (res.data?.data) {
        setClinicalData(res.data.data);
      }
    } catch (err) {
      console.warn('Clinical lists fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClinicalLists();
  }, []);

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-6" id="clinical-lists-viewer">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-base flex items-center space-x-2">
            <Database className="w-5 h-5 text-brand-600" />
            <span>Read-Only Clinical Reference Datasets</span>
          </h3>
          <p className="text-xs text-slate-500">Demo clinical knowledge base configured in server JSON files</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 border-b border-slate-100">
        {[
          { id: 'redflags', label: 'Red Flags Triage', icon: AlertTriangle },
          { id: 'followupIntervals', label: 'Follow-up Intervals', icon: Clock },
          { id: 'medicines', label: 'Medicines Catalog', icon: Pill },
          { id: 'interactions', label: 'Drug Interactions', icon: ShieldAlert },
          { id: 'doseRanges', label: 'Dose Range Limits', icon: Activity }
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Demo Notice Banner */}
      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold block">DEMO DATASET NOTICE:</span>
          <span>
            {clinicalData?.[activeTab]?._notice ||
              'These datasets ship as clearly labelled demo data in server/src/config/clinical/*.json and must be reviewed by a certified clinician before production use.'}
          </span>
        </div>
      </div>

      {/* Tab Content Display */}
      <div className="bg-slate-900 rounded-2xl p-4 text-slate-200 font-mono text-xs overflow-x-auto max-h-96">
        <pre>{JSON.stringify(clinicalData?.[activeTab] || { loading: true }, null, 2)}</pre>
      </div>
    </div>
  );
};

export default ClinicalListsViewer;
