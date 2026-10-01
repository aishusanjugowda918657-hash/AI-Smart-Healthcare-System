/**
 * Service to sync doctor-confirmed prescription reminder times to patient schedule
 * and calculate patient adherence rate metrics.
 */
export const calculateAdherenceRate = (logs = []) => {
  if (logs.length === 0) return 100; // Default 100% adherence if no logs recorded yet

  const takenCount = logs.filter((l) => l.status === 'taken').length;
  const totalCount = logs.length;

  return Math.round((takenCount / totalCount) * 100);
};
