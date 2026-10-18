import { describe, expect, it } from 'vitest';
import { lessonsFor } from '../src/ui/tutorial';
import { lessonAirport } from '../src/store';

// Career progress counts a lesson for the airport its id names; the id convention must hold for every lesson.
describe('lesson ids', () => {
  it('name their airport', () => {
    for (const icao of ['EBLG', 'EDDL']) for (const l of lessonsFor(icao)) expect(lessonAirport(l.id), l.id).toBe(l.icao);
  });
});
