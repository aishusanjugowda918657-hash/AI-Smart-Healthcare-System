import {
  preparePatientSummary,
  recordSummaryCorrection,
  addDoctorPreNote,
  changeAppointmentComplexity
} from '../services/patientSummaryService.js';
import { formatSuccessResponse } from '../utils/errors.js';

/**
 * GET /api/doctor/appointments/:appointmentId/pre-consultation-summary
 * Returns factual patient summary, rule-based safety flags, and source references
 */
export const getPreConsultationSummary = async (req, res, next) => {
  try {
    const { appointmentId, id } = req.params;
    const targetId = appointmentId || id;
    const doctorUid = req.user?.uid || req.user?.id || req.headers['x-demo-uid'] || req.headers['x-test-uid'];
    const doctorRole = req.user?.role || req.headers['x-demo-role'] || req.headers['x-test-role'] || 'doctor';
    const doctorId = req.user?.doctorId || null;
    const forceRefresh = req.query.refresh === 'true';

    const result = await preparePatientSummary({
      appointmentId: targetId,
      doctorUid,
      doctorRole,
      doctorId,
      forceRefresh
    });

    // Support both new standard format and existing test format
    res.status(200).json({
      success: true,
      ...result,
      patientName: result.patient?.name || result.patientName,
      patientHealthId: result.healthId || result.patientHealthId,
      age: result.patient?.age ?? result.age,
      summary: {
        text: result.summary,
        summaryMode: result.summaryMode,
        flags: result.flags,
        sources: result.sources,
        sourceRefs: result.sources.map((s, idx) => ({ id: idx + 1, label: s })),
        doctorPreNotes: result.doctorPreNotes,
        isCorrected: result.isCorrected
      }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /api/doctor/appointments/:appointmentId/pre-consultation-summary/correct
 * Allows doctor to report/correct a summary detail with audit record
 */
export const postSummaryCorrection = async (req, res, next) => {
  try {
    const { appointmentId, id } = req.params;
    const targetId = appointmentId || id;
    const { correctedText, reason } = req.body;
    const doctorUid = req.user?.uid || req.user?.id || req.headers['x-demo-uid'] || req.headers['x-test-uid'];
    const doctorRole = req.user?.role || req.headers['x-demo-role'] || req.headers['x-test-role'] || 'doctor';

    if (!correctedText || !correctedText.trim()) {
      return res.status(400).json({ success: false, message: 'Corrected text is required.' });
    }

    const result = await recordSummaryCorrection({
      appointmentId: targetId,
      doctorUid,
      doctorRole,
      correctedText: correctedText.trim(),
      reason
    });

    res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /api/doctor/appointments/:appointmentId/pre-consultation-summary/note
 * Doctor adds a quick pre-consultation note
 */
export const postDoctorPreNote = async (req, res, next) => {
  try {
    const { appointmentId, id } = req.params;
    const targetId = appointmentId || id;
    const { note } = req.body;
    const doctorUid = req.user?.uid || req.user?.id || req.headers['x-demo-uid'] || req.headers['x-test-uid'];
    const doctorRole = req.user?.role || req.headers['x-demo-role'] || req.headers['x-test-role'] || 'doctor';

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, message: 'Note text is required.' });
    }

    const result = await addDoctorPreNote({
      appointmentId: targetId,
      doctorUid,
      doctorRole,
      noteText: note.trim()
    });

    res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /api/doctor/appointments/:appointmentId/complexity
 * Updates case complexity and triggers wait-time engine recalculation
 */
export const postChangeComplexity = async (req, res, next) => {
  try {
    const { appointmentId, id } = req.params;
    const targetId = appointmentId || id;
    const { complexity, extraDurationMin } = req.body;
    const doctorUid = req.user?.uid || req.user?.id || req.headers['x-demo-uid'] || req.headers['x-test-uid'];
    const doctorRole = req.user?.role || req.headers['x-demo-role'] || req.headers['x-test-role'] || 'doctor';

    const result = await changeAppointmentComplexity({
      appointmentId: targetId,
      doctorUid,
      doctorRole,
      complexity,
      extraDurationMin
    });

    res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
