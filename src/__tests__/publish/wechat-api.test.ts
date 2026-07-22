import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WeChatApiClient } from '@/lib/publish/wechat-api';
import { clearWeChatTokenCache } from '@/lib/publish/wechat-api';

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const creds = { appId: 'wx123', appSecret: 'secret' };

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  clearWeChatTokenCache();
  // Token fetch succeeds
  fetchMock.mockResolvedValue(jsonResponse({ access_token: 'tok_abc', expires_in: 7200 }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WeChatApiClient', () => {
  it('fetches and caches the access token', async () => {
    const client = new WeChatApiClient(creds);
    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();
    expect(t1).toBe('tok_abc');
    expect(t1).toBe(t2);
    // Token fetched only once (cached)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when token fetch fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));
    const client = new WeChatApiClient(creds);
    await expect(client.getAccessToken()).rejects.toThrow('invalid appid');
  });

  it('uploads an image material and returns the media_id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'media_img_1', url: 'https://img' }));

    const client = new WeChatApiClient(creds);
    const mediaId = await client.uploadImageMaterial(Buffer.from('png'), 'cover.png');
    expect(mediaId).toBe('media_img_1');
    // Second call hit the add_material endpoint
    expect(fetchMock.mock.calls[1][0]).toContain('material/add_material');
  });

  it('creates a draft with title, content, thumb, and a ≤120-char digest', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'draft_1' }));

    const client = new WeChatApiClient(creds);
    const draftId = await client.createDraft({
      title: '测试文章',
      content: '<p>正文</p>',
      thumbMediaId: 'media_img_1',
      digest: 'a'.repeat(200), // over 120 — should be truncated
      contentSourceUrl: 'https://example.com',
    });
    expect(draftId).toBe('draft_1');

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.articles[0].title).toBe('测试文章');
    expect(body.articles[0].thumb_media_id).toBe('media_img_1');
    expect(body.articles[0].digest.length).toBe(120); // truncated per PRD
    expect(body.articles[0].content_source_url).toBe('https://example.com');
  });

  it('submits a draft for publish via freepublish/submit', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ publish_id: 'pub_1' }));

    const client = new WeChatApiClient(creds);
    const publishId = await client.publishDraft('draft_1');
    expect(publishId).toBe('pub_1');
    expect(fetchMock.mock.calls[1][0]).toContain('freepublish/submit');
  });

  it('surfaces freepublish errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'no permission' }));

    const client = new WeChatApiClient(creds);
    await expect(client.publishDraft('draft_1')).rejects.toThrow('no permission');
  });
});

describe('createWeChatClientFromEnv', () => {
  it('returns null when credentials are absent', async () => {
    const { createWeChatClientFromEnv } = await import('@/lib/publish/wechat-api');
    const origAppId = process.env.WECHAT_APP_ID;
    const origSecret = process.env.WECHAT_APP_SECRET;
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    try {
      expect(createWeChatClientFromEnv()).toBeNull();
    } finally {
      if (origAppId) process.env.WECHAT_APP_ID = origAppId;
      if (origSecret) process.env.WECHAT_APP_SECRET = origSecret;
    }
  });
});
