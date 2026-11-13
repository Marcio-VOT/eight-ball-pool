import type { SimEvent } from '@/engine/types';

export class PoolAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        this.ctx = new AudioCtor();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  playCueStrike(power: number): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340 + power * 220, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.045);

    const vol = Math.min(0.42, 0.1 + power * 0.32);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playSimEvent(ev: SimEvent): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (ev.type === 'BALL_HIT') {
      const intensity = Math.min(1, Math.max(0.08, ev.speed / 3.8));
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200 + intensity * 600, now);
      osc.frequency.exponentialRampToValueAtTime(750, now + 0.022);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(4400, now);
      osc2.frequency.exponentialRampToValueAtTime(1600, now + 0.015);

      gain.gain.setValueAtTime(0.32 * intensity, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.03);
      osc2.stop(now + 0.03);
      return;
    }

    if (ev.type === 'CUSHION_HIT') {
      const intensity = Math.min(1, Math.max(0.08, ev.speed / 3.2));
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.065);

      gain.gain.setValueAtTime(0.24 * intensity, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
      return;
    }

    if (ev.type === 'POCKET_DROP') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.exponentialRampToValueAtTime(72, now + 0.14);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    }
  }
}
