# Training (2.0): the academy

This note says how a real approach rating is taught, what the 1.0 lessons did, where they fell short, and what the 2.0 academy is: two curricula (Liège and Düsseldorf) on one coach, an instructor voice, a mistake replay, and a drill of the day. Files: `src/ui/tutorial.ts` (the coach, the exam runner, the instructor replay, the drill pick), `src/ui/lessons/kit.ts` (the lesson-authoring kit), `src/ui/lessons/eblg.ts` and `src/ui/lessons/eddl.ts` (the lessons, with their geometry), `tests/tutorial.test.ts` (every lesson flown through the engine) and `tests/tutorial-walk.mjs` (every lesson walked through the real phone UI).

## 1. How an approach rating is really taught

A trainee at an approach unit goes through four things, in this order, and keeps cycling through the last three:

1. **Theory.** Airspace, the procedures of the unit (STARs, transitions, SIDs, holds, the letters of agreement with the centre), separation minima, wake categories, phraseology. Taught in a classroom, examined on paper.
2. **Simulator runs with an instructor.** Scripted exercises on a radar simulator, each built around one skill: descend a single arrival, vector one onto the ILS, sequence two, add a departure, add a hold. The instructor sits beside the trainee, points at the scope and the strip, and says *why*: "you want it at 3,000 ft by the fix because the transition starts there and the ILS captures from below". The exercise ends in a debrief: what went wrong, what the instructor would have done, and the same exercise again if needed.
3. **On-the-job training (OJT) with a mentor.** Live traffic, a rated controller plugged in beside the trainee with the override key. The mentor talks less and watches more; the trainee learns judgement: when to turn base, when to hold, which of three calls to answer first.
4. **The checkride.** A graded live session with an examiner, against the ICAO controller competencies (separation, situational awareness, traffic management, communication, coordination, workload, non-routine situations, procedures). Pass and you are rated on the position; fail and you go back to OJT on the weak competency.

What makes this work is not the content, which any manual has, but the loop: an exercise with one aim, an instructor who explains the reasoning at the moment it matters, a debrief that replays the mistake, and repetition targeted at the weak skill.

## 2. What 1.0 did

Eleven scripted lessons in the real sim: the scope, first contact, turns, descent planning, vectors to the ILS, separation, transitions and the hold, wake spacing, departures and releases, safety nets and a MAYDAY, the full position. Each lesson is a scenario with a coach card that pauses the clock, points at the control to use (the DOM hook mechanics: `data-a`, `data-e`, `data-p`, `data-pick`, `.sg` chips, `data-rel`, `.strip`) and waits until the student has done it; each ends in a short exam without the coach, judged from the sim, PASS or RETRY with one line of why and up to three stars. Every lesson is flown by the test-suite through the engine and walked through the phone UI.

## 3. What was weak

- **A newcomer still did not know what to look at first.** Lesson 1 taught the rings, the fixes and the label; nothing taught the scan: who is calling, what was last said, what each aircraft is doing, where the sequence is. The student learned the parts of the picture, not how a controller reads it.
- **The lessons taught controls more than judgement.** "Tap LVL, then FL070" teaches where the button is. The reasoning behind the number was in the exam rule, not in the coach's mouth.
- **No Düsseldorf**, and the lesson text had Liège baked in: "Brussels", "ALHUV", "22L", "119.280".
- **No spaced repetition.** The lesson list was a ladder climbed once; nothing sent the player back to the skill the debriefs kept marking down.
- **No "why did that go wrong" loop.** RETRY said what failed in one line and offered the exam again. A trainee in a real debrief would watch the instructor fly the same traffic.
- **The 2.0 commands module** (the attention queue, the command halo, the command line, the readback cards, staging) was not taught at all.

## 4. The 2.0 academy

### 4.1 Three stages per airport

Every airport has a curriculum of three stages. A lesson carries its `icao` and its `stage`; the menu shows the curriculum of the selected airport (`lessonsFor(icao)`); `LESSONS` stays the Liège list for existing callers.

| Stage | What it teaches | Liège (15) | Düsseldorf (10) |
|---|---|---|---|
| **Basics**: the picture and the console | The scan (who is calling, what was said, what each one is doing, where the sequence is), strips, labels, the scope, the radio; the commands module: attention queue, halo, readback cards, command line, staging | `scope`, `contact`, `turns`, `halo`, `queue`, `cmdline` | `eddl-picture`, `eddl-contact` (the console lessons are shared mechanics; Düsseldorf reuses them on its own traffic) |
| **Procedures**: the book of the unit | STARs and transitions, holds, SIDs and releases, coordination with the centre, runway change. Düsseldorf adds the IAF-per-direction structure, holds at the IAFs and on the downwind, the 5,000 ft transition altitude, parallel operations (northern runway lands, southern departs), the Langen sectors, the night curfew | `descent`, `transitions`, `departures`, `runway` | `eddl-transitions`, `eddl-stack`, `eddl-departures`, `eddl-parallel`, `eddl-runway05` |
| **Judgement**: the OJT stage | Sequencing with wake, vectoring to final, conflicts and the safety nets, emergencies, a long mixed session | `vectors`, `separation`, `spacing`, `safety`, `position` | `eddl-sequence`, `eddl-emergency`, `eddl-rush` |

Each lesson: 3 to 10 steps with the coach pointing at the real control (the coach, the DOM hooks and the pause-and-point mechanics are the 1.0 ones, unchanged), a short exam without the coach, three stars. Theory lives in `ask` questions inside the steps and in quiz exams where the theory is the point (the picture lessons).

### 4.2 Instructor voice

The coach explains why, the way an OJT instructor does, at the moment the number matters: not "tap LVL, then 3,000" but "3,000 ft, because the transition starts at 3,000 ft at LIBVA and the ILS captures the glidepath from below; higher and it captures a false lobe or goes around". Each rewritten step carries the reason in the body, and the exam rules say what a rated controller would have done. The banned-word and em-dash rules of the project apply to every string (tested).

### 4.3 Pack-aware lessons

Unit names, frequencies, fixes and runways come from the sim: `sim.appCallsign`, `sim.pack.meta.appFreq`, `sim.acc.say`, `sim.twr.say`, `sim.stackFix`, `sim.runway`, `sim.depRunway`, `sim.tl`. The kit gives the lesson authors `acc(g)`, `twr(g)`, `app(g)`, `freq(g)`, `stack(g)`, `rwy(g)` so the text reads "Brussels" at Liège and "Langen" at Düsseldorf. Lesson geometry (spawn positions, callsigns, STARs, the transition names on the chips) is per airport, in `src/ui/lessons/eblg.ts` and `src/ui/lessons/eddl.ts`; the shared mechanics (the coach, the exam runner, the step helpers, the chip and picker flows) are in `src/ui/tutorial.ts` and `src/ui/lessons/kit.ts`.

### 4.4 Mistake replay: "watch what the instructor would have done"

After an exam that fails, the debrief offers **Watch the instructor**. The coach then:

1. runs the exam scenario offline with the instructor (`ex.solution`, a scripted controller written per lesson, or, where none is given, the best of the engine's scripted controllers in `src/engine/career.ts` (`chipControl`, `autoControl`), judged by the same exam judge), chunked so the page stays responsive;
2. reloads the exam in the live console and replays the instructor's clearances at their times, so the student sees the real labels, readbacks, ticker and strips, with the student's own transmissions vetoed ("The instructor has the frequency");
3. narrates each clearance as it goes out: the words, and the reason (the suggestion chip's `why` when the clearance matches one, or the reason the scripted solution gives);
4. ends with the instructor's verdict ("The instructor: PASS, 3 stars: ...") and offers Retry exam.

The test-suite runs every instructor offline and requires a pass, so a lesson cannot ship with an exam its own instructor cannot pass.

### 4.5 Spaced practice: the drill of the day

`drillOfTheDay(icao)` returns the lesson that trains the player's weakest competency, with a two-line reason. The weakest competency is the lowest mean rating over the last twelve logged sessions at that airport (`loadRecords(icao)` in `src/store.ts`, read only), broken by exam stars (the lesson with the fewest stars among those tagged with the competency wins); with no sessions yet, the first lesson not yet passed in curriculum order. Each lesson is tagged with the competencies it trains (`comps`). The menu shows the pick with its reason (see section 6).

### 4.6 The commands module lessons

The lessons that teach the halo turn it on (`g.halo.enabled = true`, it defaults off in tutorial scenarios so the older lessons keep their geometry), and the Düsseldorf basics turn it on from the start, because by then the student has met it. The attention queue is taught as what a controller's strip bay is for: what is owed to whom, oldest first. Readback cards are taught with a forced wrong readback. The command line and staging are taught on a phone too (the ⌨ button), because the walk runs on a phone.

## 5. The curricula

### Liège (EBLG), position Liège Approach 119.280, runway 22L

| # | Stage | Id | Title | Exam |
|---|---|---|---|---|
| 1 | Basics | `scope` | The picture | Read the scope (quiz) |
| 2 | Basics | `contact` | First contact | Three on frequency |
| 3 | Basics | `turns` | Turns | Two gates |
| 4 | Basics | `halo` | The command halo | Quick hands |
| 5 | Basics | `queue` | The attention queue and readback cards | A busy minute |
| 6 | Basics | `cmdline` | Command line and staging | Four check-ins |
| 7 | Procedures | `descent` | Descent planning | Down from FL090 |
| 8 | Procedures | `transitions` | Transitions and the hold | Three for one runway |
| 9 | Procedures | `departures` | Departures and releases | Two departures, one arrival |
| 10 | Procedures | `runway` | Coordination and the runway change | Wind shift |
| 11 | Judgement | `vectors` | Vectors to the ILS | From the other side |
| 12 | Judgement | `separation` | Separation | Two converging pairs |
| 13 | Judgement | `spacing` | Wake spacing with speed | Two gaps |
| 14 | Judgement | `safety` | Safety nets and emergencies | Checkride |
| 15 | Judgement | `position` | The full position | Half a shift |

### Düsseldorf (EDDL), position Langen Radar 128.555, runways 23L/23R (05R/05L)

| # | Stage | Id | Title | Exam |
|---|---|---|---|---|
| 1 | Basics | `eddl-picture` | The Düsseldorf picture | Read the scope (quiz) |
| 2 | Basics | `eddl-contact` | First contact at Langen | Three on frequency |
| 3 | Procedures | `eddl-transitions` | The RNAV transitions | BIKMU to REGNO |
| 4 | Procedures | `eddl-stack` | Holding at the entry fixes | Two into one |
| 5 | Procedures | `eddl-departures` | Departures to Langen | The 06:00 departures |
| 6 | Procedures | `eddl-parallel` | Parallel runways | North lands, south departs |
| 7 | Procedures | `eddl-runway05` | Runway 05 | Turn the airport round |
| 8 | Judgement | `eddl-sequence` | Sequencing onto 23R | Four from three fixes |
| 9 | Judgement | `eddl-emergency` | Safety nets at Langen | The diversion |
| 10 | Judgement | `eddl-rush` | The 06:00 rush | The first wave |

The Düsseldorf facts the lessons teach come from `src/pack/eddl.ts` and `docs/REALISM-EDDL.md`: the transition entry fixes BIKMU, DOMUX, HALME, PISAP and LMA, each with a transition per runway direction (`BIKMU23` to REGNO for 23R, `DOMUX23` to METMA for 23L, `BIKMU05` to DIKMI for 05L, `DOMUX05` to NATOS for 05R), 220 kt from the first speed point, 3,000 ft at the final approach fix 8.8 NM out; the transition altitude 5,000 ft and the transition level by QNH (FL060 at 1013 hPa and above, FL070 from 977); the downwind holds DL429 and DL409 (23) and DL524 and DL503 (05), 4,000 ft to FL070, and the en-route holds at DOMEG, NVO and ELDAR; departures remaining with Tower to 2,000 ft then calling Langen Radar 121.355 (in this sector the departure position is combined with the player's), the 5,000 ft initial climb on every SID, the FL100 transfer to the Bottrop sector (Langen Radar 119.110); dependent parallel operations, the northern runway landing and the southern departing, 2.5 NM between alternating approaches inside 10 NM; the night curfew 22:00 to 06:00 local and the 06:00 wave. Where the engine does not yet model a fact (parallel runway configurations are set by the lesson with `sim.depRunway`, not from the pack's `parallelOps`), the lesson says so in `docs/TRAINING.md` section 7 and the GAMEPLAY track owns the fix.

## 6. What the menu must change (CONSOLE owns `src/ui/menu.ts` and `src/main.ts`)

1. `renderTutorial` lists `lessonsFor(getActiveAirport())` instead of `LESSONS`, grouped by `stage` with the three stage headings (Basics, Procedures, Judgement) and the stage's one-line blurb (`STAGES` export). Numbering is the index within the curriculum. The home strip shows `tutorialDone()` counted against the active curriculum.
2. `startLesson` takes a lesson **id**, not an index: `main.ts` `lesson(id)` finds it with `lessonById(id)`, calls `setAirport(l.icao)`, and `next` is the following lesson in `lessonsFor(l.icao)`. `window.__lgg.lesson(i)` may stay for the walk (it is also given `__lggTut.start(id)` by the tutorial module).
3. A **Drill of the day** strip above the list: `const d = drillOfTheDay(icao)`; show `d.lesson.title`, the two `d.reason` lines and the competency name (`COMP_PLAIN[d.comp]`); tapping starts the lesson at its exam (`startLesson(d.lesson.id, { exam: true })`; `coachFor(lesson, nav, { toExam: true })` supports this).
4. The airport switcher on the tutorial page (the same control free play uses) so the two curricula are one tap apart.

## 7. Unfinished and known limits

- Parallel runway operations: the pack's `parallelOps` is not yet a `runwayConfig`, so the Düsseldorf parallel lessons set `sim.depRunway = '23L'` on entry. When GAMEPLAY wires `parallelOps` into `runwayConfigs`, the override becomes a no-op.
- The engine binds each transition to one runway; with 23L alone in use the lead chip for a BIKMU arrival is the DOMUX transition. The Düsseldorf arrival lessons therefore run 23R (parallel operations) for the north and west flows and 23L for the DOMUX flow; `eddl-runway05` runs 05L.
- The mistake replay narrates the chip's `why` when the instructor's clearance matches a suggestion; a clearance with no matching chip is narrated with its words only.
- The drill of the day reads the records; it does not write anything and does not schedule reminders.
- Voice (push to talk) is described in `position` but not exercised by the walk (headless Chromium has no recogniser).
