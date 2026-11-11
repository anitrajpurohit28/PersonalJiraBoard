import { mkdir, writeFile } from 'node:fs/promises';
import { SOUND_PATTERNS, renderTaskSound } from '../lib/task-sounds.mjs';
const directory = new URL('../public/sounds/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const name of Object.keys(SOUND_PATTERNS)) {
  const rate = 44100, samples = renderTaskSound(name, rate);
  const frames = samples.length, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const sample = samples[i];
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
  }
  await writeFile(new URL(`${name}.wav`, directory), wav);
}
