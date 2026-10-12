import type { Pack } from '../pack/load';
import { Sim } from '../engine/sim';
import { freePlay } from '../engine/traffic';
import { autoControl } from '../engine/autopilot';
import { Scope } from './scope';
import { DEFAULT_SETTINGS, type Settings } from '../store';
import type { Tx } from '../engine/types';

/** Live demo for the start page: real traffic worked by the autopilot controller on the real scope. */
export class Attract {
  sim: Sim;
  scope: Scope;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private ro: ResizeObserver;
  onTx?: (tx: Tx, sim: Sim) => void;

  constructor(pack: Pack, canvas: HTMLCanvasElement, settings: Settings) {
    const sc = freePlay(pack, { template: 'day', durationMin: 120, military: 1, weather: 'good', emergencies: false, difficulty: 1, seed: 7716 });
    sc.readbackErr = 0;
    sc.noSayAgain = true;
    this.sim = new Sim(pack, sc, { radarRefresh: 4 });
    for (let i = 0; i < 900; i++) { this.sim.step(); autoControl(this.sim); }
    this.sim.onTx.push((tx) => this.onTx?.(tx, this.sim));
    const s: Settings = { ...DEFAULT_SETTINGS, ...settings, labelSize: 'S', showProcedures: true, showMva: false };
    this.scope = new Scope(canvas, this.sim, s, { select() {}, item() {}, field() {}, longPress() {} });
    this.ro = new ResizeObserver(() => { this.scope.resize(); this.frame(); });
    this.ro.observe(canvas);
    this.frame();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }
  /** Fit the view so the airport sits in the visible part of the canvas. */
  private frame() {
    const sc = this.scope;
    const wide = sc.w > 900;
    sc.scale = Math.min(sc.w, sc.h) / (wide ? 44 : 40);
    // on wide screens the menu covers the left: shift the airport into the open right-hand side
    sc.center = wide ? { x: -(sc.w * 0.2) / sc.scale, y: -1 } : { x: 3, y: -2 };
  }
  private loop = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt * 3;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.sim.step();
      autoControl(this.sim);
      if (this.sim.ended || this.sim.t > 6000) this.sim.finish();
    }
    this.scope.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  };
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); }
}
