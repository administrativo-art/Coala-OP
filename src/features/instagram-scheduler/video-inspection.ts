export type InstagramVideoInspection = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  videoBitrateBps: number | null;
  audioSampleRateHz: number | null;
  fastStart: boolean;
  hasEditList: boolean;
};

type IsoBox = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
};

function readUInt64(buffer: Buffer, offset: number) {
  if (offset < 0 || offset + 8 > buffer.length) return null;
  const value = buffer.readBigUInt64BE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function boxes(buffer: Buffer, start: number, end: number) {
  const result: IsoBox[] = [];
  let cursor = start;
  while (cursor + 8 <= end && cursor + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(cursor);
    const type = buffer.subarray(cursor + 4, cursor + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      const extended = readUInt64(buffer, cursor + 8);
      if (!extended) break;
      size = extended;
      headerSize = 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end || cursor + size > buffer.length) break;
    result.push({ type, start: cursor, dataStart: cursor + headerSize, end: cursor + size });
    cursor += size;
  }
  return result;
}

function child(buffer: Buffer, parent: IsoBox, type: string) {
  return boxes(buffer, parent.dataStart, parent.end).find((item) => item.type === type) ?? null;
}

function descendantsContain(buffer: Buffer, parent: IsoBox, target: Set<string>): boolean {
  const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);
  for (const item of boxes(buffer, parent.dataStart, parent.end)) {
    if (target.has(item.type)) return true;
    if (containerTypes.has(item.type) && descendantsContain(buffer, item, target)) return true;
  }
  return false;
}

function handlerType(buffer: Buffer, mdia: IsoBox) {
  const hdlr = child(buffer, mdia, "hdlr");
  const offset = hdlr ? hdlr.dataStart + 8 : -1;
  return offset >= 0 && offset + 4 <= hdlr!.end ? buffer.subarray(offset, offset + 4).toString("ascii") : null;
}

function mediaDuration(buffer: Buffer, mdia: IsoBox) {
  const mdhd = child(buffer, mdia, "mdhd");
  if (!mdhd || mdhd.dataStart + 20 > mdhd.end) return null;
  const version = buffer[mdhd.dataStart];
  const timescaleOffset = mdhd.dataStart + (version === 1 ? 20 : 12);
  const durationOffset = mdhd.dataStart + (version === 1 ? 24 : 16);
  if (timescaleOffset + 4 > mdhd.end) return null;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1
    ? readUInt64(buffer, durationOffset)
    : durationOffset + 4 <= mdhd.end ? buffer.readUInt32BE(durationOffset) : null;
  return timescale > 0 && duration !== null ? duration / timescale : null;
}

function sampleEntry(buffer: Buffer, mdia: IsoBox) {
  const minf = child(buffer, mdia, "minf");
  const stbl = minf ? child(buffer, minf, "stbl") : null;
  const stsd = stbl ? child(buffer, stbl, "stsd") : null;
  if (!stsd || stsd.dataStart + 16 > stsd.end) return { entry: null, stbl };
  const entries = boxes(buffer, stsd.dataStart + 8, stsd.end);
  return { entry: entries[0] ?? null, stbl };
}

function videoTrack(buffer: Buffer, trak: IsoBox) {
  const mdia = child(buffer, trak, "mdia");
  if (!mdia || handlerType(buffer, mdia) !== "vide") return null;
  const durationSeconds = mediaDuration(buffer, mdia);
  const { entry, stbl } = sampleEntry(buffer, mdia);
  if (!entry) return { durationSeconds, width: null, height: null, codec: null, frameRate: null };
  let width = entry.start + 36 <= entry.end ? buffer.readUInt16BE(entry.start + 32) : null;
  let height = entry.start + 36 <= entry.end ? buffer.readUInt16BE(entry.start + 34) : null;

  const tkhd = child(buffer, trak, "tkhd");
  if (tkhd) {
    const version = buffer[tkhd.dataStart];
    const matrixOffset = tkhd.dataStart + (version === 1 ? 60 : 40);
    if (matrixOffset + 20 <= tkhd.end) {
      const a = buffer.readInt32BE(matrixOffset);
      const b = buffer.readInt32BE(matrixOffset + 4);
      const c = buffer.readInt32BE(matrixOffset + 12);
      const d = buffer.readInt32BE(matrixOffset + 16);
      if (Math.abs(a) < 2 && Math.abs(d) < 2 && Math.abs(b) >= 65_535 && Math.abs(c) >= 65_535) {
        [width, height] = [height, width];
      }
    }
  }

  let frameRate: number | null = null;
  const stts = stbl ? child(buffer, stbl, "stts") : null;
  if (stts && durationSeconds && stts.dataStart + 8 <= stts.end) {
    const entryCount = buffer.readUInt32BE(stts.dataStart + 4);
    let sampleCount = 0;
    let offset = stts.dataStart + 8;
    for (let index = 0; index < entryCount && offset + 8 <= stts.end; index += 1, offset += 8) {
      sampleCount += buffer.readUInt32BE(offset);
    }
    if (sampleCount > 0) frameRate = sampleCount / durationSeconds;
  }
  return { durationSeconds, width, height, codec: entry.type, frameRate };
}

function audioTrack(buffer: Buffer, trak: IsoBox) {
  const mdia = child(buffer, trak, "mdia");
  if (!mdia || handlerType(buffer, mdia) !== "soun") return null;
  const { entry } = sampleEntry(buffer, mdia);
  if (!entry) return { codec: null, sampleRateHz: null };
  const sampleRateHz = entry.start + 36 <= entry.end ? buffer.readUInt32BE(entry.start + 32) / 65_536 : null;
  return { codec: entry.type, sampleRateHz };
}

export function inspectInstagramIsoVideo(buffer: Buffer): InstagramVideoInspection {
  const topLevel = boxes(buffer, 0, buffer.length);
  const moov = topLevel.find((item) => item.type === "moov") ?? null;
  const mdat = topLevel.find((item) => item.type === "mdat") ?? null;
  const empty: InstagramVideoInspection = {
    width: null,
    height: null,
    durationSeconds: null,
    videoCodec: null,
    audioCodec: null,
    frameRate: null,
    videoBitrateBps: null,
    audioSampleRateHz: null,
    fastStart: Boolean(moov && mdat && moov.start < mdat.start),
    hasEditList: Boolean(moov && descendantsContain(buffer, moov, new Set(["edts", "elst"]))),
  };
  if (!moov) return empty;
  const tracks = boxes(buffer, moov.dataStart, moov.end).filter((item) => item.type === "trak");
  const video = tracks.map((track) => videoTrack(buffer, track)).find(Boolean) ?? null;
  const audio = tracks.map((track) => audioTrack(buffer, track)).find(Boolean) ?? null;
  const durationSeconds = video?.durationSeconds ?? null;
  return {
    ...empty,
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    frameRate: video?.frameRate ?? null,
    videoBitrateBps: durationSeconds && durationSeconds > 0 ? (buffer.byteLength * 8) / durationSeconds : null,
    audioSampleRateHz: audio?.sampleRateHz ?? null,
  };
}
