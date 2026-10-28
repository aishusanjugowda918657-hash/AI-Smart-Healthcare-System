/**
 * English Help Library Articles
 * Each article: { id, title, keywords[], synonyms[], steps[], actionButtons[], followUpChips[] }
 */
export const articles = [
  {
    id: 'book_appointment',
    title: 'How to Book an Appointment',
    keywords: ['book', 'appointment', 'schedule', 'new appointment', 'booking', 'see doctor', 'visit doctor', 'consult', 'consultation'],
    synonyms: ['make appointment', 'set appointment', 'get appointment', 'book doctor', 'reserve slot', 'fix appointment', 'doctor visit', 'opd booking'],
    answer: 'Here is how to book an appointment:',
    steps: [
      'Go to the **Appointments** page from the sidebar menu.',
      'Click the **"Book New Appointment"** button.',
      'Select your preferred **department** and **doctor**.',
      'Pick a **date** and available **time slot**.',
      'Confirm the **health disclaimer** checkbox.',
      'Click **"Confirm Booking"** to complete.'
    ],
    actionButtons: [
      { label: '📅 Book Appointment now', route: '/patient/appointments' }
    ],
    followUpChips: ['My Token Status', 'Doctor Timings']
  },
  {
    id: 'token_status',
    title: 'Check Your Token / Queue Status',
    keywords: ['token', 'queue', 'status', 'my turn', 'position', 'waiting', 'queue number', 'token number'],
    synonyms: ['where am i in queue', 'my queue position', 'am i next', 'how many before me', 'token check', 'queue check', 'wait position'],
    answer: 'To check your token/queue status:',
    steps: [
      'Open the **Dashboard** — your current token and queue position are shown at the top.',
      'Or go to **My Appointments** to see the live queue card.',
      'The card shows your **token number**, **current position**, and **estimated wait time**.'
    ],
    actionButtons: [
      { label: '🎫 View Live Queue', route: '/patient/dashboard' }
    ],
    followUpChips: ['Book Appointment', 'Doctor Timings']
  },
  {
    id: 'doctor_timings',
    title: 'Doctor Timings & OPD Hours',
    keywords: ['doctor timing', 'opd hours', 'hospital hours', 'when open', 'doctor schedule', 'opd time', 'doctor available'],
    synonyms: ['what time doctor comes', 'when is opd', 'doctor availability', 'clinic hours', 'hospital timings', 'opd schedule', 'working hours'],
    answer: 'To check doctor timings:',
    steps: [
      'Go to **Book Appointment** and select a department.',
      'Each doctor card shows their **OPD hours** and **available slots**.',
      'General OPD hours: **9:00 AM – 1:00 PM** and **2:00 PM – 5:00 PM** (Mon–Sat).'
    ],
    actionButtons: [
      { label: '🕐 View Doctor Timings', route: '/patient/appointments' }
    ],
    followUpChips: ['Book Appointment', 'My Token Status']
  },
  {
    id: 'prescriptions',
    title: 'View Your Prescriptions',
    keywords: ['prescription', 'medicine', 'medication', 'my medicines', 'drugs', 'rx', 'pills'],
    synonyms: ['view prescription', 'see medicines', 'my prescription', 'check medicines', 'medicine list', 'what medicines', 'prescribed medicines'],
    answer: 'To view your prescriptions:',
    steps: [
      'Go to **My Prescriptions** from the sidebar menu.',
      'You will see all past and current prescriptions with dosage details.',
      'Click on any prescription to see full details including **timing**, **dosage**, and **duration**.'
    ],
    actionButtons: [
      { label: '💊 My Prescriptions', route: '/patient/prescriptions' }
    ],
    followUpChips: ['Reminders', 'Talk to Staff']
  },
  {
    id: 'reminders',
    title: 'Medicine Reminders & Follow-ups',
    keywords: ['reminder', 'follow up', 'followup', 'follow-up', 'next visit', 'medicine reminder', 'alert'],
    synonyms: ['set reminder', 'when next visit', 'follow up date', 'medicine alert', 'medication reminder', 'pill reminder', 'when to take medicine'],
    answer: 'About medicine reminders and follow-ups:',
    steps: [
      'Go to **Reminders** from the sidebar — all active medicine reminders are shown.',
      'Each reminder shows the **medicine name**, **dosage**, **time**, and **status**.',
      'You can mark medicines as **Taken** or **Missed**.',
      'Follow-up appointments appear in your **Appointments** page with the scheduled date.'
    ],
    actionButtons: [
      { label: '⏰ Reminders', route: '/patient/reminders' }
    ],
    followUpChips: ['My Prescriptions', 'Book Appointment']
  },
  {
    id: 'talk_to_staff',
    title: 'Talk to Hospital Staff',
    keywords: ['staff', 'receptionist', 'help desk', 'human', 'person', 'real person', 'escalate', 'complaint'],
    synonyms: ['speak to someone', 'contact staff', 'need help', 'call hospital', 'front desk', 'customer service', 'support', 'hospital contact'],
    answer: 'To reach hospital staff:',
    steps: [
      'Visit the **hospital reception desk** on the ground floor for in-person help.',
      'Call the hospital helpline: **+91 80 1234 5678** (9 AM – 5 PM).',
      'Or use the **"Talk to Staff"** button below to send an escalation request.'
    ],
    actionButtons: [
      { label: '📞 Talk to Staff', route: '/patient/support' }
    ],
    followUpChips: ['Book Appointment', 'My Token Status']
  },
  {
    id: 'medical_history',
    title: 'View Medical History & Records',
    keywords: ['medical history', 'health record', 'past visits', 'records', 'history', 'visit history', 'medical record'],
    synonyms: ['my records', 'previous visits', 'old records', 'health history', 'patient history', 'past reports', 'medical report'],
    answer: 'To view your medical history:',
    steps: [
      'Go to **Medical History** from the sidebar menu.',
      'You will see a **timeline** of all your past visits, prescriptions, and reports.',
      'Click on any entry to see full details.',
      'You can also **share records** with doctors using the Share button.'
    ],
    actionButtons: [
      { label: '📋 Medical History', route: '/patient/history' }
    ],
    followUpChips: ['My Prescriptions', 'Book Appointment']
  },
  {
    id: 'cancel_appointment',
    title: 'Cancel or Reschedule Appointment',
    keywords: ['cancel', 'reschedule', 'change appointment', 'cancel booking', 'modify', 'postpone'],
    synonyms: ['cancel my appointment', 'change date', 'move appointment', 'delete appointment', 'undo booking', 'change slot'],
    answer: 'To cancel or reschedule:',
    steps: [
      'Go to **My Appointments** from the sidebar.',
      'Find the appointment you want to change.',
      'Click **"Cancel"** to cancel, or **"Reschedule"** to pick a new date/time.',
      'Cancelled appointments can be rebooked from the booking page.'
    ],
    actionButtons: [
      { label: '📅 My Appointments', route: '/patient/appointments' }
    ],
    followUpChips: ['Book Appointment', 'Talk to Staff']
  },
  {
    id: 'wait_time',
    title: 'Estimated Wait Time',
    keywords: ['wait time', 'how long', 'when my turn', 'how much wait', 'estimated time'],
    synonyms: ['how long wait', 'wait duration', 'when will i be called', 'time remaining', 'queue wait'],
    answer: 'About your wait time:',
    steps: [
      'Your **estimated wait time** is shown on the Dashboard queue card.',
      'Wait times are calculated based on the **current queue position** and **average consultation duration**.',
      'You will get a **notification** when you are next in line.'
    ],
    actionButtons: [
      { label: '🎫 View Live Queue', route: '/patient/dashboard' }
    ],
    followUpChips: ['My Token Status', 'Doctor Timings']
  },
  {
    id: 'what_can_you_do',
    title: 'What Can This Assistant Do?',
    keywords: ['what can you do', 'help', 'features', 'capabilities', 'menu', 'options'],
    synonyms: ['what do you do', 'how can you help', 'what are your features', 'show menu', 'list features'],
    answer: 'I can help you with:',
    steps: [
      '📅 **Book or cancel** appointments',
      '🎫 Check your **token/queue status** and **wait time**',
      '🕐 View **doctor timings** and OPD hours',
      '💊 View your **prescriptions** and **medicine reminders**',
      '📋 Access your **medical history** and records',
      '📞 **Contact hospital staff** for additional help'
    ],
    actionButtons: [],
    followUpChips: ['Book Appointment', 'My Token Status', 'Doctor Timings', 'My Prescriptions']
  }
];

export default articles;
