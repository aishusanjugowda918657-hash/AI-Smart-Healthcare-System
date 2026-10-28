/**
 * doctorDisplayId.js (Client utility)
 * ─────────────────────────────────────────────────────────────────────────────
 * Formats doctor display IDs according to DOC-DEPT-INITIALS-NNN specification.
 */

export const DEPARTMENT_ABBREVIATIONS = {
  'dept-gen': 'GEN',
  'gen': 'GEN',
  'general medicine': 'GEN',
  'general': 'GEN',
  'dept-card': 'CAR',
  'card': 'CAR',
  'car': 'CAR',
  'cardiology': 'CAR',
  'cardiac': 'CAR',
  'dept-ped': 'PED',
  'dept-peds': 'PED',
  'ped': 'PED',
  'peds': 'PED',
  'pediatrics': 'PED',
  'paediatrics': 'PED',
  'dept-ortho': 'ORT',
  'ortho': 'ORT',
  'ort': 'ORT',
  'orthopedics': 'ORT',
  'orthopaedics': 'ORT',
  'dept-derm': 'DER',
  'derm': 'DER',
  'der': 'DER',
  'dermatology': 'DER',
  'dept-gastro': 'GAS',
  'gastro': 'GAS',
  'gas': 'GAS',
  'gastroenterology': 'GAS',
  'dept-nephro': 'NEP',
  'nephro': 'NEP',
  'nep': 'NEP',
  'nephrology': 'NEP',
  'dept-neuro': 'NEU',
  'neuro': 'NEU',
  'neu': 'NEU',
  'neurology': 'NEU',
  'neurosurgery': 'NEU',
  'dept-onco': 'ONC',
  'onco': 'ONC',
  'onc': 'ONC',
  'oncology': 'ONC',
  'dept-obgyn': 'OBG',
  'obgyn': 'OBG',
  'obg': 'OBG',
  'obstetrics & gynaecology': 'OBG',
  'obstetrics & gynecology': 'OBG'
};

export function getDepartmentAbbreviation(departmentId, departmentName, departmentCode) {
  const norm = (s) => (s ? String(s).trim().toLowerCase() : '');
  const idNorm = norm(departmentId);
  const nameNorm = norm(departmentName);
  const codeNorm = norm(departmentCode);

  if (idNorm && DEPARTMENT_ABBREVIATIONS[idNorm]) return DEPARTMENT_ABBREVIATIONS[idNorm];
  if (nameNorm && DEPARTMENT_ABBREVIATIONS[nameNorm]) return DEPARTMENT_ABBREVIATIONS[nameNorm];
  if (codeNorm && DEPARTMENT_ABBREVIATIONS[codeNorm]) return DEPARTMENT_ABBREVIATIONS[codeNorm];

  const rawCode = String(departmentCode || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (rawCode === 'CARD') return 'CAR';
  if (rawCode === 'ORTHO') return 'ORT';
  if (rawCode === 'DERM') return 'DER';
  if (rawCode.length >= 3) return rawCode.slice(0, 3);

  const rawName = String(departmentName || departmentId || 'GEN').replace(/[^a-zA-Z]/g, '').toUpperCase();
  return rawName.slice(0, 3) || 'GEN';
}

export function extractDoctorInitials(fullNameOrName) {
  if (!fullNameOrName || typeof fullNameOrName !== 'string') return 'DOC';

  let cleaned = fullNameOrName.replace(/^(dr\.|dr|doctor|prof\.|prof)($|\s+)/i, '').trim();
  cleaned = cleaned.replace(/^dr\.?($|\s+)/i, '').trim();
  cleaned = cleaned.replace(/\./g, ' ');

  const words = cleaned
    .split(/[\s_-]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0);

  if (words.length === 0) return 'DOC';
  const initials = words.map((w) => w[0].toUpperCase()).join('');
  return initials || 'DOC';
}

export function formatDoctorDisplayId(deptAbbr, initials, seq) {
  const paddedSeq = String(seq).padStart(3, '0');
  return `DOC-${deptAbbr}-${initials}-${paddedSeq}`;
}

export function isValidDoctorDisplayId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^DOC-[A-Z]+-[A-Z]+-\d{3,}$/.test(id);
}

export function parseDoctorDisplayId(id) {
  if (!isValidDoctorDisplayId(id)) return null;
  const parts = id.split('-');
  return {
    prefix: parts[0],
    dept: parts[1],
    initials: parts[2],
    sequence: parseInt(parts[3], 10),
    formattedSequence: parts[3]
  };
}

export function generateClientDoctorDisplayId(doctor, existingDoctors = []) {
  if (!doctor) return null;
  if (isValidDoctorDisplayId(doctor.displayId)) return doctor.displayId;
  if (isValidDoctorDisplayId(doctor.doctorDisplayId)) return doctor.doctorDisplayId;

  const dept = getDepartmentAbbreviation(
    doctor.departmentId || doctor.deptId,
    doctor.departmentName || doctor.department?.name || doctor.specialization,
    doctor.departmentCode || doctor.department?.code
  );
  const initials = extractDoctorInitials(doctor.fullName || doctor.name || doctor.displayName);

  let candidateSeq = null;
  const matchNum = String(doctor.doctorId || doctor.id || '').match(/(\d+)$/);
  if (matchNum) {
    candidateSeq = parseInt(matchNum[1], 10);
  } else {
    candidateSeq = (existingDoctors.length || 0) + 1;
  }

  return formatDoctorDisplayId(dept, initials, candidateSeq);
}
