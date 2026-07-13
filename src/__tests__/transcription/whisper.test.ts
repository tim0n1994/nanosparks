import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribeAudio } from '@/lib/transcription/whisper';

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    mockExecFile(cmd, args, opts, cb);
  }),
}));

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('returns segments on successful whisper execution', async () => {
    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, JSON.stringify({
        text: 'Hello world',
        language: 'en',
        segments: [
          { start: 0, end: 2, text: 'Hello' },
          { start: 2, end: 4, text: 'world' },
        ],
      }), '');
    });

    const result = await transcribeAudio('/tmp/test.mp3');

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello');
    expect(result[0].start).toBe(0);
    expect(result[1].end).toBe(4);
  });

  it('uses base model when WHISPER_MODEL_SIZE is invalid', async () => {
    const originalEnv = process.env.WHISPER_MODEL_SIZE;
    process.env.WHISPER_MODEL_SIZE = 'invalid-model';

    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      // args[2] should be the model size
      expect(args[2]).toBe('base');
      cb(null, JSON.stringify({
        text: '',
        language: 'en',
        segments: [{ start: 0, end: 1, text: 'ok' }],
      }), '');
    });

    await transcribeAudio('/tmp/test.mp3');

    process.env.WHISPER_MODEL_SIZE = originalEnv;
  });

  it('uses allowed model size when valid', async () => {
    const originalEnv = process.env.WHISPER_MODEL_SIZE;
    process.env.WHISPER_MODEL_SIZE = 'small';

    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      expect(args[2]).toBe('small');
      cb(null, JSON.stringify({
        text: '',
        language: 'en',
        segments: [{ start: 0, end: 1, text: 'ok' }],
      }), '');
    });

    await transcribeAudio('/tmp/test.mp3');

    process.env.WHISPER_MODEL_SIZE = originalEnv;
  });

  it('falls back to mock segments on whisper failure', async () => {
    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      cb(new Error('Whisper failed'), '', '');
    });

    const result = await transcribeAudio('/tmp/test.mp3');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toBe('Welcome to the podcast.');
  });

  it('throws on invalid JSON output', async () => {
    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, 'not json', '');
    });

    await expect(transcribeAudio('/tmp/test.mp3')).rejects.toThrow();
  });

  it('passes correct script path and audio path', async () => {
    mockExecFile.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('python3');
      expect(args[0]).toContain('whisper_transcribe.py');
      expect(args[1]).toBe('/tmp/test.mp3');
      cb(null, JSON.stringify({
        text: '',
        language: 'en',
        segments: [{ start: 0, end: 1, text: 'ok' }],
      }), '');
    });

    await transcribeAudio('/tmp/test.mp3');
  });
});
