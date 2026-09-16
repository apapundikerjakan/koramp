/**
 * Unit tests for the Active Defense escalation engine.
 * Fast, no server/DB writes on failure paths (level math is pure).
 */
import { levelForFailures, subnetOf, fingerprintOf, SEC, GENERIC_BLOCK_MESSAGE, banDurationHours, formatBanDuration, formatRemaining } from './security';

describe('escalation thresholds (§5: 50/100/200/400/800)', () => {
  const cases: Array<[number, number]> = [
    [0, 0], [49, 0], [50, 1], [99, 1], [100, 2], [199, 2],
    [200, 3], [399, 3], [400, 4], [799, 4], [800, 5], [100000, 5],
  ];
  for (const [n, level] of cases) {
    it(`${n} failures → level ${level}`, () => {
      expect(levelForFailures(n)).toBe(level);
    });
  }

  it('thresholds default to spec values but are env-overridable', () => {
    expect([SEC.l1, SEC.l2, SEC.l3, SEC.l4, SEC.l5]).toEqual([50, 100, 200, 400, 800]);
  });
});

describe('identity helpers (IP is approximate)', () => {
  it('IPv4 /24 grouping', () => {
    expect(subnetOf('1.2.3.4')).toBe('1.2.3.0/24');
  });
  it('IPv6 /64 grouping', () => {
    expect(subnetOf('2001:db8:abcd:0012::1')).toBe('2001:db8:abcd:0012::/64');
  });
  it('unknown → null', () => {
    expect(subnetOf('unknown')).toBeNull();
  });
  it('fingerprint is stable and opaque', () => {
    const a = fingerprintOf('1.2.3.4', 'UA');
    expect(a).toBe(fingerprintOf('1.2.3.4', 'UA'));
    expect(a).not.toContain('1.2.3.4');
    expect(a).toHaveLength(32);
  });
});

describe('generic block message (no leakage)', () => {
  it('reveals no thresholds, rules, or infra details', () => {
    const msg = GENERIC_BLOCK_MESSAGE.toLowerCase();
    for (const leak of ['50 failures', '100 ', 'level ', 'quarantine', 'ip address', 'ip ban', 'database', 'prisma', 'your ip']) {
      expect(msg).not.toContain(leak);
    }
    expect(msg).toMatch(/temporarily restricted/);
  });
});

describe('progressive ban durations (BAN #N = N hours, capped)', () => {
  it.each([
    [1, 24, 1], [2, 24, 2], [3, 24, 3], [6, 24, 6],
    [24, 24, 24], [25, 24, 24], [100, 24, 24], [0, 24, 1], [-3, 24, 1],
  ])('violation #%i (cap %ih) → %ih', (n, cap, hours) => {
    expect(banDurationHours(n, cap)).toBe(hours);
  });

  it('formats durations and countdowns server-side', () => {
    expect(formatBanDuration(1)).toBe('1 hour');
    expect(formatBanDuration(3)).toBe('3 hours');
    expect(formatRemaining(93784)).toBe('26:03:04');
    expect(formatRemaining(61)).toBe('00:01:01');
  });
});
