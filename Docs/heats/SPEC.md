# Heat now / next – specification (D-29, C-53 to C-55)

## Purpose
Heats are shown on a DanS display run by a colleague. The operator needs to know which heat is on the floor and which one comes next. The app tells them. Nothing from this reaches the projection.

## What DanS offers (read on the venue DanS, 2026-11-22)
- No "current heat" field anywhere (API or database).
- `/competitions`: per round dance `completed_at` (set once every judge has submitted that dance); per round judge `round_dance` (the dance the judge's tablet is on, unverified how early it moves) and `assessment_state`.
- `/rounds/{r}/draw/competitors`: who dances in which heat, per dance (`competitors[].dances[i].heat`, i = dance order over all the round's dances).
- `/rounds/{r}/marks`: every mark of the round in one answer, no timestamps.
  - `target.Competitor {round_dance_id, judge, competitor_id}` with value `{Cross: true}`, `{Cross: false}` (taken back) or `"Empty"`.
  - `target.DanceCompletion {round_dance_id, judge}`: the judge has submitted the dance.
  - `target.RoundCompletion {judge}`.

## How the position is found (`app/src/main/heattrack.js`)
- Position = dance (in dance order, suppressed dances left out) + heat.
- **Quorum** = a third of the round's judges, at least 2.
- Evidence, each meaning "at least here":
  1. The first dance DanS has not finished → heat 1 of it.
  2. A quorum of judges submitted dance d → heat 1 of dance d+1.
  3. A quorum of judges' tablets on dance d → heat 1 of dance d.
  4. The latest heat (in dance order) where a quorum of judges have at least one counting cross.
- The furthest evidence so far is kept and **never goes back**.
- **Next heat / Back** set the position by hand. It holds until the evidence moves past what it was at that moment. Then the later of the two wins.
- **Follow the judges' marks** can be switched off per round: only Next heat / Back move it then.
- Marks count only when read in automatic mode within the last 30 s.

## Window
- **Heats** tab, one card per running round (current round of a competition whose round state counts as running):
  - **Now** and **Next** in large type with the start numbers ("End of the round" after the last heat);
  - ◀ Back, **Next heat ▶**, Follow the judges' marks, and where the position comes from ("From DanS: 3 of 9 judges have crossed in it", "Set by you", "Start of the round");
  - every dance as a column with its heats: number of judges who crossed there ("3/9"), "crossing now: n" (judges who crossed there in the last 20 s), the numbers, done / now / next.
- Clicker keys on the Heats tab: Page Down / → = Next heat, Page Up / ← = Back, for the highlighted round (click a card to highlight it).
- Side-panel floor boxes: "R heat 1/2 · next heat 2" under a running competition on that side.
- Marks are confidential until the results are out: the window shows counts only, never who crossed whom.

## Reading DanS
- Automatic mode only: per running round, the marks on every poll (1 GET per round every 2 s) and the draw once.
- On demand / Manual: no marks. Finished dances (at the last read) and Next heat / Back still work.

## Heat log
- Automatic mode: `heatlog/<YYYY-MM-DD>.jsonl` in the app's data folder (`%APPDATA%\dance-projector`).
- One line per poll in which a running round changed. Each line has: time, competition, round, the marks changed or removed (judge, dance, heat, number, value), the submissions, the tablets (`letter:dance:state`), and now / next with the reason.
- `node scripts/heatlog.js <file> [competition]` prints a timeline.
- Real start numbers: never commit it.
