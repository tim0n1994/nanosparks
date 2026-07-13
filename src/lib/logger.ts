type LogLevel = 'INFO' | 'ERROR' | 'WARN';

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[NanoSparks] ${ts} [${level}] ${message}${metaStr}`;
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(format('INFO', message, meta));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    console.error(format('ERROR', message, meta));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(format('WARN', message, meta));
  },
};
