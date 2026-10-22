/* Application Package */
import {
  AIModelQuotaTracker,
  ANALYSIS_MODELS,
  DEFAULT_QUOTA_COOLDOWN_MS,
  SEARCH_MODELS,
  nextQuotaResetAt,
  resolveQuotaCooldownUntil,
} from './ai-model-pool.util';

/* 2026-10-22 10:00 in Los Angeles (PDT, UTC-7) */
const NOW = Date.parse('2026-10-22T17:00:00.000Z');

const quotaFailure = (quotaId: string) => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaId }],
});

const retryInfo = (retryDelay: string) => ({
  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
  retryDelay,
});

describe('model lists', () => {
  it('only uses Gemini 2.5 for Google Search grounding (Gemini 3+ grounding has no free quota)', () => {
    expect(SEARCH_MODELS.every((id) => id.startsWith('gemini-2.5'))).toBe(true);
  });

  it('starts analysis from the newest Flash and ends with the oldest Flash Lite', () => {
    expect(ANALYSIS_MODELS[0]).toBe('gemini-3.8-flash');
    expect(ANALYSIS_MODELS[ANALYSIS_MODELS.length - 1]).toBe('gemini-2.5-flash-lite');
  });
});

describe('AIModelQuotaTracker', () => {
  it('treats an unseen model as available', () => {
    const tracker = new AIModelQuotaTracker(() => NOW);
    expect(tracker.isAvailable('gemini-3.8-flash')).toBe(true);
  });

  it('blocks a model until its cooldown passes, then frees it again', () => {
    let now = NOW;
    const tracker = new AIModelQuotaTracker(() => now);

    tracker.markExhausted('gemini-3.8-flash', NOW + 30_000);
    expect(tracker.isAvailable('gemini-3.8-flash')).toBe(false);
    expect(tracker.isAvailable('gemini-3.6-flash')).toBe(true);

    now = NOW + 29_999;
    expect(tracker.isAvailable('gemini-3.8-flash')).toBe(false);

    now = NOW + 30_000;
    expect(tracker.isAvailable('gemini-3.8-flash')).toBe(true);
  });
});

describe('resolveQuotaCooldownUntil', () => {
  it('waits for the daily reset when a per-day quota is violated', () => {
    const until = resolveQuotaCooldownUntil(
      [quotaFailure('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), retryInfo('20s')],
      NOW,
    );
    expect(until).toBe(Date.parse('2026-10-23T07:00:00.000Z'));
  });

  it('honours retryDelay for a per-minute quota', () => {
    const until = resolveQuotaCooldownUntil(
      [quotaFailure('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), retryInfo('33.4s')],
      NOW,
    );
    expect(until).toBe(NOW + 33_400);
  });

  it('falls back to the default cooldown when the 429 carries no details', () => {
    expect(resolveQuotaCooldownUntil(undefined, NOW)).toBe(NOW + DEFAULT_QUOTA_COOLDOWN_MS);
  });
});

describe('nextQuotaResetAt', () => {
  it('returns the next midnight in Los Angeles during daylight time (UTC-7)', () => {
    expect(nextQuotaResetAt(NOW)).toBe(Date.parse('2026-10-23T07:00:00.000Z'));
  });

  it('returns the next midnight in Los Angeles during standard time (UTC-8)', () => {
    expect(nextQuotaResetAt(Date.parse('2026-12-01T20:00:00.000Z'))).toBe(Date.parse('2026-12-02T08:00:00.000Z'));
  });

  it('lands on midnight across the DST fall-back day (25-hour day)', () => {
    /* 2026-11-01 00:30 PDT, before clocks fall back at 02:00 */
    expect(nextQuotaResetAt(Date.parse('2026-11-01T07:30:00.000Z'))).toBe(Date.parse('2026-11-02T08:00:00.000Z'));
  });

  it('lands on midnight across the DST spring-forward day (23-hour day)', () => {
    /* 2026-03-08 01:00 PST, before clocks spring forward at 02:00 */
    expect(nextQuotaResetAt(Date.parse('2026-03-08T09:00:00.000Z'))).toBe(Date.parse('2026-03-09T07:00:00.000Z'));
  });
});
