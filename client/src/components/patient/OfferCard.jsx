import React, { useState } from 'react';
import { Calendar, Clock, AlertTriangle, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import API from '../../services/api';

export const OfferCard = ({ offer, onActionComplete }) => {
  const [loading, setLoading] = useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);

  if (!offer || offer.status !== 'open') return null;

  const isLeave = offer.kind === 'leave_reschedule';

  const handleAccept = async () => {
    setLoading(true);
    try {
      await API.post(`/offers/${offer.id}/accept`, { optionIndex: selectedOptionIndex });
      alert('Offer accepted successfully!');
      if (onActionComplete) onActionComplete();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to accept offer.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    setLoading(true);
    try {
      await API.post(`/offers/${offer.id}/decline`);
      alert('Offer declined.');
      if (onActionComplete) onActionComplete();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to decline offer.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-amber-50/80 to-orange-50 border-2 border-amber-300 rounded-3xl p-5 shadow-sm space-y-4">
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-700 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900">
              {isLeave ? `Reschedule Notice: Dr. ${offer.doctorName}` : `Waitlist Slot Available!`}
            </h4>
            <p className="text-xs text-slate-600">
              {isLeave ? `Doctor on leave on ${offer.leaveDate}` : `Slot opened for your waitlist request`}
            </p>
          </div>
        </div>

        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full text-[10px] font-bold">
          Action Required
        </span>
      </div>

      {/* Leave Reschedule Options Selection */}
      {isLeave && offer.options && offer.options.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-800">Select Reschedule Option:</div>
          <div className="space-y-2">
            {offer.options.map((opt, idx) => (
              <label
                key={idx}
                onClick={() => setSelectedOptionIndex(idx)}
                className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                  selectedOptionIndex === idx
                    ? 'bg-white border-teal-600 ring-2 ring-teal-500/20 shadow-xs'
                    : 'bg-white/60 border-slate-200 hover:bg-white'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name={`offer-${offer.id}`}
                    checked={selectedOptionIndex === idx}
                    onChange={() => setSelectedOptionIndex(idx)}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <div className="font-bold text-xs text-slate-900">
                      {opt.type === 'same_doctor_next' && `Option 1: Same Doctor (${opt.doctorName})`}
                      {opt.type === 'other_doctor_earlier' && `Option 2: Alternative Doctor (${opt.doctorName})`}
                      {opt.type === 'join_waitlist' && `Option 3: Join Waiting List`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {opt.date && `${opt.date} at ${opt.timeSlot}`}
                      {opt.expectedWaitMin && ` • ~${opt.expectedWaitMin}m expected wait`}
                      {opt.type === 'join_waitlist' && `We'll notify you as soon as a slot opens.`}
                    </div>
                  </div>
                </div>

                {selectedOptionIndex === idx && <ArrowRight className="w-4 h-4 text-teal-600" />}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Waitlist Slot Offer Details */}
      {!isLeave && offer.slotDetails && (
        <div className="bg-white border border-amber-200 rounded-2xl p-4 space-y-1.5 text-xs">
          <div className="font-bold text-slate-900 flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-teal-600" />
            <span>{offer.slotDetails.date} at {offer.slotDetails.timeSlot}</span>
          </div>
          <div className="text-slate-600 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>With Dr. {offer.slotDetails.doctorName}</span>
          </div>
        </div>
      )}

      {/* Expiry Notice & Actions */}
      <div className="pt-2 border-t border-amber-200/80 flex items-center justify-between">
        <div className="text-[11px] text-amber-900 font-medium">
          Expires: {new Date(offer.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleDecline}
            disabled={loading}
            className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-1"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Decline</span>
          </button>

          <button
            onClick={handleAccept}
            disabled={loading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center space-x-1.5 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Accept Offer</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default OfferCard;
