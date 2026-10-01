/**
 * Injectable Clock Helper
 * Allows test suites to control and advance time deterministically
 * Defined as per PRD Section 3.3
 */

let mockTime = null;

export const clock = {
  now() {
    return mockTime ? new Date(mockTime) : new Date();
  },
  nowTimestamp() {
    return this.now().getTime();
  },
  setMockTime(dateOrIsoOrMs) {
    mockTime = new Date(dateOrIsoOrMs).getTime();
  },
  reset() {
    mockTime = null;
  }
};

export default clock;
