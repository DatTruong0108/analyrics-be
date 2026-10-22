/* System Package */
import { ErrorDetails } from "@google/generative-ai";

/**
 * Free-tier Gemini models, best first: newest generation first, Flash ahead of
 * Flash Lite within a generation. Models with a 0 free quota (Pro, 2.0, 4 Argon)
 * are left out so they are never billed.
 */
export const ANALYSIS_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

/* Google Search grounding is free only on Gemini 2.x/2.5; Gemini 3+ has a 0 quota */
export const SEARCH_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] as const;

export type AIModelId = (typeof ANALYSIS_MODELS)[number] | (typeof SEARCH_MODELS)[number];

export const ALL_AI_MODELS: readonly AIModelId[] = Array.from(new Set<AIModelId>([...ANALYSIS_MODELS, ...SEARCH_MODELS]));

/* Used when a 429 carries no RetryInfo; per-minute quotas refill within a minute */
export const DEFAULT_QUOTA_COOLDOWN_MS = 60_000;

const QUOTA_FAILURE_TYPE = "type.googleapis.com/google.rpc.QuotaFailure";
const RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo";
const QUOTA_RESET_TIME_ZONE = "America/Los_Angeles";
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

interface QuotaViolation {
  quotaId?: string;
}

/**
 * In-memory record of which models are cooling down after a 429. State is per
 * process: a restart or a second instance only costs one extra 429 per model.
 */
export class AIModelQuotaTracker {
  private readonly exhaustedUntil = new Map<AIModelId, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  isAvailable(modelId: AIModelId): boolean {
    const until = this.exhaustedUntil.get(modelId);
    if (until === undefined) return true;
    if (this.now() >= until) {
      this.exhaustedUntil.delete(modelId);
      return true;
    }
    return false;
  }

  markExhausted(modelId: AIModelId, until: number): void {
    this.exhaustedUntil.set(modelId, until);
  }
}

/**
 * Turns a 429's errorDetails into the timestamp the model becomes usable again:
 * a daily quota waits for Google's reset (midnight Pacific), a per-minute quota
 * waits for the server-provided retryDelay.
 */
export function resolveQuotaCooldownUntil(errorDetails: ErrorDetails[] | undefined, now: number): number {
  const details = errorDetails || [];

  const violations = details
    .filter((detail) => detail["@type"] === QUOTA_FAILURE_TYPE)
    .flatMap((detail) => (Array.isArray(detail.violations) ? (detail.violations as QuotaViolation[]) : []));

  if (violations.some((violation) => /PerDay/i.test(violation.quotaId || ""))) {
    return nextQuotaResetAt(now);
  }

  const retryInfo = details.find((detail) => detail["@type"] === RETRY_INFO_TYPE);
  const retryDelay = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay : "";
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(retryDelay);

  return now + (seconds ? Math.ceil(Number(seconds[1]) * 1_000) : DEFAULT_QUOTA_COOLDOWN_MS);
}

/* Next midnight in America/Los_Angeles, when Gemini daily quotas reset */
export function nextQuotaResetAt(now: number): number {
  const sinceMidnight = msSincePacificMidnight(now);
  const candidate = now - sinceMidnight + DAY_MS;

  /* On a DST-change day the local day is 23h or 25h long; nudge back onto 00:00 */
  const drift = msSincePacificMidnight(candidate);
  if (drift === 0) return candidate;
  return drift > DAY_MS / 2 ? candidate + (DAY_MS - drift) : candidate - drift;
}

function msSincePacificMidnight(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: QUOTA_RESET_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return ((read("hour") * 60 + read("minute")) * 60 + read("second")) * 1_000 + (timestamp % 1_000);
}
