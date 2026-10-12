import type { Pack } from '../pack/load';
import { Sim } from '../engine/sim';
import type { Aircraft, Scenario, Tx } from '../engine/types';
import { itemChip, levelText, mergeItem, phraseology, sortItems, type Clearance, type Item } from '../engine/clearance';
import { parseShorthand, voiceToShorthand } from '../engine/parser';
import { wakeMinNm } from '../engine/perf';
import { windComponents } from '../engine/weather';
import { assess, type Result } from '../engine/assess';
import { norm360, dist } from '../geo';
import { Scope } from './scope';
import { Mic, Radio } from './audio';
import type { Settings } from '../store';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface GameOpts { replay?: { cmds: { t: number; cl: Clearance }[]; until: number }; onEnd(r: Result, sim: Sim): void; onQuit(): void }

export class Game {
  sim: Sim;
  scope: Scope;
  root: HTMLElement;
  speed = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private items: Item[] = [];
  private cs?: string;
  private panelTimer = 0;
  private radio: Radio;
  private mic = new Mic();
  private knownAlerts = new Set<string>();
  private endedShown = false;
  private els: Record<string, HTMLElement> = {};
  private drawerTab: 'info' | 'aman' | 'strips' | 'comms' = 'strips';
  private commsStick = true;
  private pendingSwitch?: string;
  private voiceText = '';

  constructor(public pack: Pack, public sc: Scenario, public settings: Settings, mount: HTMLElement, radio: Radio, public opts: GameOpts) {
    this.radio = radio;
    this.radio.enabled = settings.voice;
    this.radio.rate = settings.speechRate;
    this.sim = new Sim(pack, sc, { radarRefresh: settings.radarRefresh });
    if (opts.replay) {
      const { cmds, until } = opts.replay;
      let i = 0;
      while (this.sim.t < until && !this.sim.ended) {
        while (i < cmds.length && cmds[i].t === this.sim.t) this.sim.issue(cmds[i++].cl, { replay: true });
        this.sim.step();
      }
    }
    this.root = this.build();
    mount.replaceChildren(this.root);
    const canvas = this.root.querySelector('canvas')!;
    this.scope = new Scope(canvas, this.sim, settings, {
      select: (cs) => this.select(cs),
      item: (cs, it) => { if (this.cs !== cs) this.select(cs); this.addItem(it); },
      field: (cs, f, at) => { if (this.cs !== cs) this.select(cs); this.openPicker(f === 'lvl' ? 'lvl' : f === 'spd' ? 'spd' : 'app', at); },
      longPress: (cs) => { this.select(cs); this.openPicker('more'); },
      emptyTap: () => this.closePicker(),
    });
    this.sim.onTx.push((tx) => this.onTx(tx));
    for (const tx of this.sim.log.slice(-12)) this.appendComms(tx);
    new ResizeObserver(() => this.scope.resize()).observe(canvas);
    window.addEventListener('keydown', this.onKey);
    this.renderBar();
    this.renderPanels();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    if (opts.replay) this.toast(`Replay from ${this.sim.utc().slice(0, 5)}Z. Your earlier commands ran up to here.`);
    else this.toast(sc.objective ?? sc.desc, 6000);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.radio.cancel();
  }

  // ---------------- DOM ----------------
  private build(): HTMLElement {
    const root = h('div', `game ${this.settings.leftHanded ? 'lefty' : ''} ${this.settings.brightness}`);
    root.innerHTML = `
      <header class="topbar">
        <button class="tb-btn" data-a="menu" aria-label="Menu">☰</button>
        <div class="clock mono" data-e="clock">--:--:--Z</div>
        <div class="tag" data-e="atis">ATIS -</div>
        <div class="tag" data-e="rwy">RWY --</div>
        <div class="tag warn" data-e="lvp" hidden>LVP</div>
        <div class="tx" data-e="tx" title="Frequency in use"><span></span>119.280</div>
        <div class="grow"></div>
        <button class="tb-btn callers" data-a="next" data-e="callers">CALLS 0</button>
        <div class="speed" data-e="speed">
          <button data-s="0" aria-label="Pause">❚❚</button><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button>
        </div>
        <button class="tb-btn drawer-btn" data-a="drawer" aria-label="Panels">▤</button>
      </header>
      <main class="stage">
        <section class="scope-wrap">
          <canvas class="scope" aria-label="Radar display"></canvas>
          <div class="zoom"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Reset view">◎</button></div>
          <div class="toast" data-e="toast" hidden></div>
        </section>
        <aside class="side" data-e="side">
          <nav class="tabs" data-e="tabs"><button data-t="strips" class="on">Strips</button><button data-t="aman">AMAN</button><button data-t="comms">Comms</button><button data-t="info">Info</button></nav>
          <section class="panel info" data-p="info"><h3>Information</h3><div data-e="info"></div></section>
          <div class="mid">
            <section class="panel aman" data-p="aman"><h3>AMAN <span data-e="amanRwy"></span></h3><div class="aman-body" data-e="aman"></div></section>
            <section class="panel strips" data-p="strips"><h3>Strips</h3><div class="strip-list" data-e="strips"></div></section>
          </div>
          <section class="panel comms" data-p="comms"><h3>Comms <span class="dim">119.280</span></h3><div class="comms-log" data-e="comms"></div></section>
        </aside>
      </main>
      <footer class="bar" data-e="bar">
        <div class="ticker mono" data-e="ticker"></div>
        <div class="bar-head">
          <div class="who" data-e="who"></div>
          <div class="req" data-e="req"></div>
          <button class="mic" data-a="mic" data-e="mic" aria-label="Push to talk">🎙</button>
          <button class="x" data-a="clear" aria-label="Clear">✕</button>
        </div>
        <div class="bar-mid"><div class="chips" data-e="chips"></div><div class="phrase" data-e="phrase"></div></div>
        <div class="bar-grid">
          <button data-p="hdg">HDG</button><button data-p="lvl">LVL</button><button data-p="spd">SPD</button><button data-p="dct">DCT</button><button data-a="app" data-e="appBtn">ILS</button>
          <button data-p="trans">TRANS</button><button data-a="hold">HOLD</button><button data-a="twr">TWR</button><button data-a="bru">BRU</button><button data-p="more">MORE</button>
          <button class="send" data-a="send" data-e="send">TRANSMIT</button>
        </div>
        <form class="cmd" data-e="cmdForm"><input data-e="cmd" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Type: DHK7 L250 D40 S210 ILS  ⏎   (Tab = next caller)"></form>
      </footer>
      <div class="picker" data-e="picker" hidden></div>
    `;
    root.querySelectorAll<HTMLElement>('[data-e]').forEach((e) => (this.els[e.dataset.e!] = e));
    root.addEventListener('click', (e) => this.onClick(e));
    this.els.comms.addEventListener('scroll', () => { const c = this.els.comms; this.commsStick = c.scrollTop + c.clientHeight >= c.scrollHeight - 30; });
    (this.els.cmdForm as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); this.submitCmd(); });
    const mic = this.els.mic;
    if (!this.mic.available) mic.classList.add('off');
    mic.addEventListener('pointerdown', (e) => { e.preventDefault(); this.startVoice(); });
    mic.addEventListener('pointerup', () => this.mic.stop());
    mic.addEventListener('pointerleave', () => this.mic.stop());
    return root;
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('button, .strip, [data-pick]') as HTMLElement | null;
    if (!t) { const el = e.target as HTMLElement; if (!el.closest('.picker') && el.tagName !== 'CANVAS') this.closePicker(); return; }
    this.radio.unlock();
    if (t.dataset.pick !== undefined) { this.onPick(t.dataset.pick); return; }
    if (t.classList.contains('strip')) { this.select(t.dataset.cs); return; }
    const a = t.dataset.a, p = t.dataset.p, s = t.dataset.s, z = t.dataset.z, tab = t.dataset.t;
    if (s !== undefined) { this.setSpeed(Number(s)); return; }
    if (z) { if (z === 'in') this.scope.zoom(1.35); else if (z === 'out') this.scope.zoom(1 / 1.35); else this.scope.fit(); return; }
    if (tab) { this.drawerTab = tab as any; this.root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab)); this.root.dataset.tab = tab; return; }
    if (p) { this.openPicker(p as any); return; }
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    switch (a) {
      case 'menu': this.openPicker('menu'); break;
      case 'next': this.nextCaller(); break;
      case 'drawer': this.root.classList.toggle('drawer-open'); break;
      case 'clear': this.items = []; this.voiceText = ''; this.renderBar(); break;
      case 'send': this.send(); break;
      case 'app': if (ac) this.addItem({ k: 'app', app: 'ILS', rwy: this.sim.runway }); break;
      case 'hold': if (ac) this.addItem({ k: 'hold', fix: 'ALHUV' }); break;
      case 'twr': if (ac) this.addItem({ k: 'xfr', unit: 'TWR' }); break;
      case 'bru': if (ac) this.addItem({ k: 'xfr', unit: 'BRU' }); break;
      case 'appr': if (ac) { this.addItem({ k: 'appr' }); } break;
      case 'deny': if (ac) { this.addItem({ k: 'deny' }); } break;
      case 'switch-send': { const nxt = this.pendingSwitch; this.pendingSwitch = undefined; this.send(); this.select(nxt, true); break; }
      case 'switch-drop': { const nxt = this.pendingSwitch; this.pendingSwitch = undefined; this.items = []; this.select(nxt, true); break; }
      case 'chip': { const i = Number(t.dataset.i); this.items.splice(i, 1); this.renderBar(); break; }
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const inInput = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Tab') { e.preventDefault(); this.nextCaller(); return; }
    if (e.key === 'Escape') { this.closePicker(); this.items = []; this.renderBar(); (this.els.cmd as HTMLInputElement).value = ''; return; }
    if (inInput) return;
    if (e.key === ' ') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); return; }
    if (e.key === 'Enter') { this.send(); return; }
    if (/^[a-z0-9]$/i.test(e.key) && !e.metaKey && !e.ctrlKey) (this.els.cmd as HTMLInputElement).focus();
  };

  // ---------------- selection and clearance building ----------------
  select(cs?: string, force = false) {
    if (!force && cs && this.cs && cs !== this.cs && this.items.length) {
      this.pendingSwitch = cs;
      this.renderBar();
      return;
    }
    const changed = cs !== this.cs;
    this.cs = cs;
    this.scope.selected = cs;
    if (changed) this.items = [];
    this.voiceText = '';
    this.closePicker();
    this.renderBar();
    this.renderPanels();
  }
  addItem(it: Item) {
    if (!this.cs) return;
    this.items = mergeItem(this.items, it);
    this.voiceText = '';
    this.closePicker();
    if (this.settings.quickMode) this.send();
    else this.renderBar();
  }
  private nextCaller() {
    const c = this.sim.callers().filter((a) => a.state === 'assumed' && this.sim.t >= (a.awaitingSince ?? 0));
    if (!c.length) { this.toast('Nobody is waiting for you'); return; }
    const idx = c.findIndex((a) => a.cs === this.cs);
    this.select(c[(idx + 1) % c.length].cs, true);
  }
  private send() {
    if (!this.cs || !this.items.length) return;
    const cl: Clearance = { cs: this.cs, items: sortItems(this.items) };
    const warns = this.sim.validate(cl);
    if (this.settings.trainingWheels && warns.length) { this.toast(`Blocked: ${warns.join('; ')}`); return; }
    const r = this.sim.issue(cl);
    if (r.ok) { this.items = []; this.renderBar(); this.renderPanels(); }
  }
  private submitCmd() {
    const inp = this.els.cmd as HTMLInputElement;
    const txt = inp.value.trim();
    if (!txt) { this.send(); return; }
    const res = parseShorthand(txt, this.parseCtx());
    if (res.errors.length) { this.toast(res.errors.join('; ')); return; }
    if (res.cs && res.cs !== this.cs) { this.items = []; this.select(res.cs, true); }
    if (!this.cs) { this.toast('Select an aircraft or start with a callsign'); return; }
    for (const it of res.items) this.items = mergeItem(this.items, it);
    inp.value = '';
    this.send();
  }
  private parseCtx() {
    return {
      callsigns: this.sim.aircraft.map((a) => a.cs), selected: this.cs, runway: this.sim.runway, tl: this.sim.tl,
      fixes: new Set([...this.sim.pack.fixes.keys()]), transitions: new Set(this.sim.pack.transitions.map((t) => t.name)),
    };
  }
  private startVoice() {
    this.radio.unlock();
    if (!this.mic.available) { this.toast('Voice input is not supported in this browser. Use tap or typed commands.'); return; }
    this.els.mic.classList.add('live');
    this.mic.start((text, final) => {
      this.voiceText = text;
      if (final) {
        this.els.mic.classList.remove('live');
        const tels: Record<string, string> = {};
        for (const a of this.sim.aircraft) tels[a.cs] = a.tel;
        const sh = voiceToShorthand(text, tels, [...this.sim.pack.fixes.keys()]);
        const res = parseShorthand(sh, this.parseCtx());
        if (res.cs && res.cs !== this.cs) this.select(res.cs, true);
        for (const it of res.items) this.items = mergeItem(this.items, it);
        this.voiceText = `“${text}”`;
      }
      this.renderBar();
    }, (err) => { this.els.mic.classList.remove('live'); this.toast(err); });
  }

  // ---------------- pickers ----------------
  private openPicker(kind: 'hdg' | 'lvl' | 'spd' | 'dct' | 'trans' | 'more' | 'app' | 'menu', at?: { x: number; y: number }) {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    if (kind !== 'menu' && !ac) { this.toast('Select an aircraft first'); return; }
    const pk = this.els.picker;
    const sim = this.sim;
    const rows: string[] = [];
    const opt = (key: string, label: string, cls = '', note = '') => rows.push(`<button data-pick="${esc(key)}" class="${cls}"><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</button>`);
    let title = '';
    switch (kind) {
      case 'lvl': {
        title = `Level · ${ac!.cs}`;
        const mva = sim.mvaAt(ac!.p);
        const vals: number[] = [];
        for (let fl = 140; fl >= sim.tl; fl -= 10) vals.push(fl * 100 + (sim.qnh - 1013.25) * 27);
        for (const a of [5000, 4000, 3500, 3000, 2500, 2000]) if (a < sim.tl * 100) vals.push(a);
        let mvaDrawn = false;
        const cur = ac!.alt, clr = ac!.tgtAlt;
        for (const v of vals) {
          const lv = sim.levelFor(Math.round(v / 100) * 100);
          const key = lv.fl !== undefined ? `F${lv.fl}` : `A${lv.ft}`;
          if (!mvaDrawn && v < mva - 1) { rows.push(`<div class="mva-line">MVA ${mva}</div>`); mvaDrawn = true; }
          const isClr = Math.abs(v - clr) < 60, isCur = Math.abs(v - cur) < 500;
          opt(key, levelText(lv), `${isClr ? 'cleared' : ''} ${isCur ? 'current' : ''} ${v < mva - 1 ? 'below' : ''}`, isClr ? 'cleared' : isCur ? 'now' : '');
        }
        break;
      }
      case 'spd': {
        title = `Speed · ${ac!.cs} (${ac!.type})`;
        opt('SU160/4', '160 until 4 DME', 'special'); opt('SU180/6', '180 until 6 DME', 'special'); opt('SMIN', `Minimum clean (${ac!.perf.vminClean})`, 'special'); opt('SRES', 'Resume normal speed', 'special');
        const established = ac!.app?.locCap || sim.dthr(ac!) < 15;
        for (let v = 300; v >= Math.max(140, Math.floor(ac!.perf.vapp / 10) * 10 + 10); v -= 10) {
          const low = v < ac!.perf.vminClean && !established;
          opt(`S${v}`, String(v), `${Math.abs(v - ac!.ias) < 6 ? 'current' : ''} ${low ? 'below' : ''}`, low ? 'below min clean' : Math.abs(v - ac!.ias) < 6 ? 'now' : '');
        }
        break;
      }
      case 'hdg': {
        title = `Heading · ${ac!.cs}`;
        const cur = Math.round(norm360(ac!.hdg - sim.pack.meta.magVar) / 5) * 5;
        opt(`H${cur || 360}`, `Present heading ${String(cur || 360).padStart(3, '0')}`, 'special');
        rows.push('<div class="two">');
        for (let d = 10; d <= 90; d += 10) {
          const l = norm360(cur - d) || 360, r = norm360(cur + d) || 360;
          opt(`L${l}`, `L${String(l).padStart(3, '0')}`); opt(`R${r}`, `R${String(r).padStart(3, '0')}`);
        }
        rows.push('</div>');
        break;
      }
      case 'dct': {
        title = `Direct · ${ac!.cs}`;
        const fx = this.scope.visibleFixes().filter((f) => f.kind !== 'vfr' || ac!.rules === 'VFR').map((f) => ({ f, d: dist(ac!.p, f.p) })).filter((x) => x.d > 1.5 && x.d < 50).sort((a, b) => a.d - b.d).slice(0, 18);
        for (const { f, d } of fx) opt(`DCT ${f.id}`, f.id, '', `${d.toFixed(0)} NM`);
        break;
      }
      case 'trans': {
        title = `Transition · runway ${sim.runway}`;
        for (const t of sim.transitionsFor(sim.runway)) opt(`T ${t.name}`, t.name, '', `${t.legs.map((l) => l.fix).slice(1).join(' ')}${t.atcDiscretion ? ' · ATC discretion' : ''}`);
        break;
      }
      case 'app': case 'more': {
        title = kind === 'app' ? `Approach · ${ac!.cs}` : `More · ${ac!.cs}`;
        for (const [id, r] of sim.pack.runways) {
          if (r.ils) opt(`ILS ${id}`, `ILS ${id}`, id === sim.runway ? 'special' : '', `CAT ${r.ils.cat}${sim.ilsOut.has(id) ? ' · OUT' : ''}${id === sim.runway ? ' · in use' : ''}`);
        }
        opt(`RNP ${sim.runway}`, `RNP ${sim.runway}`); opt(`VIS ${sim.runway}`, `Visual ${sim.runway}`);
        if (kind === 'more') {
          opt('RON', 'Resume own navigation'); opt('HOLD GIREL', 'Hold GIREL', '', 'ATC discretion'); opt('HOLD GSY', 'Hold GSY', '', 'ATC discretion');
          opt('SMIN', 'Minimum clean speed'); opt('SRES', 'Resume normal speed'); opt('MUAC', 'Contact Maastricht'); opt('BEEK', 'Contact Beek'); opt('SQ7000', 'Squawk 7000');
        }
        break;
      }
      case 'menu': {
        title = 'Session';
        opt('#pause', this.speed ? 'Pause' : 'Resume');
        opt('#end', 'End session and debrief');
        opt('#mva', `${this.settings.showMva ? 'Hide' : 'Show'} MVA overlay`);
        opt('#proc', `${this.settings.showProcedures ? 'Hide' : 'Show'} procedures`);
        opt('#vec', `Speed vector ${this.settings.speedVectorMin} min (change)`);
        opt('#voice', `Pilot voices ${this.radio.enabled ? 'on' : 'off'}`);
        opt('#bright', `Brightness: ${this.settings.brightness}`);
        opt('#quit', 'Quit without debrief');
        break;
      }
    }
    pk.innerHTML = `<div class="pk-head"><b>${esc(title)}</b><button data-pick="#close" aria-label="Close">✕</button></div><div class="pk-body">${rows.join('')}</div>`;
    pk.hidden = false;
    pk.dataset.kind = kind;
    const wide = window.innerWidth >= 900;
    if (wide && at) {
      const r = this.scope.canvas.getBoundingClientRect();
      pk.style.left = `${Math.min(r.left + at.x + 16, window.innerWidth - 260)}px`;
      pk.style.top = `${Math.max(56, Math.min(r.top + at.y - 120, window.innerHeight - 440))}px`;
      pk.classList.add('floating');
    } else { pk.style.left = ''; pk.style.top = ''; pk.style.bottom = `${this.els.bar.offsetHeight + 8}px`; pk.classList.remove('floating'); }
    const cur = pk.querySelector('.cleared, .current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  private closePicker() { this.els.picker.hidden = true; }

  private onPick(key: string) {
    if (key.startsWith('#')) {
      this.closePicker();
      switch (key) {
        case '#pause': this.setSpeed(this.speed ? 0 : 1); break;
        case '#end': this.endSession(); break;
        case '#quit': this.destroy(); this.opts.onQuit(); break;
        case '#mva': this.settings.showMva = !this.settings.showMva; break;
        case '#proc': this.settings.showProcedures = !this.settings.showProcedures; break;
        case '#vec': this.settings.speedVectorMin = (this.settings.speedVectorMin % 3 + 1) as 1 | 2 | 3; break;
        case '#voice': this.radio.enabled = !this.radio.enabled; if (!this.radio.enabled) this.radio.cancel(); break;
        case '#bright': this.settings.brightness = this.settings.brightness === 'night' ? 'day' : 'night'; this.root.classList.toggle('day'); this.root.classList.toggle('night'); break;
      }
      return;
    }
    let it: Item | undefined;
    let m: RegExpMatchArray | null;
    if ((m = key.match(/^F(\d+)$/))) it = { k: 'lvl', lvl: { fl: Number(m[1]) } };
    else if ((m = key.match(/^A(\d+)$/))) it = { k: 'lvl', lvl: { ft: Number(m[1]) } };
    else if ((m = key.match(/^SU(\d+)\/(\d+)$/))) it = { k: 'spd', spd: Number(m[1]), until: Number(m[2]) };
    else if ((m = key.match(/^S(\d+)$/))) it = { k: 'spd', spd: Number(m[1]) };
    else if (key === 'SMIN') it = { k: 'spdmin' };
    else if (key === 'SRES') it = { k: 'spdres' };
    else if ((m = key.match(/^([HLR])(\d+)$/))) it = { k: 'hdg', hdg: Number(m[2]), dir: m[1] === 'H' ? undefined : (m[1] as 'L' | 'R') };
    else if ((m = key.match(/^DCT (\w+)$/))) it = { k: 'dct', fix: m[1] };
    else if ((m = key.match(/^T (\w+)$/))) it = { k: 'trans', name: m[1] };
    else if ((m = key.match(/^(ILS|RNP|VIS) (\w+)$/))) it = { k: 'app', app: m[1] as any, rwy: m[2] };
    else if (key === 'RON') it = { k: 'ron' };
    else if ((m = key.match(/^HOLD (\w+)$/))) it = { k: 'hold', fix: m[1] };
    else if (key === 'MUAC' || key === 'BEEK') it = { k: 'xfr', unit: key };
    else if ((m = key.match(/^SQ(\d{4})$/))) it = { k: 'sqk', code: m[1] };
    if (it) this.addItem(it);
  }

  // ---------------- loop ----------------
  private loop = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.speed > 0 && !this.sim.ended) {
      this.acc += dt * this.speed;
      while (this.acc >= 1) { this.acc -= 1; this.sim.step(); }
    }
    this.scope.draw(now);
    this.panelTimer += dt;
    if (this.panelTimer > 0.5) { this.panelTimer = 0; this.renderPanels(); this.renderBarLive(); this.checkAlerts(); }
    if (this.sim.ended && !this.endedShown) { this.endedShown = true; this.endSession(); return; }
    this.raf = requestAnimationFrame(this.loop);
  };
  private setSpeed(s: number) {
    this.speed = s;
    if (s !== 1) this.radio.cancel();
    this.els.speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === s));
  }
  private endSession() {
    this.sim.finish();
    this.endedShown = true;
    cancelAnimationFrame(this.raf);
    this.radio.cancel();
    const r = assess(this.sim);
    if (this.opts.replay) r.title += ' (replay)';
    this.opts.onEnd(r, this.sim);
  }
  private checkAlerts() {
    const now = new Set(this.sim.alerts().map((a) => a.a + a.b));
    for (const k of now) if (!this.knownAlerts.has(k)) { this.radio.alert(); break; }
    this.knownAlerts = now;
  }

  // ---------------- comms ----------------
  private onTx(tx: Tx) {
    this.appendComms(tx);
    this.els.ticker.innerHTML = `<b>${esc(tx.from === 'ATC' ? 'YOU' : tx.from === 'SYS' ? 'SYS' : tx.cs)}</b> ${esc(tx.text)}`;
    this.els.ticker.className = `ticker mono ${tx.from.toLowerCase()} ${tx.emergency ? 'emer' : ''}`;
    if (this.speed === 1) {
      if (tx.from === 'PILOT') this.radio.speak(tx.speech, tx.cs);
      else if (tx.from === 'ATC' && this.settings.speakAtc) this.radio.speak(tx.speech, 'ATC', true);
    }
    if (tx.from === 'SYS') this.toast(tx.text);
    const light = this.els.tx;
    light.classList.add('busy');
    window.setTimeout(() => light.classList.remove('busy'), Math.max(600, ((tx.t1 - tx.t0) * 1000) / Math.max(1, this.speed)));
  }
  private appendComms(tx: Tx) {
    const c = this.els.comms;
    const row = h('div', `msg ${tx.from.toLowerCase()} ${tx.emergency ? 'emer' : ''}`);
    row.innerHTML = `<span class="t">${this.sim.utc(tx.t0).slice(3, 8)}</span><span class="w">${tx.from === 'ATC' ? 'APP' : tx.from === 'SYS' ? 'SYS' : esc(tx.cs)}</span><span class="x">${esc(tx.text)}</span>`;
    if (tx.cs) { row.dataset.cs = tx.cs; row.classList.add('strip-link'); row.addEventListener('click', () => this.select(tx.cs)); }
    c.appendChild(row);
    while (c.children.length > 120) c.firstChild!.remove();
    if (this.commsStick) c.scrollTop = c.scrollHeight;
  }

  private toastTimer = 0;
  toast(text: string, ms = 3500) {
    const t = this.els.toast;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }

  // ---------------- bar ----------------
  private renderBar() {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    const { who, chips, phrase, send, req } = this.els;
    if (this.cs && !ac) { this.cs = undefined; this.scope.selected = undefined; this.items = []; }
    if (this.pendingSwitch) {
      who.innerHTML = `<div class="cs mono">${esc(this.cs ?? '')}</div><div class="meta">Clearance not sent. Switch to ${esc(this.pendingSwitch)}?</div>`;
      req.innerHTML = `<button data-a="switch-send" class="ok">Send first</button><button data-a="switch-drop">Discard</button>`;
      return;
    }
    if (!ac) {
      const c = this.sim.callers().filter((a) => a.state === 'assumed');
      who.innerHTML = `<div class="cs mono dim">— — —</div><div class="meta">${c.length ? `${c.length} waiting · tap CALLS or Tab` : 'Tap an aircraft, its label or its strip'}</div>`;
      chips.innerHTML = ''; phrase.textContent = this.voiceText; req.innerHTML = '';
      (send as HTMLButtonElement).disabled = true;
      return;
    }
    const proc = ac.proc ?? (ac.rules === 'VFR' ? 'VFR' : ac.kind.toUpperCase());
    who.innerHTML = `<div class="cs mono">${esc(ac.cs)}</div><div class="meta">${esc(ac.perf.name)} · ${ac.perf.wake}/${ac.perf.recat} · ${esc(proc)} · <span data-e2="state">${this.stateText(ac)}</span></div>`;
    chips.innerHTML = this.items.map((it, i) => `<button class="chip mono" data-a="chip" data-i="${i}" title="Remove">${esc(itemChip(it))}</button>`).join('');
    req.innerHTML = ac.request ? `<div class="req-text"><b>REQ</b> ${esc(ac.request.text)}</div><button data-a="appr" class="ok">Approve</button><button data-a="deny">Unable</button>` : '';
    const warn = this.items.length ? this.sim.validate({ cs: ac.cs, items: this.items }) : [];
    const ph = this.items.length ? phraseology({ cs: ac.cs, items: sortItems(this.items) }, { alt: ac.alt, qnh: this.sim.qnh, hdgMag: 0 }).text : this.voiceText;
    phrase.innerHTML = `${esc(ph)}${warn.length ? `<span class="warn">⚠ ${esc(warn.join(' · '))}</span>` : ''}`;
    const blocked = this.settings.trainingWheels && warn.length > 0;
    (send as HTMLButtonElement).disabled = !this.items.length || blocked;
    send.classList.toggle('warned', warn.length > 0);
    this.els.appBtn.textContent = `ILS ${this.sim.runway}`;
  }
  private renderBarLive() {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    if (this.cs && !ac) { this.renderBar(); return; }
    const st = this.els.who.querySelector('[data-e2="state"]');
    if (ac && st) st.textContent = this.stateText(ac);
    if (!ac) this.renderBar();
  }
  private stateText(ac: Aircraft) {
    if (ac.awaitingSince !== undefined && this.sim.t >= ac.awaitingSince) return `calling ${Math.round(this.sim.t - ac.awaitingSince)} s`;
    if (ac.state === 'inbound') return 'handoff offered';
    if (ac.state === 'transferred') return `with ${ac.xfrUnit === 'TWR' ? 'Tower' : ac.xfrUnit}`;
    if (ac.radioFail) return 'NORDO 7600';
    return `${levelText(this.sim.levelFor(Math.round(ac.alt / 100) * 100))} → ${levelText(ac.cleared)}`;
  }

  // ---------------- panels ----------------
  private renderPanels() {
    const sim = this.sim;
    this.els.clock.textContent = `${sim.utc()}Z`;
    this.els.atis.textContent = `ATIS ${sim.atis}`;
    this.els.rwy.textContent = `RWY ${sim.runway}`;
    this.els.lvp.hidden = !sim.lvp;
    const callers = sim.callers().filter((a) => a.state === 'assumed' && sim.t >= (a.awaitingSince ?? 0));
    this.els.callers.textContent = window.innerWidth < 600 ? `☎ ${callers.length}` : `CALLS ${callers.length}`;
    this.els.callers.classList.toggle('hot', callers.length > 0);
    this.els.callers.classList.toggle('urgent', callers.some((a) => sim.t - a.awaitingSince! > 15 || a.emergency));
    this.renderInfo();
    this.renderAman();
    this.renderStrips();
  }
  private renderInfo() {
    const sim = this.sim, w = sim.weather, rw = sim.rwy;
    const c = windComponents(rw.crs, w.windDir, Math.max(w.windKt, w.gustKt ?? 0));
    const remain = Math.max(0, sim.durationS - sim.t);
    const tsas = [...sim.tsaOn];
    const arr = sim.aircraft.filter((a) => a.kind === 'arr').length;
    const wd = (w.windDir - sim.pack.meta.magVar + 360) % 360;
    this.els.info.innerHTML = `
      <div class="metar mono">${esc(w.raw)}</div>
      <div class="info-grid">
        <div class="dial"><svg viewBox="-30 -30 60 60" aria-label="Wind ${Math.round(wd)} degrees ${w.windKt} knots"><circle r="26" class="ring"/><line x1="0" y1="-26" x2="0" y2="26" class="rwy" transform="rotate(${rw.crs})"/><g transform="rotate(${w.windDir})"><line x1="0" y1="-26" x2="0" y2="-8" class="arrow"/><path d="M0 -6 L-4 -13 L4 -13 Z" class="arrowhead"/></g></svg></div>
        <dl>
          <dt>Wind</dt><dd class="mono">${String(Math.round(wd / 10) * 10).padStart(3, '0')}/${w.windKt}${w.gustKt ? 'G' + w.gustKt : ''}</dd>
          <dt>${c.head >= 0 ? 'Head' : 'Tail'}/X</dt><dd class="mono ${c.head < -5 || Math.abs(c.cross) > 15 ? 'bad' : ''}">${Math.abs(c.head)}/${Math.abs(c.cross)}</dd>
          <dt>QNH · TL</dt><dd class="mono">${w.qnh} · FL${String(sim.tl).padStart(3, '0')}</dd>
          <dt>Runway</dt><dd class="mono">${sim.runway}${sim.ilsOut.has(sim.runway) ? ' <span class="bad">ILS U/S</span>' : ''}</dd>
          ${sim.lvp ? `<dt>LVP</dt><dd class="bad">in force</dd>` : ''}
          ${tsas.length ? `<dt>TSA</dt><dd class="warn">${tsas.join(', ')} active</dd>` : ''}
          ${sim.flows.length ? `<dt>Flow</dt><dd class="warn">${sim.flows.map((f) => `${f.exitFix} ${f.mit} NM MIT`).join(', ')}</dd>` : ''}
          <dt>Traffic</dt><dd class="mono">${sim.landings.length} landed · ${arr} inbound</dd>
          <dt>Left</dt><dd class="mono">${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, '0')}</dd>
        </dl>
      </div>`;
  }
  private renderAman() {
    const sim = this.sim;
    this.els.amanRwy.textContent = sim.runway;
    const arr = sim.aircraft.filter((a) => a.kind === 'arr' && a.state !== 'unconcerned').map((a) => ({ a, eta: sim.eta(a) })).sort((x, y) => x.eta - y.eta);
    const span = 30;
    let prev: { a: Aircraft; eta: number } | undefined;
    const items: string[] = [];
    for (let m = 0; m <= span; m += 5) items.push(`<div class="tick" style="top:${(m / span) * 100}%"><span>${sim.utc(sim.t + m * 60).slice(0, 5)}</span></div>`);
    const hpx = Math.max(200, this.els.aman.clientHeight || 400);
    let lastTop = -100;
    for (const x of arr) {
      let adv = 0;
      if (prev) {
        const need = (Math.max(wakeMinNm(prev.a.perf.recat, x.a.perf.recat, 3), sim.lvp ? 5 : 3) / 150) * 60 + 0.15;
        adv = Math.max(0, prev.eta + need - x.eta);
        x.eta = Math.max(x.eta, prev.eta + need);
      }
      prev = x;
      if (x.eta > span) continue;
      let topPx = (x.eta / span) * hpx;
      topPx = Math.max(topPx, lastTop + 24);
      lastTop = topPx;
      const top = (topPx / hpx) * 100;
      const sel = x.a.cs === this.cs ? 'sel' : '';
      items.push(`<button class="aman-item strip ${sel} ${x.a.emergency ? 'emer' : ''}" data-cs="${x.a.cs}" style="top:${top}%"><b>${x.a.cs}</b><span>${x.a.perf.recat}${adv >= 0.5 ? ` <em>−${adv.toFixed(adv >= 2 ? 0 : 1)}</em>` : ''}</span></button>`);
    }
    this.els.aman.innerHTML = `<div class="aman-line"></div>${items.join('')}`;
  }
  private renderStrips() {
    const sim = this.sim;
    const order = (a: Aircraft) => (a.emergency ? -1000 : 0) + (a.kind === 'arr' ? sim.eta(a) : a.kind === 'dep' ? 100 : 200);
    const list = sim.aircraft.filter((a) => a.state !== 'unconcerned').sort((a, b) => order(a) - order(b));
    this.els.strips.innerHTML = list.map((a) => {
      const hdg = a.mode === 'HDG' && a.hdgAssigned !== undefined ? `H${String(Math.round(norm360(a.hdgAssigned - sim.pack.meta.magVar)) || 360).padStart(3, '0')}` : a.mode === 'HOLD' ? 'HOLD' : a.mode === 'LOC' ? 'LOC' : a.route[0]?.fix ?? '';
      const spd = a.spdAssigned ? `S${a.spdAssigned}` : a.spdMin ? 'SMIN' : '';
      const app = a.app ? `${a.app.type} ${a.app.rwy.id}` : '';
      const waiting = a.awaitingSince !== undefined && sim.t >= a.awaitingSince;
      return `<button class="strip ${a.kind} ${a.cs === this.cs ? 'sel' : ''} ${a.state} ${a.emergency ? 'emer' : ''} ${waiting ? 'calling' : ''}" data-cs="${a.cs}">
        <span class="s-cs mono">${a.cs}${a.formation > 1 ? `×${a.formation}` : ''}</span><span class="s-ty mono">${a.type}/${a.perf.wake}</span>
        <span class="s-pr mono">${esc(a.proc ?? a.rules)}</span><span class="s-cfl mono">${levelText(a.cleared).replace(' ft', '')}</span>
        <span class="s-hd mono">${hdg}</span><span class="s-sp mono">${spd}</span><span class="s-ap mono">${app}</span>
        ${a.request ? `<span class="s-req">REQ ${esc(a.request.text)}</span>` : ''}${a.emergency ? `<span class="s-req emer">${a.sqk}</span>` : ''}
      </button>`;
    }).join('') || '<div class="empty">No traffic yet</div>';
  }
}
