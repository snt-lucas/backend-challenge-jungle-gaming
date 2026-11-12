const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/i,
  /token/i,
  /secret/i,
  /auth(orization)?/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /cvv/i,
  /pin/i,
  /certificate/i,
];

const MASKED_VALUE = "[REDACTED]";

/**
 * Recursively sanitizes objects, arrays, and values to ensure sensitive information,
 * tokens, and secrets are masked prior to structured log output.
 *
 * @param value - Value or object structure to sanitize.
 * @param depth - Current recursion depth (capped at 8 to prevent deep nesting loops).
 * @param seen - WeakSet tracking visited object references to prevent circular loops.
 * @returns Sanitized object structure with sensitive fields replaced by [REDACTED].
 */
export function sanitizePayload<T = unknown>(value: T, depth = 0, seen = new WeakSet()): unknown {
  if (depth > 8) {
    return "[MAX_DEPTH_REACHED]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(value)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

    if (isSensitive) {
      sanitized[key] = MASKED_VALUE;
    } else if (typeof val === "object" && val !== null) {
      sanitized[key] = sanitizePayload(val, depth + 1, seen);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}
