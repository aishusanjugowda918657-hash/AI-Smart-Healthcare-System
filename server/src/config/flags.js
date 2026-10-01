/**
 * System Feature Flags Config
 * Defined as per PRD Section 3.5
 */

import env from './env.js';

export const flags = {
  get ai() {
    return env.FLAG_AI;
  },
  get push() {
    return env.FLAG_PUSH;
  },
  get scheduler() {
    return env.FLAG_SCHEDULER;
  }
};

export default flags;
