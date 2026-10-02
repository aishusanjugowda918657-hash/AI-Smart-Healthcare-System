import React from 'react';

/**
 * DayHeatStrip Component (Admin UI)
 * Visual indicator of doctor slot capacity & fill level for a selected day
 * Per PRD F2 specification (Green <60%, Amber 60-85%, Red >85% or Full)
 */
export default function DayHeatStrip({ summary, date, doctorName }) {
  if (!summary || summary.totalCount === 0) {
    return (
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 text-center text-slate-400 text-sm">
        No schedule or slots generated for {date || 'the selected date'}.
      </div>
    );
  }

  const {
    totalCount,
    freeCount,
    reservedCount,
    bookedCount,
    blockedCount,
    heldCount,
    fillRatio,
    color,
    label
  } = summary;

  const freePct = totalCount > 0 ? (freeCount / totalCount) * 100 : 0;
  const bookedPct = totalCount > 0 ? (bookedCount / totalCount) * 100 : 0;
  const reservedPct = totalCount > 0 ? (reservedCount / totalCount) * 100 : 0;
  const blockedPct = totalCount > 0 ? (blockedCount / totalCount) * 100 : 0;
  const heldPct = totalCount > 0 ? (heldCount / totalCount) * 100 : 0;

  const colorStyles = {
    green: {
      badgeBg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-400',
      barBg: 'bg-emerald-500'
    },
    amber: {
      badgeBg: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      dot: 'bg-amber-400',
      barBg: 'bg-amber-500'
    },
    red: {
      badgeBg: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      dot: 'bg-rose-400',
      barBg: 'bg-rose-500'
    }
  };

  const currentTheme = colorStyles[color] || colorStyles.green;

  return (
    <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-slate-100">Day Heat Strip Capacity</h4>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${currentTheme.badgeBg}`}>
              <span className={`w-2 h-2 rounded-full ${currentTheme.dot}`} />
              {color.toUpperCase()} FILL ({Math.round(fillRatio * 100)}%)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {doctorName ? `${doctorName} • ` : ''}Date: <span className="text-slate-200 font-mono">{date}</span>
          </p>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-slate-100 font-mono">{label}</span>
          <p className="text-xs text-slate-400">Total Slots: {totalCount}</p>
        </div>
      </div>

      {/* Multi-segmented Capacity Progress Bar */}
      <div className="w-full bg-slate-900 rounded-full h-3.5 flex overflow-hidden p-0.5 gap-0.5 border border-slate-700">
        {bookedPct > 0 && (
          <div
            style={{ width: `${bookedPct}%` }}
            className="bg-sky-500 h-full rounded-sm transition-all duration-300"
            title={`Booked: ${bookedCount}`}
          />
        )}
        {heldPct > 0 && (
          <div
            style={{ width: `${heldPct}%` }}
            className="bg-amber-500 h-full rounded-sm transition-all duration-300"
            title={`Held: ${heldCount}`}
          />
        )}
        {reservedPct > 0 && (
          <div
            style={{ width: `${reservedPct}%` }}
            className="bg-indigo-500 h-full rounded-sm transition-all duration-300"
            title={`Reserved/Buffer: ${reservedCount}`}
          />
        )}
        {freePct > 0 && (
          <div
            style={{ width: `${freePct}%` }}
            className="bg-emerald-500 h-full rounded-sm transition-all duration-300"
            title={`Free: ${freeCount}`}
          />
        )}
        {blockedPct > 0 && (
          <div
            style={{ width: `${blockedPct}%` }}
            className="bg-slate-600 h-full rounded-sm transition-all duration-300"
            title={`Blocked/Leave: ${blockedCount}`}
          />
        )}
      </div>

      {/* Legend Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-1 border-t border-slate-700/50">
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
          <span>Free ({freeCount})</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-xs bg-indigo-500 inline-block" />
          <span>Buffer ({reservedCount})</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
          <span>Booked ({bookedCount})</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
          <span>Held ({heldCount})</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-xs bg-slate-600 inline-block" />
          <span>Leave ({blockedCount})</span>
        </div>
      </div>
    </div>
  );
}
