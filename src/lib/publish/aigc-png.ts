/**
 * AIGC implicit-label PNG embedding (PRD §8/§B1 标识办法第五条).
 *
 * Writes the XMP packet (from channels.ts buildAigcXmp) into a PNG's iTXt chunk
 * as the "XML:com.adobe.xmp" keyword, which is how image tools read embedded XMP.
 * Pure buffer manipulation — no native deps — so the exported PNG carries the
 * implicit AIGC label even without satori/resvg.
 */

import type { AigcLabel } from './types';
import { buildAigcXmp } from './channels';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND = Buffer.from([73, 69, 78, 68]); // "IEND"

/** CRC32 (PNG uses the standard zlib CRC). */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

/** Build a PNG iTXt chunk carrying the XMP packet under the adobe xmp keyword. */
function buildXmpItxtChunk(xmp: string): Buffer {
  const keyword = Buffer.from('XML:com.adobe.xmp', 'latin1');
  const nullSep = Buffer.alloc(1, 0);
  // compression flag (0) + compression method (0) + language tag (empty) + translated keyword (empty)
  const header = Buffer.concat([keyword, nullSep, Buffer.alloc(1, 0), Buffer.alloc(1, 0), nullSep, nullSep]);
  const text = Buffer.from(xmp, 'utf8');
  const data = Buffer.concat([header, text]);
  const type = Buffer.from('iTXt', 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([length, type, data, crc]);
}

/**
 * Embed the AIGC XMP label into a PNG buffer (after the signature, before IEND).
 * Returns a new buffer; the input is not mutated.
 */
export function embedAigcLabelInPng(png: Buffer, label: AigcLabel): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // Not a PNG — return unchanged rather than corrupt a non-PNG payload.
    return png;
  }
  const xmp = buildAigcXmp(label);
  const chunk = buildXmpItxtChunk(xmp);
  // Insert the iTXt chunk right after the 8-byte signature (before IHDR is also valid,
  // but inserting after the signature is safe and readable by tooling).
  const iendIndex = png.indexOf(IEND, 8);
  const insertAt = iendIndex > 0 ? iendIndex - 4 : png.length - 12; // before the IEND length+type
  return Buffer.concat([png.subarray(0, insertAt), chunk, png.subarray(insertAt)]);
}

/** Construct an AigcLabel for a generated card/package. */
export function makeAigcLabel(contentId: string, providerCode = 'NSP'): AigcLabel {
  return {
    providerCode,
    contentId,
    generatedAt: new Date().toISOString(),
  };
}
