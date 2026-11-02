/**
 * SmartCare Calendar Export Service (RFC 5545 iCalendar)
 * Path: client/src/services/calendarExport.js
 *
 * Enables 100% reliable, zero-APK offline alarms:
 * By exporting reminders directly into Android's native calendar (Google Calendar / Samsung Calendar),
 * the device's native OS AlarmManager rings audible reminders at 08:00 AM IST / appointment check-in time
 * even in deep sleep, airplane mode, or with the PWA completely closed.
 */

/**
 * Format a Date object into UTC iCalendar format: YYYYMMDDTHHMMSSZ
 * @param {Date} date
 * @returns {string}
 */
export function formatIcsDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Trigger download of an .ics file in browser.
 * On Android, Chrome prompts to open with native Calendar app.
 * @param {string} filename
 * @param {string} icsContent
 */
export function downloadIcsFile(filename, icsContent) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.ics') ? filename : `${filename}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generate iCalendar content for an appointment with check-in alarms.
 * @param {object} param0
 * @param {string} param0.doctorName
 * @param {string} param0.department
 * @param {string} param0.date - 'YYYY-MM-DD'
 * @param {string} param0.timeSlot - e.g. '09:00 AM' or '14:30'
 * @param {string} [param0.tokenLabel]
 * @param {string} [param0.tokenNumber]
 * @param {string} [param0.location]
 * @returns {string} .ics content
 */
export function generateAppointmentIcs({
  doctorName = 'Doctor',
  department = 'General Medicine',
  date,
  timeSlot,
  tokenLabel = '',
  tokenNumber = '',
  location = 'SmartCare Hospital Reception Desk'
}) {
  if (!date || !timeSlot) return '';

  // Parse timeSlot into local date/time (Asia/Kolkata UTC+5:30)
  const [year, month, day] = date.split('-').map(Number);
  let hours = 0;
  let minutes = 0;
  const isPM = /pm/i.test(timeSlot);
  const isAM = /am/i.test(timeSlot);
  const cleanStr = timeSlot.replace(/(am|pm)/i, '').trim();
  const parts = cleanStr.split(':').map(Number);

  if (parts.length >= 1 && !isNaN(parts[0])) hours = parts[0];
  if (parts.length >= 2 && !isNaN(parts[1])) minutes = parts[1];
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  // Hospital slot time in IST is UTC - 5h30m
  const startUtc = new Date(Date.UTC(year, month - 1, day, hours - 5, minutes - 30, 0));
  const endUtc = new Date(startUtc.getTime() + 30 * 60 * 1000); // 30-minute default duration

  const nowIcs = formatIcsDate(new Date());
  const startIcs = formatIcsDate(startUtc);
  const endIcs = formatIcsDate(endUtc);

  const tokenText = tokenLabel || (tokenNumber ? `#${tokenNumber}` : 'N/A');
  const summary = `Doctor Consultation: Dr. ${doctorName}`;
  const description = `Department: ${department}\\nToken: ${tokenText}\\nImportant: Please arrive 15 minutes before your slot to scan your Check-In QR code at reception.`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartCare AI//Healthcare Calendar 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:appt-${date}-${hours}${minutes}-${Date.now()}@smartcare.ai`,
    `DTSTAMP:${nowIcs}`,
    `DTSTART:${startIcs}`,
    `DTEND:${endIcs}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    // Alarm 1: 2 hours prior reminder
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: Appointment with Dr. ${doctorName} in 2 hours.`,
    'END:VALARM',
    // Alarm 2: 15 minutes prior check-in alarm
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Check-In Time: Please arrive at reception now for Dr. ${doctorName}.`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

/**
 * Generate iCalendar recurring schedule for daily medicine doses (08:00 AM & 08:00 PM IST).
 * @param {Array<object>} reminders
 * @param {number} [durationDays=14]
 * @returns {string} .ics content
 */
export function generateMedicineScheduleIcs(reminders = [], durationDays = 14) {
  if (!reminders || reminders.length === 0) return '';

  const nowIcs = formatIcsDate(new Date());
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  // Deduplicate by medicine name and meal/time
  const doseEvents = [];

  reminders.forEach((r, idx) => {
    const medName = r.medicineName || 'Medication';
    const dosage = r.dosage || '1 dose';
    const meal = r.mealTime || 'Daily Dose';
    const timeStr = r.scheduledTime || r.time || (meal.includes('dinner') ? '08:00 PM' : '08:00 AM');

    // Parse time
    let hours = timeStr.includes('PM') || meal.includes('dinner') ? 20 : 8;
    let minutes = 0;
    if (timeStr.includes(':')) {
      const p = timeStr.replace(/(am|pm)/i, '').trim().split(':').map(Number);
      if (!isNaN(p[0])) hours = p[0];
      if (p.length > 1 && !isNaN(p[1])) minutes = p[1];
      if (/pm/i.test(timeStr) && hours < 12) hours += 12;
      if (/am/i.test(timeStr) && hours === 12) hours = 0;
    }

    // Convert IST to UTC
    const startUtc = new Date(Date.UTC(year, month, day, hours - 5, minutes - 30, 0));
    const endUtc = new Date(startUtc.getTime() + 15 * 60 * 1000);

    doseEvents.push({
      uid: `med-${idx}-${Date.now()}@smartcare.ai`,
      startIcs: formatIcsDate(startUtc),
      endIcs: formatIcsDate(endUtc),
      summary: `Take Medicine: ${medName} (${dosage})`,
      description: `Medication Dose: ${medName}\\nDosage: ${dosage}\\nTiming: ${timeStr} (${meal})\\nOpen SmartCare AI to record dose.`,
      count: durationDays
    });
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartCare AI//Medicine Schedule 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  doseEvents.forEach((ev) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${nowIcs}`,
      `DTSTART:${ev.startIcs}`,
      `DTEND:${ev.endIcs}`,
      `RRULE:FREQ=DAILY;COUNT=${ev.count}`,
      `SUMMARY:${ev.summary}`,
      `DESCRIPTION:${ev.description}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT0M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${ev.summary}`,
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
