import React, { useState, useEffect } from 'react';
import { Database, AlertTriangle, Pill, Clock, Activity, ShieldAlert, Code2, LayoutGrid, CheckCircle } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const ClinicalListsViewer = () => {
  const [activeTab, setActiveTab] = useState('redflags');
  const [viewMode, setViewMode] = useState('formatted'); // 'formatted' | 'raw'
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

  const currentDataset = clinicalData?.[activeTab];

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-6" id="clinical-lists-viewer">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-base flex items-center space-x-2">
            <Database className="w-5 h-5 text-brand-600" />
            <span>Read-Only Clinical Reference Datasets</span>
          </h3>
          <p className="text-xs text-slate-500">
            Pre-configured medical knowledge bases used by AI triage, drug safety validation, and clinical protocols
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setViewMode('formatted')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              viewMode === 'formatted'
                ? 'bg-white text-brand-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Visual Cards</span>
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              viewMode === 'raw'
                ? 'bg-white text-brand-700 shadow-sm font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Raw JSON</span>
          </button>
        </div>
      </div>

      {/* Dataset Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 border-b border-slate-100">
        {[
          { id: 'redflags', label: 'Red Flags Triage', icon: AlertTriangle, desc: 'Emergency symptom triggers' },
          { id: 'medicines', label: 'Medicines Catalog', icon: Pill, desc: 'Approved formulary' },
          { id: 'interactions', label: 'Drug Interactions', icon: ShieldAlert, desc: 'Contraindications' },
          { id: 'doseRanges', label: 'Dose Range Limits', icon: Activity, desc: 'Safe limits' },
          { id: 'followupIntervals', label: 'Follow-up Intervals', icon: Clock, desc: 'Recall periods' }
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 whitespace-nowrap ${
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

      {/* Notice Banner */}
      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs flex items-start space-x-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold block">Medical Reference Notice:</span>
          <span>
            {currentDataset?._notice ||
              'These reference rules are pre-configured in the server knowledge base. They guide automated safety checks and clinical decision support.'}
          </span>
        </div>
      </div>

      {/* Visual / Formatted Cards View */}
      {viewMode === 'formatted' ? (
        <div className="space-y-4">
          {/* 1. Red Flags Triage */}
          {activeTab === 'redflags' && currentDataset?.categories && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentDataset.categories.map((cat) => (
                <div key={cat.id} className="p-4 rounded-2xl border border-rose-100 bg-rose-50/40 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{cat.name}</h4>
                      <p className="text-[11px] text-slate-500 font-mono">ID: {cat.id} • Dept: {cat.departmentId}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-600 text-white shadow-sm">
                      Level {cat.level} ({cat.urgencySuggested})
                    </span>
                  </div>

                  <p className="text-xs text-rose-800 bg-rose-100/70 p-2.5 rounded-xl font-medium">
                    ⚠️ {cat.emergencyMessage}
                  </p>

                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                      Sample Symptom Patterns ({cat.patterns?.length || 0} recognized):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {cat.patterns?.slice(0, 10).map((p, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[11px] text-slate-700">
                          {p}
                        </span>
                      ))}
                      {cat.patterns?.length > 10 && (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px]">
                          +{cat.patterns.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 2. Medicines Catalog */}
          {activeTab === 'medicines' && currentDataset?.medicines && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Medicine Name</th>
                    <th className="py-2.5 px-3">Active Ingredient</th>
                    <th className="py-2.5 px-3">Drug Class</th>
                    <th className="py-2.5 px-3">Default Dosage</th>
                    <th className="py-2.5 px-3">Forms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {currentDataset.medicines.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-bold text-slate-800">
                        {m.name}
                        {m.brandNames && (
                          <span className="block text-[10px] text-slate-400 font-normal">
                            Brands: {m.brandNames.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{m.activeIngredient}</td>
                      <td className="py-2.5 px-3 text-brand-700 font-semibold">{m.drugClass}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">{m.defaultDosage}</td>
                      <td className="py-2.5 px-3 text-slate-500">{m.forms?.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3. Drug Interactions */}
          {activeTab === 'interactions' && (
            <div className="space-y-3">
              {(currentDataset?.interactions || currentDataset?.pairs || []).map((inter, idx) => (
                <div key={idx} className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-slate-900">
                        {inter.drugA || inter.drugs?.[0] || 'Drug A'} + {inter.drugB || inter.drugs?.[1] || 'Drug B'}
                      </span>
                      <span className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded-md text-[10px] font-bold uppercase">
                        {inter.severity || 'Moderate'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700">
                      {inter.description || inter.effect || 'Contraindicated combination; potential adverse interaction.'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 4. Dose Ranges */}
          {activeTab === 'doseRanges' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Medicine</th>
                    <th className="py-2.5 px-3">Min Dose</th>
                    <th className="py-2.5 px-3">Max Single Dose</th>
                    <th className="py-2.5 px-3">Max Daily Dose</th>
                    <th className="py-2.5 px-3">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-mono">
                  {(Array.isArray(currentDataset) ? currentDataset : Object.entries(currentDataset?.limits || currentDataset?.ranges || {})).map((item, idx) => {
                    const name = Array.isArray(item) ? item[0] : item.name;
                    const val = Array.isArray(item) ? item[1] : item;
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold font-sans text-slate-800 capitalize">{name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{val.min || val.minDose || '—'}</td>
                        <td className="py-2.5 px-3 font-bold text-amber-700">{val.maxSingle || val.maxSingleDose || '—'}</td>
                        <td className="py-2.5 px-3 font-bold text-rose-700">{val.maxDaily || val.maxDailyDose || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-500 uppercase">{val.unit || 'mg'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 5. Follow-up Intervals */}
          {activeTab === 'followupIntervals' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(currentDataset?.intervals || currentDataset?.bySpecialty || currentDataset || {}).filter(([k]) => k !== '_notice').map(([k, v]) => (
                <div key={k} className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                  <span className="text-xs font-bold text-slate-800 capitalize block">{k.replace(/([A-Z])/g, ' $1')}</span>
                  <span className="text-sm font-extrabold text-brand-700 block">{typeof v === 'object' ? JSON.stringify(v) : `${v} days`}</span>
                  <span className="text-[10px] text-slate-400">Standard clinical recall window</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Raw JSON code block */
        <div className="bg-slate-900 rounded-2xl p-4 text-slate-200 font-mono text-xs overflow-x-auto max-h-96">
          <pre>{JSON.stringify(currentDataset || { loading: true }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default ClinicalListsViewer;
