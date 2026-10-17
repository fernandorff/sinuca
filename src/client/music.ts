// Música de fundo composta e tocada na hora (Web Audio): sem arquivos e sem direitos de terceiros.
// Cada faixa é uma sequência de acordes, baixo e bateria num relógio de semicolcheias.
export const TRACKS = [
  { id: 'off', label: 'Sem música' },
  { id: 'jazz', label: 'Jazz de bar' },
  { id: 'blues', label: 'Blues de boteco' },
  { id: 'bossa', label: 'Bossa nova' },
  { id: 'lofi', label: 'Lo-fi tranquilo' },
] as const;
export type TrackId = (typeof TRACKS)[number]['id'];

type Bar = { chord: number[]; bass: [number, number][] }; // bass: [passo 0..15, nota MIDI]
type Track = {
  bpm: number;
  swing: number; // atraso das semicolcheias ímpares (0 = reto)
  bars: Bar[];
  keys: number[]; // passos em que o acorde soa
  keysLen: number; // duração do acorde em passos
  kick: number[];
  snare: number[];
  hat: number[];
  crackle?: boolean;
};

const walk = (notes: number[]): [number, number][] => notes.map((n, i) => [i * 4, n]);

const SONGS: Record<Exclude<TrackId, 'off'>, Track> = {
  jazz: {
    bpm: 112, swing: 0.24,
    bars: [
      { chord: [62, 65, 69, 72], bass: walk([38, 41, 45, 43]) },
      { chord: [59, 65, 67, 71], bass: walk([43, 47, 50, 49]) },
      { chord: [60, 64, 67, 71], bass: walk([36, 40, 43, 45]) },
      { chord: [61, 64, 67, 69], bass: walk([45, 44, 43, 40]) },
    ],
    keys: [6, 14], keysLen: 3, kick: [], snare: [4, 12], hat: [0, 4, 7, 8, 12, 15],
  },
  blues: {
    bpm: 92, swing: 0.3,
    bars: [52, 52, 52, 52, 57, 57, 52, 52, 59, 57, 52, 59].map((root) => ({
      chord: [root, root + 4, root + 7, root + 10],
      bass: walk([root - 12, root - 5, root - 3, root - 5]),
    })),
    keys: [0, 7], keysLen: 6, kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12],
  },
  bossa: {
    bpm: 128, swing: 0,
    bars: [
      { chord: [60, 64, 67, 71], bass: [[0, 36], [6, 43], [8, 36], [14, 43]] },
      { chord: [57, 60, 64, 67], bass: [[0, 45], [6, 40], [8, 45], [14, 40]] },
      { chord: [62, 65, 69, 72], bass: [[0, 38], [6, 45], [8, 38], [14, 45]] },
      { chord: [59, 62, 65, 67], bass: [[0, 43], [6, 38], [8, 43], [14, 38]] },
    ],
    keys: [0, 3, 6, 10, 13], keysLen: 2, kick: [0, 8], snare: [3, 6, 10, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  lofi: {
    bpm: 76, swing: 0.18,
    bars: [
      { chord: [65, 69, 72, 76], bass: [[0, 41], [10, 41]] },
      { chord: [64, 67, 71, 74], bass: [[0, 40], [10, 40]] },
      { chord: [62, 65, 69, 72], bass: [[0, 38], [10, 38]] },
      { chord: [60, 64, 67, 71], bass: [[0, 36], [10, 43]] },
    ],
    keys: [0], keysLen: 15, kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], crackle: true,
  },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function createMusic() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let track: Track | null = null;
  let step = 0;
  let nextAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let crackle: AudioBufferSourceNode | null = null;
  // volume de 0 a 1; 0,4 é o volume de antes (ganho 0,16), então dá para subir até 2,5 vezes
  let volume = 0.4;

  function ensure() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume * 0.4;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function env(at: number, peak: number, dur: number) {
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(master!);
    return g;
  }

  function tone(type: OscillatorType, freq: number, at: number, dur: number, peak: number) {
    const o = ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(env(at, peak, dur));
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function noiseHit(at: number, type: BiquadFilterType, freq: number, dur: number, peak: number) {
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    const f = ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(env(at, peak, dur));
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  function schedule(t: Track, s: number, at: number, stepDur: number) {
    const bar = t.bars[Math.floor(s / 16) % t.bars.length];
    const i = s % 16;
    if (t.keys.includes(i)) {
      // piano elétrico: triângulo + seno uma oitava acima, suave
      for (const n of bar.chord) {
        tone('triangle', hz(n), at, stepDur * t.keysLen, 0.05);
        tone('sine', hz(n + 12), at, stepDur * t.keysLen * 0.6, 0.015);
      }
    }
    for (const [bs, n] of bar.bass) if (bs === i) tone('sine', hz(n), at, stepDur * 3.2, 0.22);
    if (t.kick.includes(i)) {
      const o = ctx!.createOscillator();
      o.frequency.setValueAtTime(110, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      o.connect(env(at, 0.35, 0.16));
      o.start(at);
      o.stop(at + 0.2);
    }
    if (t.snare.includes(i)) noiseHit(at, 'bandpass', 1900, 0.09, 0.1);
    if (t.hat.includes(i)) noiseHit(at, 'highpass', 7500, 0.04, 0.05);
  }

  function tick() {
    if (!ctx || !track) return;
    const stepDur = 60 / track.bpm / 4;
    while (nextAt < ctx.currentTime + 0.25) {
      const swing = step % 2 === 1 ? track.swing * stepDur : 0;
      schedule(track, step, nextAt + swing, stepDur);
      nextAt += stepDur;
      step++;
    }
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    track = null;
    crackle?.stop();
    crackle = null;
  }

  return {
    setVolume(v: number) {
      volume = v;
      if (master) master.gain.value = v * 0.4;
    },
    // precisa vir de um toque ou clique (regra do navegador para áudio)
    play(id: TrackId) {
      stop();
      if (id === 'off') return;
      const c = ensure();
      if (c.state === 'suspended') void c.resume();
      track = SONGS[id];
      step = 0;
      nextAt = c.currentTime + 0.1;
      timer = setInterval(tick, 80);
      tick();
      if (track.crackle) {
        // chiado de vinil, bem baixinho
        crackle = c.createBufferSource();
        crackle.buffer = noise;
        crackle.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 3000;
        const g = c.createGain();
        g.gain.value = 0.02;
        crackle.connect(f).connect(g).connect(master!);
        crackle.start();
      }
    },
    stop,
  };
}
