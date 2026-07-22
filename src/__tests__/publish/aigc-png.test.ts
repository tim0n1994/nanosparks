import { describe, it, expect } from 'vitest';
import { embedAigcLabelInPng, makeAigcLabel } from '@/lib/publish/aigc-png';
import { buildAigcXmp } from '@/lib/publish/channels';

// Minimal valid PNG: signature + IHDR + IEND.
function minimalPng(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR chunk: length(4) + "IHDR"(4) + 13 bytes data + crc(4)
  const ihdrData = Buffer.alloc(13);
  const ihdrType = Buffer.from('IHDR', 'latin1');
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrCrc = Buffer.alloc(4);
  // crc of type+data — precomputed for zero data
  let c = ~0;
  const combined = Buffer.concat([ihdrType, ihdrData]);
  for (let i = 0; i < combined.length; i++) {
    c ^= combined[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  ihdrCrc.writeUInt32BE(~c >>> 0, 0);
  const ihdr = Buffer.concat([ihdrLen, ihdrType, ihdrData, ihdrCrc]);
  // IEND chunk: length(4)=0 + "IEND"(4) + crc(4)
  const iendLen = Buffer.alloc(4);
  const iendType = Buffer.from('IEND', 'latin1');
  const iendCrc = Buffer.alloc(4);
  iendCrc.writeUInt32BE(0xAE426082, 0); // known CRC of "IEND"
  const iend = Buffer.concat([iendLen, iendType, iendCrc]);
  return Buffer.concat([sig, ihdr, iend]);
}

describe('embedAigcLabelInPng', () => {
  it('embeds the XMP packet as an iTXt chunk carrying the adobe xmp keyword', () => {
    const png = minimalPng();
    const label = makeAigcLabel('pkg_abc', 'NSP');
    const out = embedAigcLabelInPng(png, label);

    // The output must contain the XMP keyword and the providerCode/contentId.
    expect(out.includes('XML:com.adobe.xmp')).toBe(true);
    expect(out.includes('NSP')).toBe(true);
    expect(out.includes('pkg_abc')).toBe(true);
    expect(out.includes('isAigc')).toBe(true);
  });

  it('preserves the PNG signature and IEND marker', () => {
    const png = minimalPng();
    const out = embedAigcLabelInPng(png, makeAigcLabel('x'));
    expect(out.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(out.includes(Buffer.from('IEND', 'latin1'))).toBe(true);
  });

  it('grows the buffer by the inserted chunk size', () => {
    const png = minimalPng();
    const out = embedAigcLabelInPng(png, makeAigcLabel('x'));
    expect(out.length).toBeGreaterThan(png.length);
  });

  it('returns non-PNG input unchanged', () => {
    const notPng = Buffer.from('not a png at all');
    const out = embedAigcLabelInPng(notPng, makeAigcLabel('x'));
    expect(out.equals(notPng)).toBe(true);
  });

  it('does not mutate the input buffer', () => {
    const png = minimalPng();
    const snapshot = Buffer.from(png);
    embedAigcLabelInPng(png, makeAigcLabel('x'));
    expect(png.equals(snapshot)).toBe(true);
  });
});

describe('makeAigcLabel', () => {
  it('builds a label with provider code + content id + ISO timestamp', () => {
    const label = makeAigcLabel('pkg_1', 'NSP001');
    expect(label.providerCode).toBe('NSP001');
    expect(label.contentId).toBe('pkg_1');
    expect(label.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults the provider code to NSP', () => {
    expect(makeAigcLabel('x').providerCode).toBe('NSP');
  });
});

describe('roundtrip with buildAigcXmp', () => {
  it('the embedded bytes include exactly the XMP from buildAigcXmp', () => {
    const label = makeAigcLabel('pkg_xyz');
    const xmp = buildAigcXmp(label);
    const out = embedAigcLabelInPng(minimalPng(), label);
    expect(out.includes(Buffer.from(xmp, 'utf8'))).toBe(true);
  });
});
