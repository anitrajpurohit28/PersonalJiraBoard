// Inharmonic metal modes produce a struck triangle, rather than a musical chord.
export const SOUND_PATTERNS = {
  complete: [[0, 1620, 2.8]],
  reminder: Array.from({ length: 36 }, (_, i) => [i * .4, 1620, Math.min(1.4, 15 - i * .4)]),
};
export const SOUND_DURATIONS = { complete: 2.8, reminder: 15 };
const MODES = [[1, .5, 1.1], [1.47, .25, .95], [2.09, .17, .7], [2.56, .1, .55], [3.94, .055, .4]];
/** Render the same triangle timbre for browser buffers and native WAV assets. */
export function renderTaskSound(name, rate = 44100) {
  if (!Object.hasOwn(SOUND_PATTERNS, name)) throw new Error('Unknown task sound');
  const duration = SOUND_DURATIONS[name], samples = new Float32Array(Math.round(rate * duration));
  for (const [at, frequency, length] of SOUND_PATTERNS[name]) {
    const start = Math.round(at * rate), frames = Math.min(Math.ceil(length * rate), samples.length - start);
    for (let i = 0; i < frames; i++) {
      const t = i / rate, time = at + t;
      const attack = Math.min(1, t / .002), release = Math.min(1, (length - t) / .04);
      const tail = name === 'reminder' ? Math.min(1, duration - time) : Math.min(1, (duration - time) / .15);
      let sample = 0;
      for (const [ratio, amplitude, decay] of MODES) sample += Math.sin(2 * Math.PI * frequency * ratio * t) * amplitude * Math.exp(-t / decay);
      samples[start + i] += sample * attack * release * tail * .24;
    }
  }
  return samples;
}
/** @param {{nativePlay?: (name: string) => boolean, createContext?: () => AudioContext}} [options] */
export function createTaskSoundPlayer({ nativePlay = () => false, createContext = () => new window.AudioContext() } = {}) {
  let context, pendingReminder = false, disposed = false;
  const buffers = new Map(), playing = new Map();
  function synth(name) {
    if (disposed || !context || context.state !== 'running') return false;
    if (!buffers.has(name)) {
      const samples = renderTaskSound(name);
      const buffer = context.createBuffer(1, samples.length, 44100);
      buffer.getChannelData(0).set(samples); buffers.set(name, buffer);
    }
    const previous = playing.get(name);
    if (previous) { previous.stop(); previous.disconnect(); }
    const source = context.createBufferSource();
    source.buffer = buffers.get(name); source.connect(context.destination); playing.set(name, source);
    source.onended = () => { source.disconnect(); if (playing.get(name) === source) playing.delete(name); };
    source.start(); return true;
  }
  function unlock() {
    if (disposed) return;
    try {
      context ||= createContext();
      void context.resume().then(() => { if (pendingReminder && synth('reminder')) pendingReminder = false; }).catch(() => {});
    } catch { /* Audio support must never prevent saving tasks. */ }
  }
  return {
    unlock,
    play(name) {
      if (disposed || !Object.hasOwn(SOUND_PATTERNS, name)) return;
      try { if (nativePlay(name)) return; } catch { /* Fall back to browser audio. */ }
      try { if (!synth(name) && name === 'reminder') pendingReminder = true; unlock(); } catch { /* Audio must never interrupt task actions. */ }
    },
    dispose() { disposed = true; pendingReminder = false; for (const source of playing.values()) { source.stop(); source.disconnect(); } playing.clear(); buffers.clear(); void context?.close().catch(() => {}); },
  };
}
export function completedSince(previous, tasks) {
  return previous ? tasks.some(task => task.archived && previous.get(task.id) === false) : false;
}
