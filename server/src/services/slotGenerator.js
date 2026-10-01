/**
 * Deterministic Doctor Slot Generator Engine.
 * Takes schedule configuration, existing booked appointments, and target date
 * to calculate exact available consultation time slots.
 */
export const generateAvailableSlots = ({
  schedule,
  existingAppointments = [],
  targetDateStr
}) => {
  if (!schedule) {
    return [];
  }

  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) {
    return [];
  }

  // 1. Check if date is in doctor leaves
  const leaves = schedule.leaves || [];
  if (leaves.includes(targetDateStr)) {
    return [];
  }

  // 2. Check working days (1=Mon, 7=Sun or 0=Sun depending on JS day 0-6 vs 1-7 convention)
  const jsDay = targetDate.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const dayOfWeekNumber = jsDay === 0 ? 7 : jsDay;

  const workingDays = schedule.workingDays || [1, 2, 3, 4, 5];
  if (!workingDays.includes(dayOfWeekNumber)) {
    return [];
  }

  // 3. Calculate slot times
  const workingHours = schedule.workingHours || { start: '09:00', end: '17:00' };
  const slotDurationMinutes = schedule.slotDurationMinutes || 15;
  const breakTimes = schedule.breakTimes || [];

  const slots = [];
  const [startH, startM] = workingHours.start.split(':').map(Number);
  const [endH, endM] = workingHours.end.split(':').map(Number);

  let currentMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Convert breaks to minute intervals
  const breakIntervals = breakTimes.map((b) => {
    const [bStartH, bStartM] = b.start.split(':').map(Number);
    const [bEndH, bEndM] = b.end.split(':').map(Number);
    return {
      start: bStartH * 60 + bStartM,
      end: bEndH * 60 + bEndM
    };
  });

  // Extract set of booked time slots for active appointments
  const bookedSlotTimes = new Set(
    existingAppointments
      .filter((apt) => ['BOOKED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED'].includes(apt.status))
      .map((apt) => apt.timeSlot)
  );

  while (currentMinutes + slotDurationMinutes <= endMinutes) {
    const slotStartMin = currentMinutes;
    const slotEndMin = currentMinutes + slotDurationMinutes;

    // Check overlap with breaks
    const overlapsWithBreak = breakIntervals.some(
      (b) => slotStartMin < b.end && slotEndMin > b.start
    );

    const hours = Math.floor(currentMinutes / 60);
    const mins = currentMinutes % 60;
    const timeSlotStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    if (!overlapsWithBreak) {
      const isBooked = bookedSlotTimes.has(timeSlotStr);
      slots.push({
        timeSlot: timeSlotStr,
        available: !isBooked
      });
    }

    currentMinutes += slotDurationMinutes;
  }

  return slots;
};
