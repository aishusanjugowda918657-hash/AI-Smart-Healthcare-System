/**
 * Pure Domain Module: Expected Consultation Duration & Wait Time (PRD Section 5.2)
 */

import { Complexity, VisitType } from './constants.js';

export const DEFAULT_DEPARTMENT_DURATIONS = Object.freeze({
  [VisitType.NEW]: {
    [Complexity.SIMPLE]: 10,
    [Complexity.MODERATE]: 20,
    [Complexity.COMPLEX]: 30
  },
  [VisitType.FOLLOWUP]: {
    [Complexity.SIMPLE]: 10,
    [Complexity.MODERATE]: 15,
    [Complexity.COMPLEX]: 20
  },
  [VisitType.REPORT_REVIEW]: {
    [Complexity.SIMPLE]: 10,
    [Complexity.MODERATE]: 10,
    [Complexity.COMPLEX]: 15
  },
  [VisitType.PROCEDURE]: {
    [Complexity.SIMPLE]: 30,
    [Complexity.MODERATE]: 45,
    [Complexity.COMPLEX]: 60
  }
});

/**
 * Pure function: Calculate expected consultation duration in minutes
 *
 * @param {Object} params
 * @param {Object} [params.department] - Department document
 * @param {Object} [params.consultationStats] - Doctor/Dept consultation stats doc
 * @param {string} [params.visitType='new'] - Visit type
 * @param {string} [params.complexity='moderate'] - Complexity
 * @returns {number} Expected duration in minutes
 */
export function getExpectedDuration({
  department,
  consultationStats,
  visitType = VisitType.NEW,
  complexity = Complexity.MODERATE
}) {
  // 1. Check historical average from consultationStats if at least 5 visits logged
  if (consultationStats && Array.isArray(consultationStats.recentDurationsMin) && consultationStats.recentDurationsMin.length >= 5) {
    if (typeof consultationStats.avgMin === 'number' && consultationStats.avgMin > 0) {
      return Math.round(consultationStats.avgMin);
    }
  }

  // 2. Department default from department doc
  if (department && department.defaultDurationsMin) {
    const deptMatrix = department.defaultDurationsMin;
    if (deptMatrix[visitType] && typeof deptMatrix[visitType][complexity] === 'number') {
      return deptMatrix[visitType][complexity];
    }
  }

  // 3. Fallback matrix
  const fallbackMatrix = DEFAULT_DEPARTMENT_DURATIONS[visitType] || DEFAULT_DEPARTMENT_DURATIONS[VisitType.NEW];
  return fallbackMatrix[complexity] || fallbackMatrix[Complexity.MODERATE] || 15;
}
