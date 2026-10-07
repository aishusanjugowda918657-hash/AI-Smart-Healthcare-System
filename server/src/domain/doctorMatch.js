import fs from 'fs';
import path from 'path';

let keywordMap = null;
try {
  const mapPath = path.resolve(process.cwd(), 'src/config/clinical/specialtyKeywords.json');
  keywordMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch (e) {
  // Ignore
}

export const deriveSpecialtyTags = (reasonText = '') => {
  const tags = new Set();
  const lowerReason = reasonText.toLowerCase();
  if (keywordMap) {
    for (const [specialty, keywords] of Object.entries(keywordMap)) {
      for (const kw of keywords) {
        if (lowerReason.includes(kw)) {
          tags.add(specialty);
        }
      }
    }
  }
  return Array.from(tags);
};

export const rankDoctors = ({
  doctors = [],
  patient = {},
  triage = {},
  previousDoctorId = null,
  nextSlotByDoctor = {},
  queueLengthByDoctor = {},
  language = 'en',
  weights = {
    specialty: 0.30,
    ageGroup: 0.15,
    experience: 0.20,
    availability: 0.20,
    language: 0.05,
    continuity: 0.10
  }
}) => {
  const { urgency, complexity, specialtyTags = [] } = triage;
  const patientAgeGroup = patient.age && patient.age >= 60 ? 'senior' : (patient.age && patient.age <= 12 ? 'child' : 'adult');

  const ranked = doctors.map(doc => {
    let score = 0;
    const matchReasons = [];
    const docId = doc.doctorId || doc.id;

    // Hard filter: if triage dept falls back, we assume the controller already filtered doctors array.
    if (doc.active === false) {
      score = -1000;
      return { ...doc, score, matchReasons, queueLength: 0, nextAvailable: null };
    }

    // Specialty overlap
    const docSpecialtiesRaw = doc.specialties || doc.expertise || [];
    const docSpecialties = docSpecialtiesRaw.map(s => String(s).toLowerCase());
    const matchedSpecialties = docSpecialtiesRaw.filter((s, idx) => {
      const sLower = docSpecialties[idx];
      return specialtyTags.some(tag => {
        const tLower = String(tag).toLowerCase();
        return sLower.includes(tLower) || tLower.includes(sLower);
      });
    });
    if (matchedSpecialties.length > 0) {
      const overlapPct = matchedSpecialties.length / Math.max(specialtyTags.length, 1);
      score += overlapPct * weights.specialty;
      matchReasons.push(`Matches your condition (${matchedSpecialties.join(', ')})`);
    }

    // Age group fit
    const docAgeGroups = doc.ageGroups || [];
    if (docAgeGroups.includes(patientAgeGroup)) {
      score += weights.ageGroup;
      matchReasons.push(patientAgeGroup === 'child' ? 'Pediatric specialist' : patientAgeGroup === 'senior' ? 'Specializes in senior care' : 'Adult care specialist');
    }

    // Experience fit
    if (doc.experienceYears) {
      if (complexity === 'complex' || urgency === 'urgent' || urgency === 'emergency') {
        if (doc.experienceYears >= 10) {
          score += weights.experience;
          matchReasons.push(`${doc.experienceYears}+ years of experience for complex cases`);
        } else {
          score += (doc.experienceYears / 10) * weights.experience;
          matchReasons.push(`${doc.experienceYears} years of experience`);
        }
      } else {
        // Simple case: avoid overloading most experienced, prefer mid-level
        if (doc.experienceYears >= 3 && doc.experienceYears <= 10) {
          score += weights.experience;
          matchReasons.push(`${doc.experienceYears} years of experience`);
        } else {
          score += 0.5 * weights.experience;
          matchReasons.push(`${doc.experienceYears} years of experience`);
        }
      }
    }

    // Availability
    const nextSlot = nextSlotByDoctor[docId];
    const qLen = queueLengthByDoctor[docId] || 0;
    
    if (nextSlot) {
      let availScore = 0.5; // base for having a slot
      const isToday = nextSlot.date === new Date().toISOString().split('T')[0];
      if (isToday) availScore += 0.3;
      if (qLen < 5) availScore += 0.2;
      score += availScore * weights.availability;
      matchReasons.push(`Next available ${isToday ? 'today' : 'on ' + nextSlot.date} at ${nextSlot.startAt}`);
    } else {
      matchReasons.push(`No slots available`);
    }

    // Language
    const docLanguages = doc.languages || [];
    if (docLanguages.includes(language)) {
      score += weights.language;
      const langNames = { en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil' };
      matchReasons.push(`Speaks ${langNames[language] || language}`);
    }

    // Continuity
    if (previousDoctorId && previousDoctorId === docId) {
      score += weights.continuity;
      matchReasons.push('Your previous doctor');
    }

    return {
      ...doc,
      score,
      matchReasons,
      queueLength: qLen,
      nextAvailable: nextSlot
    };
  });

  // Urgent cases rank by availability
  if (urgency === 'urgent' || urgency === 'emergency') {
    ranked.sort((a, b) => {
      const aNext = a.nextAvailable ? a.nextAvailable.startAt : '23:59';
      const bNext = b.nextAvailable ? b.nextAvailable.startAt : '23:59';
      if (aNext !== bNext) return aNext.localeCompare(bNext);
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      if (a.queueLength !== b.queueLength) return a.queueLength - b.queueLength;
      return (a.name || '').localeCompare(b.name || '');
    });
  } else {
    // Tie-break: queue length asc, name asc
    ranked.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
      if (a.queueLength !== b.queueLength) return a.queueLength - b.queueLength;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  return ranked.filter(d => d.score >= 0 && d.active !== false); // filter out active=false
};
