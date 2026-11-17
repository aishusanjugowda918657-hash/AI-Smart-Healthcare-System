import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { createPatientSupportRequest } from '../services/patientSupportService.js';

const toIso = (value) => value?.toDate?.()?.toISOString?.() || (value instanceof Date ? value.toISOString() : value || null);

export const createSupportRequest = async (req, res, next) => {
  try {
    const result = await createPatientSupportRequest({
      patientUid: req.user.uid,
      category: req.body?.category
    });
    const statusCode = result.notificationSent ? 201 : 202;
    return res.status(statusCode).json(formatSuccessResponse({
      ...result,
      message: result.notificationSent
        ? 'Your request has been sent to Reception.'
        : 'Your request was saved, but Reception could not be notified. Please contact the hospital reception directly.'
    }));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json(formatErrorResponse('SUPPORT_REQUEST_UNAVAILABLE', error.message));
    }
    next(error);
  }
};

export const getSupportRequests = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const snapshot = await db.collection('supportRequests').get();
    const requests = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        patientName: data.patientName || 'Patient',
        patientPhone: data.patientPhone || null,
        category: data.category || 'GENERAL_ASSISTANCE',
        status: data.status || 'pending',
        notificationStatus: data.notificationStatus || 'pending',
        createdAt: toIso(data.createdAt),
        acknowledgedAt: toIso(data.acknowledgedAt),
        resolvedAt: toIso(data.resolvedAt)
      };
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 100);

    return res.status(200).json(formatSuccessResponse({ requests }));
  } catch (error) {
    next(error);
  }
};

export const updateSupportRequestStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['acknowledged', 'resolved'].includes(status)) {
      return res.status(400).json(formatErrorResponse('INVALID_STATUS', 'Status must be acknowledged or resolved.'));
    }

    const db = assertDbConnected();
    const ref = db.collection('supportRequests').doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Support request not found.'));
    }

    const current = snapshot.data().status || 'pending';
    if (status === 'acknowledged' && current !== 'pending') {
      return res.status(409).json(formatErrorResponse('INVALID_TRANSITION', 'Only pending requests can be acknowledged.'));
    }
    if (status === 'resolved' && current !== 'acknowledged') {
      return res.status(409).json(formatErrorResponse('INVALID_TRANSITION', 'A request must be acknowledged before it can be resolved.'));
    }

    const now = clock.now();
    const updates = { status, updatedAt: now };
    if (status === 'acknowledged') {
      updates.acknowledgedBy = req.user.uid;
      updates.acknowledgedAt = now;
    } else {
      updates.resolvedBy = req.user.uid;
      updates.resolvedAt = now;
    }
    await ref.update(updates);

    return res.status(200).json(formatSuccessResponse({ id, status }));
  } catch (error) {
    next(error);
  }
};
