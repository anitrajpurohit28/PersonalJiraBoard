import { readFile, writeFile } from "node:fs/promises";

// An .icns file is a compact container of PNG images. iconutil can build this
// on most Macs, but it can reject otherwise-valid iconsets in restricted Xcode
// environments. Writing the simple documented container format here keeps the
// desktop build repeatable without any external image-packaging dependency.
const [iconsetDirectory, outputPath] = process.argv.slice(2);
if (!iconsetDirectory || !outputPath) {
  throw new Error("Usage: node create-icns.mjs <iconset-directory> <output.icns>");
}

// Modern macOS reads PNG payloads directly from these ICNS chunk types.
const iconChunks = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];

const chunks = await Promise.all(
  iconChunks.map(async ([type, filename]) => {
    const png = await readFile(`${iconsetDirectory}/${filename}`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(header.length + png.length, 4);
    return Buffer.concat([header, png]);
  })
);

const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(header.length + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);

await writeFile(outputPath, Buffer.concat([header, ...chunks]));
