/**
 * Quota and Usage Tracker
 * Keeps running estimate of Firestore reads, writes, and Gemini calls.
 * Throws QuotaExhaustedError if RESOURCE_EXHAUSTED occurs.
 */

export class QuotaExhaustedError extends Error {
  constructor(message = 'Firebase/Gemini quota exhausted (RESOURCE_EXHAUSTED)') {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.code = 'RESOURCE_EXHAUSTED';
  }
}

export class QuotaTracker {
  constructor() {
    this.reads = 0;
    this.writes = 0;
    this.geminiCalls = 0;
    this.stageStats = {};
    this.currentStage = 'init';
  }

  setStage(stageName) {
    this.currentStage = stageName;
    if (!this.stageStats[stageName]) {
      this.stageStats[stageName] = { reads: 0, writes: 0, geminiCalls: 0 };
    }
  }

  trackRead(count = 1) {
    this.reads += count;
    if (this.stageStats[this.currentStage]) {
      this.stageStats[this.currentStage].reads += count;
    }
  }

  trackWrite(count = 1) {
    this.writes += count;
    if (this.stageStats[this.currentStage]) {
      this.stageStats[this.currentStage].writes += count;
    }
  }

  trackGemini(count = 1) {
    this.geminiCalls += count;
    if (this.stageStats[this.currentStage]) {
      this.stageStats[this.currentStage].geminiCalls += count;
    }
  }

  checkError(error) {
    if (!error) return;
    const msg = String(error.message || error.details || error.code || '');
    if (
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Quota exceeded') ||
      error.code === 8 ||
      error.status === 429
    ) {
      throw new QuotaExhaustedError(`RESOURCE_EXHAUSTED: ${msg}`);
    }
  }

  getStageEstimate(stageName) {
    return this.stageStats[stageName] || { reads: 0, writes: 0, geminiCalls: 0 };
  }

  getTotalEstimate() {
    return {
      reads: this.reads,
      writes: this.writes,
      geminiCalls: this.geminiCalls
    };
  }
}

export const quotaTracker = new QuotaTracker();
