/** Validate the bounded M4A container produced by the native recorder before upload. */
export function m4aDuration(buffer: Buffer): number {
  function boxes(
    start: number,
    end: number,
  ): { type: string; start: number; end: number }[] {
    const result = [];
    for (let offset = start; offset + 8 <= end;) {
      const size = buffer.readUInt32BE(offset);
      if (size < 8 || offset + size > end)
        throw new Error("Invalid audio container");
      result.push({
        type: buffer.toString("ascii", offset + 4, offset + 8),
        start: offset + 8,
        end: offset + size,
      });
      offset += size;
    }
    return result;
  }
  if (buffer.length > 2 * 1024 * 1024) throw new Error("Audio is too large");
  const top = boxes(0, buffer.length);
  if (
    !top.some((b) => b.type === "ftyp") ||
    !top.some((b) => b.type === "mdat")
  )
    throw new Error("Record an M4A voice response");
  const movie = top.find((b) => b.type === "moov");
  if (!movie) throw new Error("Audio recording is incomplete");
  const header = boxes(movie.start, movie.end).find((b) => b.type === "mvhd");
  if (!header) throw new Error("Audio duration is missing");
  const version = buffer[header.start];
  const timescaleOffset = header.start + (version === 1 ? 20 : 12);
  if (
    (version !== 0 && version !== 1) ||
    timescaleOffset + (version === 1 ? 12 : 8) > header.end
  )
    throw new Error("Invalid audio header");
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration =
    version === 1
      ? Number(buffer.readBigUInt64BE(timescaleOffset + 4))
      : buffer.readUInt32BE(timescaleOffset + 4);
  const seconds = duration / timescale;
  if (!Number.isFinite(seconds) || seconds < 0.3 || seconds > 61)
    throw new Error("Record between 1 and 60 seconds of speech");
  return seconds;
}
