import React from 'react';

export const StatCard = ({ title, value, subtitle, icon: Icon, color = 'blue' }) => {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100'
  };

  return (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 truncate">{title}</p>
          <h3 className="text-xl sm:text-2xl font-bold text-slate-800 mt-1 truncate">{value}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-1 line-clamp-2 break-words">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`p-2.5 sm:p-3 rounded-lg border shrink-0 ${colorMap[color] || colorMap.blue}`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
