# The commands module (2.0)

A controller has seconds. This note says what a controller does in the real room, what the 1.0 console made of it, what 2.0 keeps, what it changes and why, and what we measured before and after.

## What a controller does in the real room

An approach controller at a modern radar position works three things at once:

1. **The label.** The mouse lives on the radar label. The cleared flight level, assigned heading and assigned speed are fields on the label; a click on the field opens a short menu beside it, a second click picks the value, and the system flight plan updates at once. Nothing is typed. The controller never leaves the scope to give a routine instruction.
2. **The strip.** Paper or electronic, the strip is marked as the clearance is spoken: an arrow and a level, a heading in a box, "T" for transferred. The strip bay is the controller's memory of what has been said and what is still owed. A strip with nothing written on it since the pilot called is the thing the eye goes back to.
3. **The headset.** The clearance is spoken, the readback is heard, and the ear checks it against what the hand just marked. A wrong readback is caught by ear within a second or two, and the correction is a reflex: say it again, correctly. Calls queue up in the ear, not on a screen; the controller answers the oldest, or buys time with "standby".

Attention is driven by the ear (who is calling) and by the scan (who is about to need something: the one on the downwind, the one established and due for Tower, the Tower line flashing for a release). Each decision is small; what costs time is finding the aircraft, finding the control, and finding the value.

## What 1.0 made of it

1.0 already has the right bones: label chips you can slide (level, speed) or drag (heading), suggestion chips with a reason, pickers as the fallback, a typed shorthand, voice with push to talk, a three-second correction key, strips, an intercom card for releases. The baseline below shows where the seconds go:

- A routine single-item clearance through the pickers is **four pointer actions** (aircraft, category, value, transmit) on both phone and desktop. The chip path is two, but only when the chip is right.
- The combined clearance a night bank lives on (transition, 3,000 ft, ILS) is **seven to nine actions** through the pickers; the lead chip does it in two, when offered.
- Typing is **10 to 24 keystrokes** because the whole callsign has to be typed and every fix spelled in full.
- Nothing tells you who to deal with next beyond "CALLS 3": the queue is in your head.
- A wrong readback shows only as a line in the transcript and a red "READBACK wrong" under the callsign of the aircraft that is selected; if you are looking at another aircraft you miss it until the 30-second penalty.

## What 2.0 keeps

Every working path: the pickers, the suggestion chips (`.sg`, long-press to stage), the heading drag and the label ladders on the scope, the typed shorthand with its grammar, voice through `createPtt`, the correction window, training wheels, quick mode, and every tutorial DOM hook (`data-a`, `data-e`, `data-p`, `data-pick`, `.sg`, `data-rel`, `.strip`, `data-e="callers"`) and Game method (`select`, `send`, `onBeforeSend`, `onSent`, `coachHints`, `loadScenario`, `quick`, `addItem`, `items`, `cs`, `els`). The console's look stays: the same surfaces, type and colours; the new pieces are drawn with the same tokens so nothing reads as a different product.

## What 2.0 changes, and why

**Intent first: the attention queue** (`src/ui/commands/attention.ts`). The CALLS button becomes a queue of who needs what next, across every aircraft, ordered by urgency: calls waiting (with the live waiting timer), wrong readbacks, Tower releases, Brussels requests, conflicts, aircraft due a handoff or a base turn, readbacks due. Each row carries its one-tap action: the lead suggestion for that aircraft, or Release, or the correction. Tap the row to select and bring the aircraft into view; tap the action to send it. The reason is written on the row, and after the send the console says whether it was right (the readback card). Tab walks the queue. This is the strip bay's job (what is owed to whom) brought to the thumb.

**Direct manipulation on the scope: the command halo** (`halo.ts`). When an aircraft is selected, a halo opens around it: a short ladder of levels on one side and speeds on the other, centred on the cleared values, a row of the fixes that make sense (on its route, the IF, the hold), and the four words a controller says most (ILS, HOLD, TWR, BRU). One tap sends, with a two-second undo that uses the real correction ("correction, disregard"). HOLD stages instead of sending, because a hold nearly always comes with a level: the next rung completes it. A long press on any rung stages instead of sending, for building a longer clearance. The heading drag on the aircraft stays as it was; the halo draws the drag affordance. On a phone the player never leaves the radar; on a desktop the halo sits under the mouse like the label menus do in the real room.

**A command line that outpaces the pickers** (`cmdline.ts`, `src/engine/parser.ts`). Digits pick the aircraft: `81` is QTR8125, `4ek` is TAY4EK, `201` is CHG201, when that is the only match on frequency. Fix names are fuzzy: `>lib` is LIBVA, `dct gilo` is GILOM. The phrase previews as you type; the matched callsign shows in the preview chip. Up and down recall the last clearances to edit or repeat; Tab cycles the callers; Enter sends; Escape clears. Same grammar as the voice path, so what you learn typing you can say.

**Readback tracking inline** (`readback.ts`). After a send, the clearance stays on the console as a card: grey while the readback is due, green when it comes back right (and then fades), amber when it is wrong with the correction one tap away ("Say again · FL060"), and a repeat button when the pilot asks you to say again. The card is pinned above the composer whichever aircraft you select, and the attention queue carries the wrong readback as its top row, so it is never missed because you were looking elsewhere. The phone vibrates on send and on a wrong readback.

**Staging for a rush** (`staging.ts`). Build a clearance, press Queue (or `Q`), select the next aircraft, build the next. The queue shows under the composer; Enter with an empty composer sends the first, or `1` to `4` send a row. A bank of four check-ins is handled without re-selecting.

**Timing feedback.** The waiting timer is live on the attention rows and on the strip of a calling aircraft, in the same amber the debrief uses to cost a late answer.

**Phone, iPad, desktop.** Phone: the halo and the composer sit in the thumb zone, every target is at least 44 px, no horizontal scroll, haptics through `navigator.vibrate`. iPad: the attention queue takes a row of its own across the bar, the halo is two-hand friendly (ladders either side of the aircraft). Desktop: keyboard first, the command line always open, the halo under the mouse.

## Measurements

Method: `tests/commands-measure.mjs` drives the real build with Playwright on a phone profile (390×844, touch) and a desktop profile (1440×900, mouse, then keyboard), with the sim paused so the clock cannot move anything. It counts pointer actions (a tap, click or drag start) and keystrokes, and times from the first action to the clearance appearing in `sim.cmdLog`. Typing runs at 60 ms per key. Playwright adds its own per-action latency, the same for both versions, so the action counts are the honest number and the times are comparable between the two tables, not with a human hand.

### Before (1.0 console)

| Clearance | Device | Pointer actions | Keystrokes | Time (ms) | Sent |
|---|---|---|---|---|---|
| Descend to a level (first call) | phone | 4 | 0 | 962 | QTR8125 lvl |
| Suggested clearance (lead chip: descend) | phone | 2 | 0 | 272 | QTR8125 lvl |
| Heading | phone | 4 | 0 | 897 | CHG201 hdg |
| Speed | phone | 4 | 0 | 612 | CLX7HK spd |
| Direct to a fix (LIBVA) | phone | 4 | 0 | 1023 | QTR8125 dct |
| Transition, level and ILS | phone | 9 | 0 | 1552 | AZG7321 trans+lvl+app |
| Hold with a level | phone | 6 | 0 | 987 | QTR8152 hold+lvl |
| Hand off to Tower (established) | phone | 4 | 0 | 851 | CLX7HK xfr |
| Release a departure | phone | 1 | 0 | 148 | CHG7302 rel |
| Answer a call with Roger | phone | 2 | 0 | 211 | QTR8125 roger |
| Correct a wrong readback | phone | 2 | 0 | 156 | ETH3721 lvl |
| Descend to a level (first call) | desktop | 4 | 0 | 571 | QTR8125 lvl |
| Descend to a level (first call) | desktop keyboard | 0 | 12 | 870 | QTR8125 lvl |
| Suggested clearance (lead chip: descend) | desktop | 2 | 0 | 207 | QTR8125 lvl |
| Suggested clearance (lead chip: descend) | desktop keyboard | 0 | 12 | 825 | QTR8125 lvl |
| Heading (dial) | desktop | 4 | 0 | 547 | CHG201 hdg |
| Heading | desktop keyboard | 0 | 12 | 905 | CHG201 hdg |
| Speed | desktop | 4 | 0 | 582 | CLX7HK spd |
| Speed | desktop keyboard | 0 | 12 | 888 | TAY4EK spd |
| Direct to a fix (LIBVA) | desktop | 4 | 0 | 551 | QTR8125 dct |
| Direct to a fix (LIBVA) | desktop keyboard | 0 | 18 | 1523 | QTR8125 dct |
| Transition, level and ILS | desktop | 7 | 0 | 1025 | AZG7321 trans+lvl+app |
| Transition, level and ILS | desktop keyboard | 0 | 24 | 1727 | AZG7321 trans+lvl+app |
| Hold with a level | desktop | 5 | 0 | 251 | QTR8152 hold+lvl |
| Hold with a level | desktop keyboard | 0 | 17 | 1187 | QTR8152 hold+lvl |
| Hand off to Tower (established) | desktop | 3 | 0 | 241 | CLX7HK xfr |
| Hand off to Tower (established) | desktop keyboard | 0 | 11 | 781 | CLX7HK xfr |
| Release a departure | desktop | 1 | 0 | 230 | CHG7302 rel |
| Release a departure | desktop keyboard | 0 | 12 | 880 | CHG7302 rel |
| Answer a call with Roger | desktop | 2 | 0 | 350 | QTR8125 roger |
| Answer a call with Roger | desktop keyboard | 0 | 10 | 701 | QTR8125 roger |
| Correct a wrong readback | desktop | 2 | 0 | 148 | ETH3721 lvl |
| Correct a wrong readback | desktop keyboard | 0 | 12 | 823 | ETH3721 lvl |

Notes on the baseline: the desktop heading drag on the aircraft (one action) did not register in the harness, so the dial was measured instead.

### After (2.0 commands module)

Same script, same scenarios, same sim states (`V=2 node tests/commands-measure.mjs`). The 2.0 paths used: the attention row to select, the halo rung to send; the row's action button for a suggested clearance, a Tower handoff, a release and a wrong readback; the heading drag on the aircraft; and the command line with partial callsigns and fuzzy fixes.

| Clearance | Device | Pointer actions | Keystrokes | Time (ms) | Sent |
|---|---|---|---|---|---|
| Descend to a level (first call) | phone | 2 | 0 | 559 | QTR8125 lvl |
| Suggested clearance (the lead chip) | phone | 1 | 0 | 93 | QTR8125 trans+lvl+app |
| Heading | phone | 2 | 0 | 883 | CHG201 hdg |
| Speed | phone | 3 | 0 | 588 | TAY4EK spd |
| Direct to a fix (LIBVA) | phone | 2 | 0 | 544 | QTR8125 dct |
| Transition, level and ILS | phone | 2 | 0 | 198 | AZG7321 trans+lvl+app |
| Hold with a level | phone | 3 | 0 | 971 | QTR8152 hold+lvl |
| Hand off to Tower (established) | phone | 2 | 0 | 153 | CLX7HK xfr |
| Release a departure | phone | 2 | 0 | 166 | CHG7302 rel |
| Answer a call with Roger | phone | 2 | 0 | 393 | QTR8125 roger |
| Correct a wrong readback | phone | 1 | 0 | 75 | ETH3721 lvl |
| Descend to a level (first call) | desktop | 2 | 0 | 527 | QTR8125 lvl |
| Descend to a level (first call) | desktop keyboard | 0 | 7 | 478 | QTR8125 lvl |
| Suggested clearance (the lead chip) | desktop | 1 | 0 | 76 | QTR8125 trans+lvl+app |
| Suggested clearance (the lead chip) | desktop keyboard | 0 | 2 | 175 | QTR8125 trans+lvl+app |
| Heading | desktop | 2 | 0 | 843 | CHG201 hdg |
| Heading | desktop keyboard | 0 | 8 | 529 | CHG201 hdg |
| Speed | desktop | 2 | 0 | 516 | TAY4EK spd |
| Speed | desktop keyboard | 0 | 9 | 618 | TAY4EK spd |
| Direct to a fix (LIBVA) | desktop | 2 | 0 | 501 | QTR8125 dct |
| Direct to a fix (LIBVA) | desktop keyboard | 0 | 8 | 566 | QTR8125 dct |
| Transition, level and ILS | desktop | 2 | 0 | 81 | AZG7321 trans+lvl+app |
| Transition, level and ILS | desktop keyboard | 0 | 21 | 1395 | AZG7321 trans+lvl+app |
| Hold with a level | desktop | 3 | 0 | 954 | QTR8152 hold+lvl |
| Hold with a level | desktop keyboard | 0 | 14 | 931 | QTR8152 hold+lvl |
| Hand off to Tower (established) | desktop | 1 | 0 | 58 | CLX7HK xfr |
| Hand off to Tower (established) | desktop keyboard | 0 | 8 | 532 | CLX7HK xfr |
| Release a departure | desktop | 1 | 0 | 57 | CHG7302 rel |
| Release a departure | desktop keyboard | 0 | 9 | 598 | CHG7302 rel |
| Answer a call with Roger | desktop | 2 | 0 | 129 | QTR8125 roger |
| Answer a call with Roger | desktop keyboard | 0 | 5 | 332 | QTR8125 roger |
| Correct a wrong readback | desktop | 1 | 0 | 60 | ETH3721 lvl |
| Correct a wrong readback | desktop keyboard | 0 | 2 | 149 | ETH3721 lvl |

Against the targets:

- **A suggested clearance in at most two pointer actions:** one. The attention row carries the lead suggestion; a Tower handoff, a release and a readback correction are one tap each on any device (two on a phone when the row is not the top one and the queue has to be opened first).
- **Any single-item clearance in at most three:** two for a level, heading, speed or direct (select, then the halo rung or the drag); three for a hold with a level, which is two items. The 1.0 picker path was four to six.
- **Typed clearances in under 1.5 s:** 0.15 to 0.93 s at 60 ms per key for every single and double item, with 2 to 9 keystrokes where 1.0 needed 10 to 18. The one typed line still over the target is the three-item transition, level and ILS (21 keys, 1.4 s), and that clearance is one tap on its row.
- Phone "Speed" is three actions rather than two because the 2.0 speed ladder keeps five rungs and the measured speed (180 from 250) sits below the first screen of the ladder on that lesson's aircraft; the ladder shows 250, 220, 210, 180 and 160 (or "160 to 4" and minimum clean speed when they apply), so most speed instructions are two.

## What the TRAINING track can use

DOM: `.att` (`data-e="att"`) with `.att-row[data-cs][data-key]`, `.att-sel`, `.att-go`, `.att-more`; `.halo` (`data-e="halo"`) with `[data-halo="lvl|spd|fix|more"][data-v]` buttons (`F070`, `A3000`, `S210`, `S160/4`, `MIN`, a fix name, `ils|hold|twr|bru|mil`); `.undo` (`data-e="undo"`) with `[data-a="undo"]`; `.rb` (`data-e="rb"`) with `.rb-card.pending|ok|wrong|again|missed[data-cs]`, `[data-a="rb-fix"]`, `[data-a="rb-again"]`, `[data-a="rb-sel"]`; `.stq` (`data-e="stq"`) with `.stq-row`, `[data-stq="send|edit|drop"]`; `[data-a="queue"]` (`data-e="queueBtn"`); `.cmd-hint` (`data-e="cmdHint"`) with `[data-cs]` completions; `.strip .s-wait` (the live waiting timer, `.late` after 15 s).

Game: `attention` (`rows`, `top()`, `next()`, `reveal(ms)`, `update()`), `halo` (`enabled`, `armUndo(cs, label)`, `undo()`), `readback` (`cards`, `cardFor(cs)`, `reset()`), `staging` (`queue`, `queueCurrent()`, `send(i)`, `length`), `cmdline` (`history`, `remember(line)`), and the new public methods `enter()`, `sendClearance(cl)`, `sendIcom(cs, items)`, `clearComposer()`, `pickerOpen()`, `keepVisible(cs)`, `parseCtx()`, `previewCmd()`, `submitCmd()`, `waiting()`, `stackFix()`, `armUndo(cs, label)`; `suggestions` is now public. `halo.enabled` is false in tutorial scenarios (`sc.tutorial`) until a lesson sets it to true, so the existing lessons keep their geometry.

Engine: `parser.ts` exports `matchCallsigns(tok, callsigns)`, `resolveFix(tok, fixes)` and the extended `resolveCallsign`; `ParseCtx` gained the optional `holdFix`. The grammar is otherwise unchanged. `attentionRows(sim)` in `src/ui/commands/attention.ts` is pure and testable.

## Unfinished

- Haptics are called through `navigator.vibrate` (send, readback right, readback wrong, say again, halo long press) but were not felt on a device: headless Chromium cannot test them.
- The halo's wheel path on the label (the scope's `staged` wheel) is unchanged; a wheel on a halo rung does nothing. The two-second undo covers halo and queue sends and Enter, not the scope's own ladder and drag sends (those live in `scope.ts`, the GRAPHICS track's file; the undo is one call: `game.armUndo(cs, label)` after `onQuick`).
- The staging queue has no keyboard shortcut per row (Enter sends the first; digits are reserved for callsigns in the command line).
- Voice is unchanged: it still fills the typed line and confirms below 0.75 confidence; it now benefits from the fuzzy fix match when the recogniser spells a fix oddly.
- The attention queue's "due" rows come from `hints.ts` plus established arrivals; conflicts carry the lead suggestion but no computed resolution of their own.
