/**
 * doctorDisplayIdService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Domain service for managing and formatting Doctor Display IDs.
 *
 * Format: DOC-DEPT-INITIALS-NNN
 *
 * Rules:
 * 1. DOC is the fixed prefix.
 * 2. DEPT is a consistent abbreviation derived from the doctor's department.
 * 3. INITIALS are derived from the doctor's name, excluding the title Dr.
 * 4. NNN is a unique, stable, zero-padded sequence.
 * 5. Inspect existing doctor records and check for duplicate IDs before assigning values.
 * 6. Keep Firebase UIDs and database document IDs unchanged for internal references.
 * 8. Do not overwrite existing IDs blindly or modify unrelated data.
 * ─────────────────────────────────────────────────────────────────────────────
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
  'neurology & neurosurgery': 'NEU',
  'dept-onco': 'ONC',
  'onco': 'ONC',
  'onc': 'ONC',
  'oncology': 'ONC',
  'dept-obgyn': 'OBG',
  'obgyn': 'OBG',
  'obg': 'OBG',
  'obstetrics & gynaecology': 'OBG',
  'obstetrics & gynecology': 'OBG',
  'gynecology': 'OBG',
  'gynaecology': 'OBG'
};

/**
 * Extracts clean, consistent 3-letter uppercase department abbreviation.
 */
export function getDepartmentAbbreviation(departmentId, departmentName, departmentCode) {
  const norm = (s) => (s ? String(s).trim().toLowerCase() : '');
  const idNorm = norm(departmentId);
  const nameNorm = norm(departmentName);
  const codeNorm = norm(departmentCode);

  if (idNorm && DEPARTMENT_ABBREVIATIONS[idNorm]) return DEPARTMENT_ABBREVIATIONS[idNorm];
  if (nameNorm && DEPARTMENT_ABBREVIATIONS[nameNorm]) return DEPARTMENT_ABBREVIATIONS[nameNorm];
  if (codeNorm && DEPARTMENT_ABBREVIATIONS[codeNorm]) return DEPARTMENT_ABBREVIATIONS[codeNorm];

  // Specific code overrides
  const rawCode = String(departmentCode || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (rawCode === 'CARD') return 'CAR';
  if (rawCode === 'ORTHO') return 'ORT';
  if (rawCode === 'DERM') return 'DER';
  if (rawCode.length >= 3) return rawCode.slice(0, 3);

  // Derivation from name or id
  const rawName = String(departmentName || departmentId || 'GEN').replace(/[^a-zA-Z]/g, '').toUpperCase();
  return rawName.slice(0, 3) || 'GEN';
}

/**
 * Extracts uppercase initials from doctor's full name, strictly excluding titles like Dr.
 * E.g. "Dr. Aarti Sunil Kamath" -> "ASK"
 *      "Dr. Anurag Ranjan" -> "AR"
 *      "Dr. Anusha Sharma P S" -> "ASPS"
 *      "Dr. Aditi Singhvi" -> "AS"
 */
export function extractDoctorInitials(fullNameOrName) {
  if (!fullNameOrName || typeof fullNameOrName !== 'string') {
    return 'DOC';
  }

  // Remove common medical title prefixes
  let cleaned = fullNameOrName.replace(/^(dr\.|dr|doctor|prof\.|prof)($|\s+)/i, '').trim();
  cleaned = cleaned.replace(/^dr\.?($|\s+)/i, '').trim();

  // Replace punctuation/periods with space to cleanly handle initial letters (e.g. "P.S." -> "P S")
  cleaned = cleaned.replace(/\./g, ' ');

  // Split into tokens
  const words = cleaned
    .split(/[\s_-]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    return 'DOC';
  }

  const initials = words.map((w) => w[0].toUpperCase()).join('');
  return initials || 'DOC';
}

/**
 * Formats display ID according to DOC-DEPT-INITIALS-NNN specification.
 */
export function formatDoctorDisplayId(deptAbbr, initials, seq) {
  const paddedSeq = String(seq).padStart(3, '0');
  return `DOC-${deptAbbr}-${initials}-${paddedSeq}`;
}

/**
 * Validates display ID format.
 */
export function isValidDoctorDisplayId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^DOC-[A-Z]+-[A-Z]+-\d{3,}$/.test(id);
}

/**
 * Parses a valid display ID into its components.
 */
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

/**
 * Assigns or validates a doctor's display ID.
 * - Inspects existing doctor records to prevent collisions/duplicates.
 * - Respects existing valid display IDs (does not overwrite blindly).
 * - Stable, zero-padded sequence.
 */
export function assignDoctorDisplayId(doctor, existingDoctors = []) {
  if (!doctor) return null;

  // Rule 8: If doctor already has a valid displayId, preserve it
  if (isValidDoctorDisplayId(doctor.displayId)) {
    return doctor.displayId;
  }
  if (isValidDoctorDisplayId(doctor.doctorDisplayId)) {
    return doctor.doctorDisplayId;
  }

  // Rule 5: Inspect existing doctors and collect all assigned display IDs and sequence numbers
  const usedDisplayIds = new Set();
  let maxSeq = 0;

  for (const d of existingDoctors) {
    if (!d) continue;
    const existingId = d.displayId || d.doctorDisplayId;
    if (isValidDoctorDisplayId(existingId)) {
      usedDisplayIds.add(existingId);
      const parsed = parseDoctorDisplayId(existingId);
      if (parsed && parsed.sequence > maxSeq) {
        maxSeq = parsed.sequence;
      }
    }
  }

  const dept = getDepartmentAbbreviation(
    doctor.departmentId || doctor.deptId,
    doctor.departmentName || doctor.specialization,
    doctor.departmentCode || doctor.deptCode
  );
  const initials = extractDoctorInitials(doctor.fullName || doctor.name || doctor.displayName);

  // Check if doctor has a natural numeric sequence from doctorId (e.g. DOC-001 -> 1, DOC-REAL-004 -> 4)
  let candidateSeq = null;
  const matchNum = String(doctor.doctorId || doctor.id || '').match(/(\d+)$/);
  if (matchNum) {
    const parsedNum = parseInt(matchNum[1], 10);
    const candidateId = formatDoctorDisplayId(dept, initials, parsedNum);
    if (!usedDisplayIds.has(candidateId)) {
      candidateSeq = parsedNum;
    }
  }

  if (candidateSeq === null) {
    candidateSeq = maxSeq + 1;
  }

  // Collision prevention loop: guarantee absolute uniqueness
  let finalId = formatDoctorDisplayId(dept, initials, candidateSeq);
  while (usedDisplayIds.has(finalId)) {
    candidateSeq++;
    finalId = formatDoctorDisplayId(dept, initials, candidateSeq);
  }

  return finalId;
}

/**
 * Assigns display IDs to a list of doctors in a deterministic, stable batch.
 */
export function assignBatchDoctorDisplayIds(doctors = []) {
  const assignedList = [];

  // Pass 1: Collect doctors with existing valid display IDs
  for (const doc of doctors) {
    if (isValidDoctorDisplayId(doc.displayId) || isValidDoctorDisplayId(doc.doctorDisplayId)) {
      const validId = isValidDoctorDisplayId(doc.displayId) ? doc.displayId : doc.doctorDisplayId;
      assignedList.push({ ...doc, displayId: validId, doctorDisplayId: validId });
    }
  }

  // Pass 2: Sort unassigned doctors stably by numeric ID suffix or doctorId/id
  const unassigned = doctors.filter(
    (d) => !isValidDoctorDisplayId(d.displayId) && !isValidDoctorDisplayId(d.doctorDisplayId)
  );

  unassigned.sort((a, b) => {
    const numA = (String(a.doctorId || a.id).match(/(\d+)$/) || [])[1];
    const numB = (String(b.doctorId || b.id).match(/(\d+)$/) || [])[1];
    if (numA && numB) {
      return parseInt(numA, 10) - parseInt(numB, 10);
    }
    return String(a.doctorId || a.id || '').localeCompare(String(b.doctorId || b.id || ''));
  });

  for (const doc of unassigned) {
    const displayId = assignDoctorDisplayId(doc, assignedList);
    assignedList.push({ ...doc, displayId, doctorDisplayId: displayId });
  }

  // Map back to preserve original list order
  const displayIdMap = new Map(assignedList.map((d) => [d.id || d.doctorId || d.uid, d.displayId]));
  return doctors.map((doc) => {
    const key = doc.id || doc.doctorId || doc.uid;
    const displayId = displayIdMap.get(key) || assignDoctorDisplayId(doc, assignedList);
    return {
      ...doc,
      displayId,
      doctorDisplayId: displayId
    };
  });
}

/**
 * Synchronizes display IDs for all doctor records in Firestore without touching UIDs or document IDs.
 */
export async function syncDoctorDisplayIdsInDb(db) {
  const doctorsSnap = await db.collection('doctors').get();
  if (doctorsSnap.empty) {
    return { updatedCount: 0, totalDoctors: 0 };
  }

  const doctorDocs = doctorsSnap.docs.map((doc) => ({
    docRef: doc.ref,
    data: { id: doc.id, ...doc.data() }
  }));

  const doctorsData = doctorDocs.map((d) => d.data);
  const updatedBatch = assignBatchDoctorDisplayIds(doctorsData);

  const batch = db.batch();
  let updatedCount = 0;

  for (let i = 0; i < doctorDocs.length; i++) {
    const orig = doctorDocs[i].data;
    const assigned = updatedBatch[i];
    if (orig.displayId !== assigned.displayId || orig.doctorDisplayId !== assigned.doctorDisplayId) {
      batch.set(
        doctorDocs[i].docRef,
        {
          displayId: assigned.displayId,
          doctorDisplayId: assigned.displayId,
          updatedAt: new Date()
        },
        { merge: true }
      );
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    await batch.commit();
  }

  return { updatedCount, totalDoctors: doctorDocs.length };
}
