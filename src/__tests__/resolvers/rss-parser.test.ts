import { describe, it, expect } from 'vitest';
import { parseRssXml } from '@/lib/resolvers/rss-parser';

// A minimal podcast RSS 2.0 + itunes:* feed used to exercise the parser.
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Show</title>
    <link>https://example.com</link>
    <description>A test podcast</description>
    <itunes:image href="https://img.example.com/cover.jpg"/>
    <item>
      <title>Episode 1 — Hello</title>
      <guid>guid-001</guid>
      <pubDate>Mon, 1 Jan 2024 00:00:00 GMT</pubDate>
      <itunes:duration>3600</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="1000"/>
      <description>First episode</description>
    </item>
    <item>
      <title>Episode 2 — World</title>
      <guid>guid-002</guid>
      <itunes:duration>42:30</itunes:duration>
      <enclosure url="https://cdn.example.com/ep2.mp3" length="2000"/>
      <content:encoded><![CDATA[<p>Second</p>]]></content:encoded>
    </item>
    <item>
      <title>No enclosure item</title>
      <guid>guid-003</guid>
      <description>should be filtered out</description>
    </item>
  </channel>
</rss>`;

describe('parseRssXml', () => {
  const feed = parseRssXml(SAMPLE_FEED);

  it('parses channel title, description, image', () => {
    expect(feed.title).toBe('Test Show');
    expect(feed.description).toBe('A test podcast');
    expect(feed.image).toBe('https://img.example.com/cover.jpg');
  });

  it('extracts episodes with enclosure urls', () => {
    expect(feed.episodes).toHaveLength(2);
    const urls = feed.episodes.map((e) => e.enclosureUrl);
    expect(urls).toContain('https://cdn.example.com/ep1.mp3');
    expect(urls).toContain('https://cdn.example.com/ep2.mp3');
  });

  it('filters out items without an enclosure', () => {
    expect(feed.episodes.find((e) => e.title === 'No enclosure item')).toBeUndefined();
  });

  it('parses plain-seconds and HH:MM:SS durations', () => {
    const ep1 = feed.episodes.find((e) => e.guid === 'guid-001')!;
    const ep2 = feed.episodes.find((e) => e.guid === 'guid-002')!;
    expect(ep1.durationSec).toBe(3600);
    expect(ep2.durationSec).toBe(42 * 60 + 30); // 2550
  });

  it('decodes HTML entities in enclosure urls', () => {
    const entityFeed = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>x</title>
    <item><title>t</title><guid>g</guid><enclosure url="https://cdn.example.com/a&amp;b.mp3"/></item>
    </channel></rss>`;
    expect(parseRssXml(entityFeed).episodes[0].enclosureUrl).toBe('https://cdn.example.com/a&b.mp3');
  });

  it('returns episodes in document order', () => {
    expect(feed.episodes[0].guid).toBe('guid-001');
    expect(feed.episodes[1].guid).toBe('guid-002');
  });
});
