import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QwenAsrProvider } from '@/lib/transcription/qwen-asr';

vi.hoisted(() => { process.env.QWEN_ASR_CLI = '/dev/null'; });
const cli = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: cli.execFile, default: { execFile: cli.execFile } }));

describe('QwenAsrProvider', () => {
  let fixtureDir: string;
  let mediaPath: string;
  let outputDirs: string[];

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(join(tmpdir(), 'qwen-asr-test-'));
    mediaPath = join(fixtureDir, 'audio.sample.wav');
    fs.writeFileSync(mediaPath, 'test media must survive');
    outputDirs = [];
    const exists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation(path => String(path).endsWith('/mlx-qwen3-asr') || exists(path));
    cli.execFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    for (const dir of outputDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function mockCli(output: unknown, failure?: Error, omitOutput = false): void {
    cli.execFile.mockImplementation((_file, args: string[], _options, callback) => {
      const outputFlag = args.indexOf('--output-dir');
      if (outputFlag >= 0) {
        const directory = args[outputFlag + 1];
        outputDirs.push(directory);
        if (!omitOutput) fs.writeFileSync(join(directory, 'audio.sample.json'), typeof output === 'string' ? output : JSON.stringify(output));
      }
      callback(failure ?? null, { stdout: 'Plain transcript printed by the CLI, not JSON.', stderr: '' });
    });
  }

  it('returns qwen-asr as provider name', () => {
    const p = new QwenAsrProvider();
    expect(p.getProviderName()).toBe('qwen-asr');
  });

  it('throws on missing media file', async () => {
    const p = new QwenAsrProvider();
    await expect(p.transcribe({ mediaPath: '/nonexistent/audio.wav' })).rejects.toThrow('media file not found');
  });

  it('reads timestamp JSON from unique output directories and preserves the media input', async () => {
    mockCli({ text: 'Hello world.', language: 'English', segments: [{ start: 0.125, end: 2.5, text: ' Hello world. ', speaker: 'SPEAKER_00' }], chunks: [{ start: 0, end: 3.25, text: 'Hello world.' }] });
    const provider = new QwenAsrProvider();
    const result = await provider.transcribe({ mediaPath, language: 'English' });
    expect(result).toEqual({ provider: 'qwen-asr', language: 'English', durationMs: 3250, segments: [{ startMs: 125, endMs: 2500, text: 'Hello world.', speakerLabel: 'SPEAKER_00' }] });
    await provider.transcribe({ mediaPath, language: 'English' });
    expect(outputDirs).toHaveLength(2);
    expect(new Set(outputDirs).size).toBe(2);
    for (const directory of outputDirs) expect(fs.existsSync(directory)).toBe(false);
    expect(fs.readFileSync(mediaPath, 'utf8')).toBe('test media must survive');
    const args = cli.execFile.mock.calls[0][1];
    expect(args).toEqual([mediaPath, '-f', 'json', '--output-dir', outputDirs[0], '--timestamps', '--language', 'English']);
  });

  it('uses real chunk timestamps when the CLI has no aligned segments', async () => {
    mockCli({ text: 'First. Second.', language: 'English', chunks: [{ start: 0, end: 4, text: 'First.' }, { start: 4, end: 8.125, text: 'Second.' }] });
    const result = await new QwenAsrProvider().transcribe({ mediaPath, language: 'auto' });
    expect(result.durationMs).toBe(8125);
    expect(result.segments).toEqual([{ startMs: 0, endMs: 4000, text: 'First.', speakerLabel: undefined }, { startMs: 4000, endMs: 8125, text: 'Second.', speakerLabel: undefined }]);
    expect(cli.execFile.mock.calls[0][1]).not.toContain('--language');
  });

  it.each(['cli-error', 'invalid-json', 'missing-output'])('cleans temporary output after %s without deleting input', async mode => {
    mockCli('not json', mode === 'cli-error' ? new Error('CLI failed') : undefined, mode === 'missing-output');
    await expect(new QwenAsrProvider().transcribe({ mediaPath })).rejects.toThrow();
    expect(outputDirs).toHaveLength(1);
    expect(fs.existsSync(outputDirs[0])).toBe(false);
    expect(fs.existsSync(mediaPath)).toBe(true);
  });

  it('groups aligned English words longer than four characters with spaces and bounded text', async () => {
    mockCli({ language: 'English', segments: Array.from({ length: 20 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: 'international' })) });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toHaveLength(5);
    expect(result.segments[0]).toEqual({ startMs: 0, endMs: 1900, text: 'international international international international', speakerLabel: undefined });
    expect(result.segments.at(-1)?.endMs).toBe(9900);
    expect(result.segments.flatMap(segment => segment.text.split(' '))).toHaveLength(20);
  });

  it('splits before a silence gap and preserves each side of its timestamp boundary', async () => {
    mockCli({ language: 'English', segments: Array.from({ length: 20 }, (_, i) => ({ start: i * 0.2 + (i >= 10 ? 2 : 0), end: i * 0.2 + 0.1 + (i >= 10 ? 2 : 0), text: 'go' })) });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 1900, text: Array(10).fill('go').join(' '), speakerLabel: undefined },
      { startMs: 4000, endMs: 5900, text: Array(10).fill('go').join(' '), speakerLabel: undefined },
    ]);
  });

  it('keeps speaker changes and punctuation while merging a short English word sequence', async () => {
    mockCli({ language: 'English', segments: [
      { start: 0, end: 0.4, text: "We're", speaker: 'A' },
      { start: 0.4, end: 0.8, text: 'ready.', speaker: 'A' },
      { start: 0.8, end: 1, text: 'You', speaker: 'A' },
      { start: 1, end: 1.4, text: 'are', speaker: 'B' },
      { start: 1.4, end: 2, text: 'welcome!', speaker: 'B' },
    ] });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 800, text: "We're ready.", speakerLabel: 'A' },
      { startMs: 800, endMs: 1000, text: 'You', speakerLabel: 'A' },
      { startMs: 1000, endMs: 2000, text: 'are welcome!', speakerLabel: 'B' },
    ]);
  });

  it('joins aligned Chinese characters without spaces', async () => {
    mockCli({ language: 'Chinese', segments: [...'今天我们一起讨论新的想法'].map((text, i) => ({ start: i, end: i + 1, text })) });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual([{ startMs: 0, endMs: 12000, text: '今天我们一起讨论新的想法', speakerLabel: undefined }]);
  });

  it('preserves spaces between short aligned Korean words', async () => {
    mockCli({ language: 'Korean', segments: ['나는', '너를', '믿어'].map((text, i) => ({ start: i, end: i + 1, text })) });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual([{ startMs: 0, endMs: 3000, text: '나는 너를 믿어', speakerLabel: undefined }]);
  });

  it('keeps consecutive English words separate inside aligned Chinese output', async () => {
    mockCli({ language: 'Chinese', segments: ['我', '说', 'OpenAI', 'makes', 'models', '很', '好'].map((text, i) => ({ start: i, end: i + 1, text })) });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual([{ startMs: 0, endMs: 7000, text: '我说OpenAI makes models很好', speakerLabel: undefined }]);
  });

  it('preserves existing sentence-level English and Chinese output', async () => {
    const segments = Array.from({ length: 24 }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: i % 2 ? '这是已有的完整中文句子。' : 'This is an existing complete sentence.' }));
    mockCli({ language: 'English', segments });
    const result = await new QwenAsrProvider().transcribe({ mediaPath });
    expect(result.segments).toEqual(segments.map(segment => ({ startMs: segment.start * 1000, endMs: segment.end * 1000, text: segment.text, speakerLabel: undefined })));
  });
});
