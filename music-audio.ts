/**
 * music-audio.ts
 *
 * Offline playback for ABC scores. abcjs writes a MIDI file for the tune (repeats, ties and tempo
 * resolved); this reads its notes and plays them with Web Audio oscillators.
 *
 * abcjs's own synth would fetch soundfont files from a web server, which nothing in vfm may do, so
 * the sound is a plain synthesized tone: no samples, no network.
 */

export interface Note {
  /** Seconds from the start. */
  start: number;
  /** Seconds. */
  dur: number;
  /** MIDI note number. */
  pitch: number;
}

interface Event {
  tick: number;
  order: number;
  kind: "on" | "off" | "tempo";
  ch: number;
  a: number;
}

/** Notes of a Standard MIDI File (format 0 or 1), with tempo changes applied. Percussion is skipped. */
export function midiToNotes(bytes: Uint8Array): Note[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (ascii(0) !== "MThd") return [];
  const tracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) return []; // SMPTE timing: not produced by abcjs
  const events: Event[] = [];
  let at = 8 + view.getUint32(4);
  let order = 0;
  for (let t = 0; t < tracks && at + 8 <= bytes.length; t++) {
    const end = at + 8 + view.getUint32(at + 4);
    let p = at + 8;
    let tick = 0;
    let running = 0;
    const vlq = () => {
      let v = 0;
      for (;;) {
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    while (p < end) {
      tick += vlq();
      let status = bytes[p];
      if (status < 0x80) status = running;
      else p++;
      if (status === 0xff) {
        const type = bytes[p++];
        const len = vlq();
        if (type === 0x51 && len === 3) events.push({ tick, order: order++, kind: "tempo", ch: 0, a: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else {
        running = status;
        const ch = status & 0x0f;
        const kind = status >> 4;
        const a = bytes[p++];
        const b = kind === 0xc || kind === 0xd ? 0 : bytes[p++];
        if (ch !== 9 && kind === 0x9 && b > 0) events.push({ tick, order: order++, kind: "on", ch, a });
        else if (ch !== 9 && (kind === 0x8 || kind === 0x9)) events.push({ tick, order: order++, kind: "off", ch, a });
      }
    }
    at = end;
  }
  events.sort((x, y) => x.tick - y.tick || x.order - y.order);

  const notes: Note[] = [];
  const open = new Map<number, number[]>();
  let tempo = 500000;
  let lastTick = 0;
  let sec = 0;
  for (const e of events) {
    sec += ((e.tick - lastTick) * tempo) / division / 1e6;
    lastTick = e.tick;
    if (e.kind === "tempo") tempo = e.a;
    else if (e.kind === "on") {
      const key = e.ch * 128 + e.a;
      open.set(key, [...(open.get(key) ?? []), sec]);
    } else {
      const key = e.ch * 128 + e.a;
      const starts = open.get(key);
      const start = starts?.shift();
      if (start !== undefined) notes.push({ start, dur: Math.max(0.05, sec - start), pitch: e.a });
    }
  }
  return notes.sort((x, y) => x.start - y.start);
}

export interface Player {
  playing: boolean;
  play(notes: Note[], onEnd: () => void): void;
  stop(): void;
}

/** A tone player on Web Audio. One per score; `stop` silences it at once. */
export function createPlayer(): Player {
  let ctx: AudioContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onEnd: (() => void) | undefined;
  const player: Player = {
    playing: false,
    play(notes, done) {
      player.stop();
      const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor || notes.length === 0) return done();
      const audio = (ctx = new Ctor());
      const master = audio.createGain();
      master.gain.value = 0.22;
      master.connect(audio.destination);
      const t0 = audio.currentTime + 0.08;
      for (const n of notes) {
        const osc = audio.createOscillator();
        const env = audio.createGain();
        osc.type = "triangle";
        osc.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12);
        const end = t0 + n.start + n.dur;
        env.gain.setValueAtTime(0, t0 + n.start);
        env.gain.linearRampToValueAtTime(0.9, t0 + n.start + 0.015);
        env.gain.setValueAtTime(0.9, Math.max(t0 + n.start + 0.015, end - 0.06));
        env.gain.linearRampToValueAtTime(0, end);
        osc.connect(env).connect(master);
        osc.start(t0 + n.start);
        osc.stop(end + 0.02);
      }
      const last = Math.max(...notes.map((n) => n.start + n.dur));
      player.playing = true;
      onEnd = done;
      timer = setTimeout(() => player.stop(), (last + 0.3) * 1000);
    },
    stop() {
      clearTimeout(timer);
      void ctx?.close();
      ctx = undefined;
      const was = player.playing;
      player.playing = false;
      const cb = onEnd;
      onEnd = undefined;
      if (was) cb?.();
    },
  };
  return player;
}
