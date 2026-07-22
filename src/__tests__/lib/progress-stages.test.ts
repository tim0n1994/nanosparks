import { describe, it, expect } from 'vitest';
import { statusToStage, isReadable } from '@/lib/progress-stages';

describe('statusToStage', () => {
  it('maps pending → queued', () => {
    const s = statusToStage('pending');
    expect(s.stage).toBe('queued');
    expect(s.label).toBe('排队中');
  });

  it('maps processing → downloading', () => {
    expect(statusToStage('processing').stage).toBe('downloading');
  });

  it('maps transcribing → transcribing with staged label', () => {
    const s = statusToStage('transcribing');
    expect(s.stage).toBe('transcribing');
    expect(s.label).toBe('转写中');
  });

  it('refines processing sub-steps (diarize → 整理说话人)', () => {
    const s = statusToStage('transcribing', 'diarize');
    expect(s.stage).toBe('diarizing');
    expect(s.label).toBe('整理说话人');
  });

  it('refines extract sub-step → 生成导读', () => {
    const s = statusToStage('processing', 'extract');
    expect(s.stage).toBe('extracting');
    expect(s.label).toBe('生成导读');
  });

  it('opens reading at transcribed (PRD: 转写完成即先读)', () => {
    const s = statusToStage('transcribed');
    expect(s.stage).toBe('ready');
    expect(s.progress).toBeGreaterThanOrEqual(0.9);
  });

  it('maps completed → ready at 100%', () => {
    expect(statusToStage('completed').progress).toBe(1);
  });

  it('maps failed with a human hint', () => {
    const s = statusToStage('failed');
    expect(s.stage).toBe('failed');
    expect(s.hint.length).toBeGreaterThan(0);
  });

  it('progress is monotonic across the happy path', () => {
    const order = ['pending', 'processing', 'transcribing', 'transcribed', 'completed'];
    const progresses = order.map((st) => statusToStage(st).progress);
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
  });
});

describe('isReadable', () => {
  it('returns true for transcribed and completed', () => {
    expect(isReadable('transcribed')).toBe(true);
    expect(isReadable('completed')).toBe(true);
  });

  it('returns false while still processing', () => {
    expect(isReadable('pending')).toBe(false);
    expect(isReadable('transcribing')).toBe(false);
    expect(isReadable('processing')).toBe(false);
  });
});
