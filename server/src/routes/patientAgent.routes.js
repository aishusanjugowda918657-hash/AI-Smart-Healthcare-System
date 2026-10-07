/**
 * patientAgent.routes.js
 * Mount at: app.use('/api/patient-agent', patientAgentRoutes)
 *
 * POST /api/patient-agent/query
 *   Request: { question: "John Doe what disease is he suffering from?", uniqueId?: "..." }
 *   Response:
 *     status: 'answered'  → { success: true, status: 'answered', patient, intent, answer, sources }
 *     status: 'duplicate' → { success: true, status: 'duplicate', count, message, matches }
 *     status: 'not_found' → { success: true, status: 'not_found', message }
 *
 * GET /api/patient-agent/search-by-name?name=...
 * GET /api/patient-agent/search-by-id/:id
 *
 * Requires doctor or admin role.
 */

import express from 'express';
import { assertDbConnected } from '../config/firebase.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import {
  parseQuestion,
  lookupPatientByName,
  lookupPatientByUniqueId,
  fetchPatientRecords,
  generateAnswerResponse
} from '../services/patientAgentService.js';
import { writeAuditLog } from '../utils/audit.js';

const router = express.Router();

// Apply auth + role guard to every patient-agent endpoint
router.use(requireAuth, requireRole('doctor', 'admin'));

/**
 * POST /api/patient-agent/query
 * Natural-Language Patient Information Agent Endpoint
 */
router.post('/query', async (req, res) => {
  try {
    const { question, uniqueId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Question is required.'
      });
    }

    const db = assertDbConnected();
    let patient = null;
    let intent = 'GENERAL_INFO';
    let patientName = '';

    // Step 1: Extract intent & patient name from natural language question
    const parsed = await parseQuestion(question);
    intent = parsed.intent;
    patientName = parsed.patientName;

    // Step 2: Patient Resolution (Unique ID provided vs Name Lookup)
    if (uniqueId && uniqueId.trim()) {
      const lookupResult = await lookupPatientByUniqueId(db, uniqueId.trim());
      if (lookupResult.status === 'not_found') {
        return res.json({
          success: true,
          status: 'not_found',
          message: 'No patient found with this ID.'
        });
      }
      patient = lookupResult.patient;
    } else {
      if (!patientName) {
        return res.status(400).json({
          success: false,
          error: 'Could not identify a patient name in your question. Please include the patient\'s name (e.g. "John Doe what medicines is he taking?").'
        });
      }

      const lookupResult = await lookupPatientByName(db, patientName);

      if (lookupResult.status === 'not_found') {
        return res.json({
          success: true,
          status: 'not_found',
          message: 'No patient found with this name.'
        });
      }

      if (lookupResult.status === 'duplicate') {
        return res.json({
          success: true,
          status: 'duplicate',
          count: lookupResult.count,
          message: 'Multiple patients found with this name. Please enter the patient\'s unique ID.',
          matches: lookupResult.matches
        });
      }

      patient = lookupResult.patient;
    }

    // Step 3: Fetch ONLY required Firestore records for performance
    const records = await fetchPatientRecords(db, patient, intent);

    // Step 4: Generate factual markdown response (never inventing facts)
    const answer = await generateAnswerResponse({
      patient,
      intent,
      question,
      records
    });

    await writeAuditLog({
      actorUid: req.user?.uid,
      actorRole: req.user?.role || 'doctor',
      action: 'PATIENT_AGENT_LOOKUP',
      targetType: 'patient',
      targetId: patient.id,
      healthId: patient.patientHealthId || patient.id
    });

    return res.json({
      success: true,
      status: 'answered',
      patient: {
        id: patient.id,
        name: patient.fullName || patient.name || 'Patient',
        fullName: patient.fullName || patient.name || 'Patient',
        patientHealthId: patient.patientHealthId || patient.id
      },
      intent,
      answer,
      sources: records.sources
    });

  } catch (err) {
    console.error('patient-agent query endpoint error:', err);
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Server error while processing patient question.',
      message: err.message || 'Server error while processing patient question.'
    });
  }
});

/**
 * GET /api/patient-agent/search-by-name?name=...
 */
router.get('/search-by-name', async (req, res) => {
  const { name } = req.query;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Query parameter "name" is required.' });
  }

  try {
    const db = assertDbConnected();
    const result = await lookupPatientByName(db, name.trim());

    if (result.status === 'not_found') {
      return res.json({
        success: true,
        status: 'not_found',
        message: 'No existing patient found with this name.'
      });
    }

    if (result.status === 'duplicate') {
      return res.json({
        success: true,
        status: 'duplicate',
        message: 'Multiple patients found with this name. Please enter the patient\'s unique ID.',
        matches: result.matches
      });
    }

    return res.json({
      success: true,
      status: 'found',
      patient: result.patient
    });
  } catch (err) {
    console.error('patient-agent search-by-name error:', err);
    res.status(500).json({ success: false, error: 'Server error while searching by patient name.' });
  }
});

/**
 * GET /api/patient-agent/search-by-id/:id
 */
router.get('/search-by-id/:id', async (req, res) => {
  const { id } = req.params;

  if (!id || !id.trim()) {
    return res.status(400).json({ success: false, error: 'Patient ID is required.' });
  }

  try {
    const db = assertDbConnected();
    const result = await lookupPatientByUniqueId(db, id.trim());

    if (result.status === 'not_found') {
      return res.json({
        success: true,
        status: 'not_found',
        message: 'No patient found with this ID.'
      });
    }

    return res.json({
      success: true,
      status: 'found',
      patient: result.patient
    });
  } catch (err) {
    console.error('patient-agent search-by-id error:', err);
    res.status(500).json({ success: false, error: 'Server error while fetching patient by ID.' });
  }
});

export default router;
