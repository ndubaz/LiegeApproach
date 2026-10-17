import { describe, expect, it } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import { LESSONS } from '../src/ui/tutorial';
import { attentionRows } from '../src/ui/commands/attention';
import { stackFixOf } from '../src/ui/commands/halo';

// The 2.0 commands module: the pure parts (the attention queue's order and actions) flown through the engine.
const pack = loadPack(EBLG);
const L = (id: string) => LESSONS.find((l) => l.id === id)!;
const calling = (sim: Sim, cs: string) => { const a = sim.find(cs); return !!a && a.state === 'assumed' && a.awaitingSince !== undefined && sim.t >= a.awaitingSince; };
const until = (sim: Sim, f: () => boolean, max = 3000) => { for (let k = 0; k < max && !f(); k++) sim.step(); expect(f()).toBe(true); };

describe('attention queue', () => {
  it('a check-in is a row with the waiting time and a one-tap action', () => {
    const sim = new Sim(pack, L('contact').scenario);
    until(sim, () => calling(sim, 'QTR8125'));
    for (let k = 0; k < 12; k++) sim.step();
    const rows = attentionRows(sim);
    expect(rows[0].cs).toBe('QTR8125');
    expect(rows[0].kind).toBe('call');
    expect(rows[0].waitS).toBeGreaterThanOrEqual(12);
    expect(rows[0].action).toBeDefined();
    expect(rows[0].action!.items.length).toBeGreaterThan(0);
    // the action is a safe clearance: the sim accepts it
    const r = sim.issue({ cs: 'QTR8125', items: rows[0].action!.items });
    expect(r.ok).toBe(true);
    // answered: the row is gone while the readback is due
    expect(attentionRows(sim).some((x) => x.cs === 'QTR8125')).toBe(false);
  });

  it('the oldest caller comes first and the queue never lists an aircraft twice', () => {
    const sim = new Sim(pack, L('contact').exam!.scenario!);
    until(sim, () => calling(sim, 'QTR8125') && calling(sim, 'AZG7321'));
    const rows = attentionRows(sim);
    expect(rows[0].cs).toBe('QTR8125');
    expect(new Set(rows.map((r) => r.cs)).size).toBe(rows.length);
    expect(rows.map((r) => r.urgency)).toEqual([...rows.map((r) => r.urgency)].sort((a, b) => b - a));
  });

  it('a wrong readback outranks a call and carries the correction', () => {
    const sim = new Sim(pack, L('safety').scenario);
    until(sim, () => calling(sim, 'ETH3721'));
    sim.forceWrong.add('ETH3721');
    sim.issue({ cs: 'ETH3721', items: [{ k: 'lvl', lvl: { fl: 60 } }] });
    until(sim, () => !!sim.find('ETH3721')?.wrong && !sim.readbackPending('ETH3721'), 60);
    const rows = attentionRows(sim);
    expect(rows[0].kind).toBe('wrong');
    expect(rows[0].cs).toBe('ETH3721');
    expect(rows[0].action!.items).toEqual([{ k: 'lvl', lvl: { fl: 60 } }]);
    expect(rows[0].action!.label).toContain('FL060');
    // sending the correction clears it
    sim.issue({ cs: 'ETH3721', items: rows[0].action!.items });
    expect(sim.events.some((e) => e.kind === 'readback_caught')).toBe(true);
  });

  it('a Tower release request is a row with release advice as its action', () => {
    const sim = new Sim(pack, L('departures').scenario);
    until(sim, () => sim.releases.some((r) => r.state === 'pending'));
    const row = attentionRows(sim).find((r) => r.kind === 'release');
    expect(row).toBeDefined();
    expect(row!.cs).toBe('CHG7302');
    expect(row!.action!.icom).toBe(true);
    expect(['rel', 'relhold']).toContain(row!.action!.items[0].k);
    expect(sim.issue({ cs: row!.cs, items: row!.action!.items }).ok).toBe(true);
  });

  it('an established arrival is due for Tower, with the Tower chip as its action', () => {
    const sim = new Sim(pack, L('spacing').scenario);
    until(sim, () => calling(sim, 'CLX7HK'));
    sim.issue({ cs: 'CLX7HK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }] });
    until(sim, () => !!sim.find('CLX7HK')?.app?.locCap && sim.dthr(sim.find('CLX7HK')!) < 13 && !sim.readbackPending('CLX7HK'));
    const row = attentionRows(sim).find((r) => r.cs === 'CLX7HK');
    expect(row).toBeDefined();
    expect(row!.reason).toMatch(/Tower/);
    expect(row!.action?.items.some((i) => i.k === 'xfr' && i.unit === 'TWR')).toBe(true);
  });

  it('the stack fix comes from the pack when set, ALHUV otherwise', () => {
    const sim = new Sim(pack, L('contact').scenario);
    expect(stackFixOf(sim)).toBe((pack as any).stackFix ?? 'ALHUV');
  });
});
