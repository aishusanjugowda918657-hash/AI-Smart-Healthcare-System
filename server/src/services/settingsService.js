import { assertDbConnected } from '../config/firebase.js';

export const DEFAULT_SETTINGS = {
  undoCancelMin: 10,
  undoWindowMinutes: 10,
  checkinDeadlineMinBefore: 10,
  graceMin: 5,
  graceMinutes: 5,
  tier1MaxMin: 10,
  tier2MaxMin: 30,
  tier3MaxMin: 60,
  fairnessBumpThresholdMinutes: 45,
  noShowMinutes: 60
};

/**
 * Fetches settings/global from Firestore merged with defaults
 */
export async function getGlobalSettings() {
  try {
    const db = assertDbConnected();
    const snap = await db.collection('settings').doc('global').get();
    if (!snap.exists) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...snap.data() };
  } catch (err) {
    console.warn('⚠️ getGlobalSettings failed, using defaults:', err.message);
    return { ...DEFAULT_SETTINGS };
  }
}
