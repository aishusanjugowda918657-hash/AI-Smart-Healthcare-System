import React, { useState } from 'react';

/**
 * SlotPickerList Component (Patient UI)
 * Displays bookable doctor slots grouped by morning (AM) and afternoon (PM).
 * Supports slot holding (3 min hold), status indicators (free, held, booked, blocked, reserved).
 * Reused in smart appointment booking flow (PRD F2 & F3).
 */
export default function SlotPickerList({
  slots = [],
  selectedSlotId = null,
  onSelectSlot,
  loading = false,
  doctorName = 'Doctor'
}) {
  const [holdingSlotId, setHoldingSlotId] = useState(null);
  const [holdError, setHoldError] = useState(null);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm">Fetching available appointment slots...</p>
      </div>
    );
  }

  if (!slots || slots.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
        <p className="text-slate-200 font-semibold text-base">No Slots Available</p>
        <p className="text-slate-400 text-xs">
          No bookable slots found for {doctorName} on this date. Please pick another date or join the waitlist.
        </p>
      </div>
    );
  }

  // Group slots into Morning (AM < 12:00) and Afternoon (PM >= 12:00)
  const amSlots = slots.filter((s) => {
    const [h] = (s.startAt || '09:00').split(':').map(Number);
    return h < 12;
  });

  const pmSlots = slots.filter((s) => {
    const [h] = (s.startAt || '09:00').split(':').map(Number);
    return h >= 12;
  });

  const handleSlotClick = async (slot) => {
    if (slot.status === 'booked' || slot.status === 'blocked') {
      return; // Non-clickable
    }

    setHoldError(null);
    if (onSelectSlot) {
      onSelectSlot(slot);
    }
  };

  const renderSlotChip = (slot) => {
    const isSelected = selectedSlotId === slot.id;
    let badgeStyle = 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 cursor-pointer';
    let labelText = slot.startAt;
    let subtitle = 'Available';

    switch (slot.status) {
      case 'free':
        if (isSelected) {
          badgeStyle = 'bg-teal-500 text-slate-950 font-bold border-teal-400 shadow-lg shadow-teal-500/25 ring-2 ring-teal-400/50 scale-[1.03]';
        } else {
          badgeStyle = 'bg-slate-800/90 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer';
        }
        break;
      case 'reserved':
        if (isSelected) {
          badgeStyle = 'bg-indigo-600 text-white font-bold border-indigo-400 shadow-lg shadow-indigo-500/25 scale-[1.03]';
        } else {
          badgeStyle = 'bg-indigo-950/40 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 cursor-pointer';
        }
        subtitle = 'Buffer';
        break;
      case 'held':
        badgeStyle = 'bg-amber-950/40 border-amber-500/40 text-amber-300 opacity-90 cursor-pointer';
        subtitle = 'Held';
        break;
      case 'booked':
        badgeStyle = 'bg-slate-900 border-slate-800 text-slate-500 line-through opacity-60 cursor-not-allowed';
        subtitle = 'Booked';
        break;
      case 'blocked':
        badgeStyle = 'bg-rose-950/20 border-rose-900/40 text-rose-400/60 line-through opacity-60 cursor-not-allowed';
        subtitle = 'Leave';
        break;
      default:
        break;
    }

    return (
      <button
        key={slot.id}
        type="button"
        onClick={() => handleSlotClick(slot)}
        disabled={slot.status === 'booked' || slot.status === 'blocked'}
        className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all duration-200 ${badgeStyle}`}
      >
        <span className="text-sm font-semibold font-mono tracking-tight">{labelText}</span>
        <span className="text-[10px] uppercase font-bold tracking-wider opacity-80 mt-0.5">{subtitle}</span>
      </button>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-100">Select Time Slot</h3>
          <p className="text-xs text-slate-400">Slots for {doctorName} (10-min grid)</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Free
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-400" /> Buffer
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-600" /> Booked/Leave
          </span>
        </div>
      </div>

      {holdError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs">
          ⚠️ {holdError}
        </div>
      )}

      {/* Morning Sessions */}
      {amSlots.length > 0 && (
        <div className="space-y-2.5">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>🌅 Morning Slots (AM)</span>
            <span className="text-slate-500 text-[10px]">({amSlots.length})</span>
          </h4>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {amSlots.map((s) => renderSlotChip(s))}
          </div>
        </div>
      )}

      {/* Afternoon / Evening Sessions */}
      {pmSlots.length > 0 && (
        <div className="space-y-2.5 pt-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>☀️ Afternoon & Evening Slots (PM)</span>
            <span className="text-slate-500 text-[10px]">({pmSlots.length})</span>
          </h4>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {pmSlots.map((s) => renderSlotChip(s))}
          </div>
        </div>
      )}
    </div>
  );
}
