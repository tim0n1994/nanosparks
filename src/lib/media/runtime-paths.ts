import { isAbsolute, join } from 'node:path';

function directoryOverride(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!value.trim() || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute directory path`);
  }
  return value;
}

export function getAudioOutputDir(): string {
  return directoryOverride('NSP_AUDIO_DIR', '/tmp/nanosparks-audio');
}

export function getUploadDir(): string {
  return directoryOverride('UPLOAD_DIR', join(process.cwd(), 'data', 'uploads'));
}
