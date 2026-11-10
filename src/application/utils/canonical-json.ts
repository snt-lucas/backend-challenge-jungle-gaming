import { createHash } from "node:crypto";

/**
 * Serializa um objeto em JSON canônico com chaves ordenadas recursivamente.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, v]) => v !== undefined)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`)
    .join(",")}}`;
}

/**
 * Calcula o hash SHA-256 do JSON canônico de um payload de negócio.
 */
export function computeCanonicalPayloadHash(payload: Record<string, unknown>): string {
  const canonical = canonicalJsonStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}
