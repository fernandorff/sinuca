// Sons sintetizados na hora (Web Audio), sem arquivos: taco, bola com bola, tabela e caçapa.
// O navegador só libera áudio depois de um toque, por isso unlock() roda no primeiro pointerdown.
export type SoundKind = 'cue' | 'ball' | 'cushion' | 'pocket';

export function createSound(isMuted: () => boolean) {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let last = 0;
  let burst = 0;

  function unlock() {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return;
      }
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }
  window.addEventListener('pointerdown', unlock);

  // um estalo: ruído filtrado com envelope curto; tom = frequência do filtro, dur = duração
  function click(at: number, tone: number, q: number, dur: number, gain: number) {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = tone;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(c.destination);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  function thump(at: number, freq: number, dur: number, gain: number) {
    const c = ctx!;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(c.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  return {
    unlock,
    // intensity 0..1 (velocidade do impacto já normalizada)
    play(kind: SoundKind, intensity = 1) {
      if (!ctx || !noise || isMuted() || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // muitas batidas no mesmo instante (a saída) viram um ruído só: limita o volume somado
      burst = now - last < 0.03 ? burst + 1 : 0;
      last = now;
      if (burst > 4) return;
      const v = Math.min(1, Math.max(0.05, intensity));
      if (kind === 'cue') {
        click(now, 1800, 1.2, 0.06, 0.5 * v);
        thump(now, 180, 0.08, 0.25 * v);
      } else if (kind === 'ball') {
        click(now, 3200, 2.5, 0.045, 0.9 * v);
      } else if (kind === 'cushion') {
        thump(now, 120, 0.12, 0.45 * v);
        click(now, 600, 0.8, 0.05, 0.15 * v);
      } else {
        thump(now, 90, 0.25, 0.6);
        click(now + 0.06, 900, 1.5, 0.12, 0.25);
        click(now + 0.14, 700, 1.5, 0.1, 0.15);
      }
    },
  };
}
