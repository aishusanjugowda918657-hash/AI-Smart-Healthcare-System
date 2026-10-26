export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (err) {
    return dateString;
  }
};

export const formatTime = (timeString) => {
  if (!timeString) return '';
  try {
    const clean = String(timeString).trim();
    if (/am|pm/i.test(clean)) return clean;
    const firstPart = clean.split('-')[0].trim();
    const [hours, minutes] = firstPart.split(':');
    const h = parseInt(hours, 10);
    if (isNaN(h)) return clean;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const formattedHours = h % 12 || 12;
    return `${String(formattedHours).padStart(2, '0')}:${minutes || '00'} ${ampm}`;
  } catch (err) {
    return timeString;
  }
};

export const formatDuration = (minutes) => {
  if (minutes === undefined || minutes === null) return '0 mins';
  if (minutes < 60) return `${minutes} mins`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs} hr ${mins} mins`;
};

export const calculateAge = (dobString) => {
  if (!dobString) return '';
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : 0;
};

export const getTodayInHospitalTz = (customDate = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(customDate);
};

export const getCurrentTimeInHospitalTz = (customDate = new Date()) => {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(customDate);
};

export const isPastAppointment = (dateString, customNow = new Date()) => {
  if (!dateString) return false;
  const todayStr = getTodayInHospitalTz(customNow);
  return String(dateString).trim() < todayStr;
};

export const isSlotExpired = (appointmentDate, startAt, customNow = new Date()) => {
  if (!appointmentDate) return true;
  const cleanDate = String(appointmentDate).trim();
  const todayStr = getTodayInHospitalTz(customNow);

  if (cleanDate < todayStr) return true;
  if (cleanDate > todayStr) return false;

  // On today's date: check if slot start time has already passed
  if (!startAt) return true;
  const currentTimeStr = getCurrentTimeInHospitalTz(customNow);
  return String(startAt).trim() <= currentTimeStr;
};



