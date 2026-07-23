/**
 * Structured logger — emits single-line JSON to stdout/stderr for easy
 * ingestion by log aggregators (Datadog, Loki, CloudWatch). Keeps the same
 * info/warn/error interface as the previous logger so call sites are unchanged.
 *
 * INFO → stdout; WARN/ERROR → stderr. Each line is a self-contained JSON object.
 */

type LogLevel = 'INFO' | 'ERROR' | 'WARN';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  meta?: Record<string, unknown>;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { level, msg: message, ts: new Date().toISOString() };
  if (meta && Object.keys(meta).length > 0) entry.meta = meta;
  const line = JSON.stringify(entry);
  if (level === 'INFO') process.stdout.write(line + '\n');
  else process.stderr.write(line + '\n');
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => emit('INFO', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('ERROR', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('WARN', message, meta),
};
