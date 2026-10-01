/**
 * Audit Logging Utility
 * Defined as per PRD Section 3.4 & 8.4
 */

import { getDb } from '../config/firebase.js';

export const writeAuditLog = async ({
  actorUid,
  actorRole,
  action,
  targetType,
  targetId,
  healthId = null,
  requestId = null
}) => {
  try {
    const db = getDb();
    if (!db) return;
    
    await db.collection('auditLogs').add({
      actorUid: actorUid || 'system',
      actorRole: actorRole || 'system',
      action,
      targetType,
      targetId: String(targetId),
      healthId: healthId || null,
      at: new Date(),
      requestId: requestId || null
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
};
