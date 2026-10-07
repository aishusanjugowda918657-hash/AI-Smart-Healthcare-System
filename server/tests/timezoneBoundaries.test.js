import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOSPITAL_TZ = 'Asia/Kolkata';

describe('Timezone and Midnight Boundaries (UTC vs IST)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should compute the correct "today" date string in IST even if UTC is still on the previous day', () => {
    // 1 AM IST on Oct 6 is 19:30 UTC on Oct 5.
    const dateInUTC = new Date('2026-10-05T19:30:00Z');
    vi.setSystemTime(dateInUTC);

    // If we just use UTC date:
    const utcDay = dateInUTC.toISOString().split('T')[0];
    expect(utcDay).toBe('2026-10-05');

    // If we correctly compute using IST:
    const istDay = dayjs().tz(HOSPITAL_TZ).format('YYYY-MM-DD');
    expect(istDay).toBe('2026-10-06');
  });

  it('should correctly determine if a slot time has passed in IST', () => {
    // Current time: 10:15 AM IST on Oct 6 (04:45 UTC)
    const dateInUTC = new Date('2026-10-06T04:45:00Z');
    vi.setSystemTime(dateInUTC);

    const nowIST = dayjs().tz(HOSPITAL_TZ);
    const todayStr = nowIST.format('YYYY-MM-DD');
    expect(todayStr).toBe('2026-10-06');

    // Slot 1: 09:30 (Already passed)
    const slot1Str = '09:30';
    const [h1, m1] = slot1Str.split(':').map(Number);
    const slot1DateTime = nowIST.startOf('day').hour(h1).minute(m1);
    expect(slot1DateTime.isBefore(nowIST)).toBe(true);

    // Slot 2: 10:30 (In the future)
    const slot2Str = '10:30';
    const [h2, m2] = slot2Str.split(':').map(Number);
    const slot2DateTime = nowIST.startOf('day').hour(h2).minute(m2);
    expect(slot2DateTime.isBefore(nowIST)).toBe(false);
  });
});
