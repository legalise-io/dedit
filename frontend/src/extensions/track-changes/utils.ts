/**
 * Generate a unique ID for a track change.
 */
export function generateChangeId(type: "ins" | "del"): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current ISO date string.
 */
export function getCurrentDate(): string {
  return new Date().toISOString();
}
