import { describe, it, expect, vi } from 'vitest';
import {
  buildDigestEmailHtml,
  buildDigestSubject,
  deliverDigest,
  groupDigestsByRecipient,
  type DigestItem,
  type EmailBackend,
} from '@/lib/digest/delivery';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const items: DigestItem[] = [
  { episodeTitle: '好奇心', showTitle: '思想火花', readUrl: 'https://x/p/a' },
  { episodeTitle: '创造力', showTitle: '思想火花', readUrl: 'https://x/p/b' },
];

describe('buildDigestSubject', () => {
  it('includes the item count', () => {
    expect(buildDigestSubject(3)).toContain('3 集');
  });
});

describe('buildDigestEmailHtml', () => {
  it('lists each episode as a link with show title', () => {
    const html = buildDigestEmailHtml('user_A', items);
    expect(html).toContain('user_A');
    expect(html).toContain('本周你关注的节目更新了 2 集');
    expect(html).toContain('https://x/p/a');
    expect(html).toContain('好奇心');
    expect(html).toContain('思想火花');
  });

  it('escapes HTML in titles to prevent injection', () => {
    const html = buildDigestEmailHtml('u', [{ episodeTitle: '<script>x</script>', readUrl: 'https://x' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('deliverDigest', () => {
  it('sends nothing when there are no items', async () => {
    const email: EmailBackend = { send: vi.fn() };
    const r = await deliverDigest({ userId: 'u', email: 'a@b.com' }, [], email);
    expect(r.emailSent).toBe(false);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sends email when the recipient has an email + backend', async () => {
    const email: EmailBackend = { send: vi.fn().mockResolvedValue(undefined) };
    const r = await deliverDigest({ userId: 'u', email: 'a@b.com' }, items, email);
    expect(r.emailSent).toBe(true);
    expect(email.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
  });

  it('skips email when the recipient has no email', async () => {
    const email: EmailBackend = { send: vi.fn() };
    const r = await deliverDigest({ userId: 'u' }, items, email);
    expect(r.emailSent).toBe(false);
  });

  it('sends wechat template when openId + sender provided', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const r = await deliverDigest({ userId: 'u', wechatOpenId: 'openid_1' }, items, null, sender);
    expect(r.wechatSent).toBe(true);
    expect(sender).toHaveBeenCalledWith('openid_1', items);
  });

  it('continues if email fails but wechat succeeds', async () => {
    const email: EmailBackend = { send: vi.fn().mockRejectedValue(new Error('smtp down')) };
    const sender = vi.fn().mockResolvedValue(undefined);
    const r = await deliverDigest({ userId: 'u', email: 'a@b.com', wechatOpenId: 'o' }, items, email, sender);
    expect(r.emailSent).toBe(false);
    expect(r.wechatSent).toBe(true);
  });
});

describe('groupDigestsByRecipient', () => {
  it('groups new episodes by user from their follows', () => {
    const follows = [
      { userId: 'u1', targetType: 'source', targetId: 'src_1' },
      { userId: 'u2', targetType: 'source', targetId: 'src_1' },
    ];
    const byTarget = new Map([['src_1', items]]);
    const grouped = groupDigestsByRecipient(follows, byTarget);
    expect(grouped.get('u1')).toHaveLength(2);
    expect(grouped.get('u2')).toHaveLength(2);
  });

  it('dedupes when a user follows both a show and its topic pointing to the same episode', () => {
    const follows = [
      { userId: 'u1', targetType: 'source', targetId: 'src_1' },
      { userId: 'u1', targetType: 'topic', targetId: 'topic_1' },
    ];
    const byTarget = new Map([
      ['src_1', items],
      ['topic_1', items], // same episodes
    ]);
    const grouped = groupDigestsByRecipient(follows, byTarget);
    expect(grouped.get('u1')).toHaveLength(2); // not 4 — deduped by readUrl
  });

  it('skips follows with no new episodes', () => {
    const follows = [{ userId: 'u1', targetType: 'source', targetId: 'src_empty' }];
    const byTarget = new Map([['src_1', items]]);
    const grouped = groupDigestsByRecipient(follows, byTarget);
    expect(grouped.has('u1')).toBe(false);
  });
});
