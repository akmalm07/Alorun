function box(name: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(name, 4);
  return Buffer.concat([header, data]);
}
export function fakeM4a(seconds: number) {
  const movieHeader = Buffer.alloc(32);
  movieHeader.writeUInt32BE(1000, 12);
  movieHeader.writeUInt32BE(seconds * 1000, 16);
  return Buffer.concat([
    box("ftyp", Buffer.from("M4A ")),
    box("mdat", Buffer.from("synthetic")),
    box("moov", box("mvhd", movieHeader)),
  ]);
}
