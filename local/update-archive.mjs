import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
// Inspect the central directory before invoking the OS extractor. ZIP64 and encrypted archives are deliberately unsupported.
export async function validateArchive(file, root) {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const tail = Buffer.alloc(Math.min(size, 65557)); await handle.read(tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw new Error('Invalid update archive.');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (!count || count === 65535 || count !== tail.readUInt16LE(end + 8) || length > 32000000 || offset + length !== size - tail.length + end) throw new Error('Unsupported update archive.');
    const central = Buffer.alloc(length); await handle.read(central, 0, length, offset);
    const names = new Set(), links = []; let cursor = 0, expanded = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > length || central.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid archive entry.');
      const flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10);
      const compressed = central.readUInt32LE(cursor + 20), unpacked = central.readUInt32LE(cursor + 24);
      const nameSize = central.readUInt16LE(cursor + 28), extra = central.readUInt16LE(cursor + 30), comment = central.readUInt16LE(cursor + 32);
      const attributes = central.readUInt32LE(cursor + 38), localOffset = central.readUInt32LE(cursor + 42);
      const name = central.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8');
      cursor += 46 + nameSize + extra + comment; expanded += unpacked;
      if (cursor > length || flags & 1 || ![0,8].includes(method) || expanded > 6000000000 || !name || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || (!name.startsWith(root + '/') && name !== root + '/')) throw new Error('Unsafe update archive path.');
      const local = Buffer.alloc(30); await handle.read(local, 0, 30, localOffset);
      if (localOffset + 30 > offset || local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method) throw new Error('Invalid local archive header.');
      const localName = Buffer.alloc(local.readUInt16LE(26)); await handle.read(localName, 0, localName.length, localOffset + 30);
      if (localName.toString('utf8') !== name || localOffset + 30 + localName.length + local.readUInt16LE(28) + compressed > offset) throw new Error('Archive headers disagree.');
      const folded = name.toLowerCase(); if (names.has(folded)) throw new Error('Duplicate archive path.'); names.add(folded);
      if ((attributes >>> 16 & 0xf000) === 0xa000) {
        if (unpacked > 4096 || compressed > 8192 || localOffset + 30 > offset) throw new Error('Unsafe archive link.');
        const header = Buffer.alloc(30); await handle.read(header, 0, 30, localOffset);
        if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid archive link.');
        const dataOffset = localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        const data = Buffer.alloc(compressed); await handle.read(data, 0, compressed, dataOffset);
        const target = (method === 8 ? inflateRawSync(data, { maxOutputLength: 4096 }) : data).toString('utf8');
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
        if (!target || /[\\:\x00-\x1f]/.test(target) || target.startsWith('/') || !resolved.startsWith(root + '/')) throw new Error('Archive link escapes the application.');
        links.push(folded);
      }
    }
    if (cursor !== length || links.some(link => [...names].some(name => name.startsWith(link + '/')))) throw new Error('Invalid archive layout.');
  } finally { await handle.close(); }
}
