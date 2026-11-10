/** Financial quantities cross JSON boundaries as exact decimal strings. */
export function wireValue(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item) ?? "null");
}

export function failedResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(failedResult);
  return !!value && typeof value === "object" &&
    ("error" in value && Boolean(value.error) || "availability" in value && value.availability === "unavailable");
}
