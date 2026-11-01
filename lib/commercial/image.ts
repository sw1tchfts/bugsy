// Floor plans are raster images (spec 14 rule 12): the type and size are read from the bytes, never trusted from the
// upload, so an SVG or HTML file named .png is refused.

export type ImageInfo = { type: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number };

export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    const width = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
    const height = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
    return width > 0 && height > 0 ? { type: "image/png", width, height } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = (b[i + 5] << 8) | b[i + 6];
        const width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  const ascii = (from: number, n: number) => String.fromCharCode(...b.subarray(from, from + n));
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { type: "image/webp", width: ((b[27] << 8) | b[26]) & 0x3fff, height: ((b[29] << 8) | b[28]) & 0x3fff };
    if (chunk === "VP8L") {
      const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
      return { type: "image/webp", width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { type: "image/webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}

/** A plain PNG of the given size from an RGB pixel function (seeds and tests draw floor plans with it). */
export async function drawPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Promise<Uint8Array> {
  const { deflateSync, crc32 } = await import("node:zlib");
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, bl] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = bl;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** A simple floor plan: white rooms, gray walls, for seeds and tests. */
export function floorPlan(width: number, height: number): Promise<Uint8Array> {
  const wall = (x: number, y: number) => x < 6 || y < 6 || x >= width - 6 || y >= height - 6 || (Math.abs(x - width * 0.55) < 3 && (y < height * 0.4 || y > height * 0.55)) || (Math.abs(y - height * 0.5) < 3 && x < width * 0.55 && (x < width * 0.2 || x > width * 0.3));
  return drawPng(width, height, (x, y) => (wall(x, y) ? [120, 120, 118] : [250, 250, 248]));
}
