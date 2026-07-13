import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl } from '@/lib/youtube/parser';

describe('parseYouTubeUrl', () => {
  it('parses video URL', () => {
    const result = parseYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('video');
    expect(result.id).toBe('dQw4w9WgXcQ');
  });

  it('parses short URL', () => {
    const result = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(result.type).toBe('video');
    expect(result.id).toBe('dQw4w9WgXcQ');
  });

  it('parses channel URL', () => {
    const result = parseYouTubeUrl('https://youtube.com/@lexfridman');
    expect(result.type).toBe('channel');
    expect(result.id).toBe('lexfridman');
  });

  it('throws on invalid URL', () => {
    expect(() => parseYouTubeUrl('https://example.com')).toThrow();
  });
});
