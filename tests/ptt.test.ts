import { describe, it, expect, beforeEach } from 'vitest';
import { PttCore, createPtt, listPedalCandidates, isTypingTarget, describeBinding, type PttEnv, type PttUp, type GamepadLike } from '../src/ui/ptt';

// A fake clock with manual timers, and plain EventTargets standing in for window, document and the button.
class FakeClock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number; every?: number }[] = [];
  private id = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.id; this.timers.push({ at: this.t + ms, fn, id }); return id; };
  setInterval = (fn: () => void, ms: number) => { const id = ++this.id; this.timers.push({ at: this.t + ms, fn, id, every: ms }); return id; };
  clearTimeout = (h: unknown) => { this.timers = this.timers.filter((x) => x.id !== h); };
  clearInterval = (h: unknown) => this.clearTimeout(h);
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = next.at;
      if (next.every) next.at += next.every; else this.timers = this.timers.filter((x) => x !== next);
      next.fn();
    }
    this.t = end;
  }
  get pending() { return this.timers.length; }
}
const ev = (type: string, props: Record<string, unknown> = {}) => {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  return e;
};
class FakeButton extends EventTarget {
  captured = new Set<number>();
  setPointerCapture(id: number) { this.captured.add(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 60, bottom: 60, width: 60, height: 60 }; }
}

function rig(extra: Partial<Parameters<typeof createPtt>[0]> = {}) {
  const clock = new FakeClock();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const pads: (GamepadLike | null)[] = [];
  const env: PttEnv = { win, doc, getGamepads: () => pads, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval };
  const btn = new FakeButton();
  const log: string[] = [];
  const ups: PttUp[] = [];
  const ptt = createPtt({ onDown: () => log.push('down'), onUp: (i) => { log.push('up:' + i!.reason); ups.push(i!); }, target: btn as unknown as HTMLElement, env, ...extra });
  return { clock, win, doc, pads, btn, log, ups, ptt };
}

describe('PttCore', () => {
  let clock: FakeClock;
  let log: string[];
  let core: PttCore;
  beforeEach(() => {
    clock = new FakeClock();
    log = [];
    core = new PttCore({ onDown: () => log.push('down'), onUp: (i) => log.push(`up:${i.reason}:${i.heldMs}`) }, clock, 40);
  });
  it('keys on press and unkeys after the debounce', () => {
    core.press('key');
    expect(core.active).toBe(true);
    clock.advance(500);
    core.release('key');
    expect(log).toEqual(['down']);
    clock.advance(40);
    expect(log).toEqual(['down', 'up:release:540']);
    expect(core.active).toBe(false);
  });
  it('rides through contact bounce', () => {
    core.press('pedal');
    core.release('pedal');
    clock.advance(10);
    core.press('pedal');
    clock.advance(100);
    core.release('pedal');
    clock.advance(50);
    expect(log).toEqual(['down', 'up:release:150']);
  });
  it('stays keyed while any source is held', () => {
    core.press('key');
    core.press('pointer');
    core.release('key');
    clock.advance(100);
    expect(log).toEqual(['down']);
    core.release('pointer');
    clock.advance(100);
    expect(log).toEqual(['down', 'up:release:140']);
  });
  it('a cancel ends at once', () => {
    core.press('pointer');
    clock.advance(30);
    core.release('pointer', 'cancel');
    expect(log).toEqual(['down', 'up:cancel:30']);
  });
  it('release of a source that is not held does nothing', () => {
    core.release('key');
    expect(log).toEqual([]);
  });
  it('releaseAll never leaves a stuck key', () => {
    core.press('key'); core.press('pad');
    core.releaseAll('blur');
    expect(log).toEqual(['down', 'up:blur:0']);
    core.release('key');
    clock.advance(100);
    expect(log.length).toBe(2);
    expect(clock.pending).toBe(0);
  });
  it('ignores presses while disabled', () => {
    core.enabled = false;
    core.press('key');
    expect(log).toEqual([]);
  });
});

describe('createPtt adapter', () => {
  it('Space keys and unkeys, ignoring auto-repeat', () => {
    const r = rig();
    const d = ev('keydown', { code: 'Space', target: {} });
    r.win.dispatchEvent(d);
    expect(d.defaultPrevented).toBe(true);
    r.win.dispatchEvent(ev('keydown', { code: 'Space', repeat: true }));
    r.win.dispatchEvent(ev('keydown', { code: 'Space', repeat: true }));
    r.clock.advance(800);
    const u = ev('keyup', { code: 'Space' });
    r.win.dispatchEvent(u);
    expect(u.defaultPrevented).toBe(true);
    r.clock.advance(50);
    expect(r.log).toEqual(['down', 'up:release']);
    expect(r.ups[0].heldMs).toBe(840);
  });
  it('Space in a text field types a space', () => {
    const r = rig();
    const d = ev('keydown', { code: 'Space', target: { tagName: 'INPUT', type: 'text' } });
    r.win.dispatchEvent(d);
    expect(d.defaultPrevented).toBe(false);
    expect(r.log).toEqual([]);
    r.win.dispatchEvent(ev('keyup', { code: 'Space' }));
    expect(r.log).toEqual([]);
  });
  it('a configurable key and a pedal key both work, even from a text field', () => {
    const r = rig({ key: 'ControlRight', pedal: { kind: 'key', code: 'F13' } });
    r.win.dispatchEvent(ev('keydown', { code: 'Space', target: {} }));
    expect(r.log).toEqual([]);
    r.win.dispatchEvent(ev('keydown', { code: 'F13', target: { tagName: 'TEXTAREA' } }));
    r.win.dispatchEvent(ev('keyup', { code: 'F13' }));
    r.clock.advance(50);
    expect(r.log).toEqual(['down', 'up:release']);
  });
  it('window blur and a hidden tab release a held key', () => {
    const r = rig();
    r.win.dispatchEvent(ev('keydown', { code: 'Space', target: {} }));
    r.win.dispatchEvent(ev('blur'));
    expect(r.log).toEqual(['down', 'up:blur']);
    r.win.dispatchEvent(ev('keyup', { code: 'Space' }));
    r.clock.advance(100);
    expect(r.log).toEqual(['down', 'up:blur']);
    r.win.dispatchEvent(ev('keydown', { code: 'Space', target: {} }));
    r.doc.visibilityState = 'hidden';
    r.doc.dispatchEvent(ev('visibilitychange'));
    expect(r.log).toEqual(['down', 'up:blur', 'down', 'up:hidden']);
  });
  it('the on-screen button holds with pointer capture', () => {
    const r = rig();
    const d = ev('pointerdown', { pointerId: 7, button: 0, clientX: 30, clientY: 30 });
    r.btn.dispatchEvent(d);
    expect(d.defaultPrevented).toBe(true);
    expect(r.btn.captured.has(7)).toBe(true);
    r.btn.dispatchEvent(ev('pointermove', { pointerId: 7, clientX: 80, clientY: 30 }));   // within the slop
    r.btn.dispatchEvent(ev('pointerleave', { pointerId: 7 }));                             // captured: ignored
    r.btn.dispatchEvent(ev('pointerup', { pointerId: 7 }));
    r.clock.advance(50);
    expect(r.log).toEqual(['down', 'up:release']);
  });
  it('sliding off the button cancels', () => {
    const r = rig();
    r.btn.dispatchEvent(ev('pointerdown', { pointerId: 1, button: 0 }));
    r.btn.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: 200, clientY: 30 }));
    expect(r.log).toEqual(['down', 'up:cancel']);
    r.btn.dispatchEvent(ev('pointerup', { pointerId: 1 }));
    expect(r.log).toEqual(['down', 'up:cancel']);
  });
  it('pointercancel (the system took the touch) cancels', () => {
    const r = rig();
    r.btn.dispatchEvent(ev('pointerdown', { pointerId: 1, button: 0 }));
    r.btn.dispatchEvent(ev('pointercancel', { pointerId: 1 }));
    expect(r.log).toEqual(['down', 'up:cancel']);
  });
  it('right button does not key', () => {
    const r = rig();
    r.btn.dispatchEvent(ev('pointerdown', { pointerId: 1, button: 2 }));
    expect(r.log).toEqual([]);
  });
  it('a gamepad pedal is polled', () => {
    const r = rig({ pedal: { kind: 'pad', button: 2 } });
    const btns = [{ pressed: false }, { pressed: false }, { pressed: false }];
    r.pads.push({ id: 'Foot Switch (Vendor: 1234)', index: 0, buttons: btns });
    r.clock.advance(60);
    expect(r.log).toEqual([]);
    btns[2].pressed = true;
    r.clock.advance(30);
    expect(r.log).toEqual(['down']);
    btns[2].pressed = false;
    r.clock.advance(30);
    r.clock.advance(50);
    expect(r.log).toEqual(['down', 'up:release']);
  });
  it('learns a pedal key, or a gamepad button that was not already down', async () => {
    const r = rig();
    const p1 = r.ptt.learnPedal();
    r.win.dispatchEvent(ev('keydown', { code: 'F14' }));
    expect(await p1).toEqual({ kind: 'key', code: 'F14' });
    expect(r.log).toEqual([]);

    const btns = [{ pressed: true }, { pressed: false }];
    r.pads.push({ id: 'Pedal', index: 0, buttons: btns });
    const p2 = r.ptt.learnPedal();
    r.clock.advance(60);                // button 0 was already held: not the pedal
    btns[1].pressed = true;
    r.clock.advance(30);
    expect(await p2).toEqual({ kind: 'pad', button: 1, pad: 'Pedal' });

    const p3 = r.ptt.learnPedal(1000);
    r.clock.advance(1000);
    expect(await p3).toBeNull();
    const p4 = r.ptt.learnPedal();
    r.win.dispatchEvent(ev('keydown', { code: 'Escape' }));
    expect(await p4).toBeNull();
  });
  it('setPedal, setEnabled, destroy', () => {
    const r = rig();
    r.ptt.setPedal({ kind: 'key', code: 'Pause' });
    r.win.dispatchEvent(ev('keydown', { code: 'Pause' }));
    expect(r.ptt.active).toBe(true);
    r.ptt.setEnabled(false);
    expect(r.log).toEqual(['down', 'up:disabled']);
    r.win.dispatchEvent(ev('keydown', { code: 'Space', target: {} }));
    expect(r.ptt.active).toBe(false);
    r.ptt.setEnabled(true);
    r.ptt.destroy();
    r.win.dispatchEvent(ev('keydown', { code: 'Space', target: {} }));
    expect(r.log).toEqual(['down', 'up:disabled']);
  });
});

describe('pedal helpers', () => {
  it('lists pressed gamepad buttons first, then the usual pedal keys', () => {
    const c = listPedalCandidates({ getGamepads: () => [{ id: 'Pad', index: 0, buttons: [{ pressed: false }, { pressed: true }] }, null] });
    expect(c[0]).toMatchObject({ binding: { kind: 'pad', button: 1, pad: 'Pad' }, pressed: true });
    expect(c.some((x) => x.binding.kind === 'key' && x.binding.code === 'F13')).toBe(true);
  });
  it('labels and typing targets', () => {
    expect(describeBinding({ kind: 'key', code: 'Space' })).toBe('Space bar');
    expect(describeBinding({ kind: 'pad', button: 0 })).toBe('Button 1');
    expect(describeBinding(null)).toBe('None');
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
  });
});
