/**
 * Structured failure logging for storage adapters.
 *
 * Adapters intentionally convert every unexpected failure into a redacted public error (the
 * response contract forbids internal details), which historically made production diagnosis
 * depend entirely on request IDs. This helper records the failing scope into Workers Logs
 * *before* the conversion, without ever logging bind values, SQL text, source responses or other
 * sensitive data — the same redaction discipline as the Cron handler logs.
 *
 * Errors whose class names are listed below are deliberate fail-closed outcomes thrown by the
 * same catch (validation, malformed envelopes), not unexpected failures — logging them would be
 * duplicate noise, so they are skipped.
 */
const KNOWN_STORAGE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ReadModelStorageError",
  "DailyScheduleError",
  "DailyPublicationTargetError",
  "DailyBriefError",
  "ThesisDraftError",
  "ThesisPublicationError",
  "ManualSourceRunError",
]);

export function reportStorageFailure(scope: string, error?: unknown): void {
  if (error === undefined) {
    // 裸 catch（无错误对象）仍然记录作用域，便于区分"哪个路径"失败。
    console.error(JSON.stringify({ level: "error", scope, kind: "unknown" }));
    return;
  }
  const kind = error instanceof Error ? error.name : typeof error;
  if (KNOWN_STORAGE_ERROR_NAMES.has(kind)) return;
  console.error(JSON.stringify({ level: "error", scope, kind }));
}
