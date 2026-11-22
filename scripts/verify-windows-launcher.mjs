import { readFile } from "node:fs/promises";

const [executable, light, dark] = await Promise.all([
  readFile(process.argv[2]),
  readFile(new URL("../desktop/windows/icons/AppIconLight.ico", import.meta.url)),
  readFile(new URL("../desktop/windows/icons/AppIconDark.ico", import.meta.url)),
]);
if (!executable.includes(light) || !executable.includes(dark)) {
  throw new Error("The Windows launcher does not contain both current theme icons.");
}

// Check the PE icon group used by Explorer as well as the managed resources.
const u16 = (offset) => executable.readUInt16LE(offset);
const u32 = (offset) => executable.readUInt32LE(offset);
const pe = u32(60);
const optional = pe + 24;
if (u32(pe) !== 0x4550 || u16(optional) !== 0x20b) throw new Error("Invalid 64-bit Windows executable.");
const sections = optional + u16(pe + 20);
function fileOffset(rva) {
  for (let index = 0; index < u16(pe + 6); index++) {
    const section = sections + index * 40;
    const start = u32(section + 12);
    if (rva >= start && rva < start + u32(section + 16)) return u32(section + 20) + rva - start;
  }
  throw new Error("The Windows executable has an invalid resource section.");
}
const resources = fileOffset(u32(optional + 112 + 16));
function entries(relative) {
  const directory = resources + relative;
  const result = new Map();
  for (let index = 0; index < u16(directory + 12) + u16(directory + 14); index++) {
    const entry = directory + 16 + index * 8;
    result.set(u32(entry), u32(entry + 4) & 0x7fffffff);
  }
  return result;
}
function firstEntry(relative) {
  const entry = entries(relative).values().next().value;
  if (entry === undefined) throw new Error("The Windows executable is missing icon resources.");
  return entry;
}
function payload(relative) {
  const entry = resources + firstEntry(relative);
  const offset = fileOffset(u32(entry));
  return executable.subarray(offset, offset + u32(entry + 4));
}
const types = entries(0);
if (!types.has(14) || !types.has(3)) throw new Error("The Windows executable is missing its Explorer icon.");
const group = payload(firstEntry(types.get(14)));
const images = entries(types.get(3));
const count = light.readUInt16LE(4);
if (group.readUInt16LE(4) !== count) throw new Error("The Windows Explorer icon has the wrong sizes.");
for (let index = 0; index < count; index++) {
  const entry = 6 + index * 16;
  const offset = light.readUInt32LE(entry + 12);
  const size = light.readUInt32LE(entry + 8);
  const id = group.readUInt16LE(6 + index * 14 + 12);
  if (!images.has(id) || !payload(images.get(id)).equals(light.subarray(offset, offset + size))) {
    throw new Error("The Windows Explorer icon does not match the current artwork.");
  }
}
console.log("Verified the Windows Explorer icon and both window themes.");
