# DanS knowledge base

What we found out about DanS (DanceSport Services System, https://www.dancesport.services/) by exploring version **0.7.5-beta** (2026-09-24, build `sart-csts`). DanS has no public API documentation; everything below was found by reading the manual, the server binary, the web UI's traffic and the SQLite files.

Status markers: ✅ verified, ⚠️ dangerous, ❓ unverified guess.

---

## 1. Installation and processes

| Item | Value |
|---|---|
| Install folder | `C:\DanS` (portable, unzip and run) |
| Server | `sart.exe`, started by `start.bat` as `sart -l 8686` (default port is 80) |
| Federation connector | `csts.exe`, talks to ČSTS; sart connects to it on `127.0.0.1:8087` |
| Config | `C:\DanS\default.toml` |
| Data | `%APPDATA%\dans\` (SQLite databases) |
| Temporary files and logs | `%LOCALAPPDATA%\dans\` (`sart.<date>.log`, `csts.<date>.log`, PDFs) |
| Version | `sart -V`, or the "Dans" link in the control UI header |

`default.toml` also sets `federation_event_competitors_update_period = 300` (seconds). DanS refreshes competitors from the federation every 5 minutes for linked events. Our scouting events are "Unlinked" (shown as "Odpojeno").

Useful server start options from the manual:

```
sart -l 8686                         listen port
sart --templates "C:\promitani\predlohy\*.html"   display page templates
sart --assets "C:\promitani"          files used inside templates (backgrounds…)
sart -a <dir>                         assets directory (older syntax)
```

Templates are read only at start, so a restart is needed after changing them. Asset files can change at any time.

---

## 2. Web interfaces

| URL | Purpose |
|---|---|
| `/control` | Operator UI (competition processing). **No trailing slash**: `/control/` returns 404. |
| `/device` | Judge tablet app |
| `/display/<url_segment>` | Projection page for a configured display |
| `/display/<url_segment>?slots=2,3` | Only some areas of a multi-area display |

The UIs are Rust compiled to WebAssembly (`/bui.wasm.gzip` + `/bui.js` for control, `/display.wasm.gzip` + `/display.js` for displays).

Control UI routes seen (client-side): `/control/events/own`, `/control/event/competitions`, `/control/event/judges/competitions`, `/control/event/judges/database`, `/control/event/officials`, `/control/event/schedule`, `/control/event/settings/displays`, `/control/configuration/displays`, `/control/configuration/queues`, and more under `/control/configuration/*`.

The current event is chosen per browser: tick the event in **Soutěžní akce**, then press **Otevřít: <event>**. A fresh browser shows "<akce nevybrána>".

---

## 3. REST API

Base: `http://<server>[:port]/api/1`

### 3.1 The one thing you must know ✅

Event-scoped endpoints need the header

```
dans-event: <event id>
```

Without it they answer `404` with `{"messages":{"service":[{"text":"Not found."…}]}}`, which looks like the endpoint doesn't exist.

Also send `accept: application/json` to get JSON. The DanS UI itself uses `application/x-postcard` (Rust `postcard` binary format).

```
curl -H "dans-event: 1f1c9b49-6b36-6e7d-8782-ff36bfb294d1" \
     -H "accept: application/json" \
     http://localhost:8686/api/1/events/1f1c9b49-6b36-6e7d-8782-ff36bfb294d1/judges
```

### 3.2 Response shapes

- Lists: `{ "messages": {}, "paging": {"limit":25,"prev":null,"next":null}, "collection": [ … ] }`. All items came back in one response so far, even past 25 (start list had 238).
- Single object: `{ "messages": {}, "entity": { … } }`.
- Errors: `messages.service[]` with `message_type: "Error"`.
- IDs are UUIDs (v6/v7 style, time-ordered).

### 3.3 Read endpoints ✅ (all GET, all verified harmless)

Global (no header needed):

| Endpoint | Content |
|---|---|
| `/events` | Events on this server. Event id = `authorities[0].event_id`; also `name`, `abbreviation` (e.g. `CS1761`), `location`, `authorities[0].date`, `link` (`Unlinked`/…). |
| `/events?order=%2bnord` | Same, the order the UI uses |
| `/events/available?order=%2bdate` | Events available at the federation for import |
| `/realms`, `/realms/{id}` | Realms: own tenant and the federation (ČSTS) with its capabilities (`ResultDelivery`, `InvigilatorReport`, …) |
| `/displays` | Configured displays (`url_segment`, `state`, `arrangement`) |
| `/queues` | Report queues with the report ids that may go to displays |
| `/devices`, `/printers`, `/folders` | Tablets, printers, folders |
| `/instance`, `/tenants`, `/messages` | Instance info, tenants, UI translations |

With `dans-event` header:

| Endpoint | Content |
|---|---|
| `/competitions` | All competitions of the event, **including `rounds[]`** with `dances[]` and `judges[]` |
| `/events/{e}/judges` | Judges: `person_id`, `label` (letter A, B…), `country`, `registration`, `licences`, `person_display{name, surname, in_authority_id.id}`, **`pin` (tablet PIN, keep secret)** |
| `/events/{e}/judges/active` | Judges currently active |
| `/events/{e}/officials` | Officials (same shape as judges) |
| `/events/{e}/officials/competitions` | **Judge allocation**: `{competition, person, role}` per assignment |
| `/events/{e}/startlist?order=%2bname` | Competitors: `id`, `number`, `club`, `sponsor`, `country`, `people.Persons[]{name, surname, in_authority_id}` (solo) or couples |
| `/events/{e}/startlist/registrations` | Registrations per competition |
| `/events/{e}/rule_violators`, `/events/{e}/rule_violations` | Rule violations |
| `/events/{e}/devices?order=%2Bdescription` | Tablets for the event |
| `/events/{e}/displays` | Displays attached to the event |
| `/rounds/{r}` | One round |
| `/rounds/{r}/draw` | Draw of the round |
| `/rounds/{r}/draw/competitors` | **Heats**: `competitors[]{id, number, dances[]{heat, completion}, completion, ranking}`; `dances[i]` follows the round's dance order |
| `/rounds/{r}/draw/dances` | Draw per dance |
| `/index_age`, `/index_class`, `/index_discipline`, `/index_dance`, `/index_series`, `/index_competitors`, `/index_competition_grade`, `/index_official_role`, `/index_authority` | Lookup tables (`id`, `value`, `abbreviation`, `key`) |

`/rounds/{r}/draw*` sounds like an action, but GET only reads. We compared the database before and after: heats and rounds were identical.

Not found as GET: `/events/{e}` itself, `/events/{e}/competitions`, `/events/{e}/schedule`.

### 3.4 Live updates

The UI opens an EventSource:

```
GET /api/1/sse/control/subscriptions/stream?media_type=application/x-postcard
```

Events: `ping`, `subscription` (base64 postcard payloads). The UI then registers what it wants with `PUT /api/1/subscriptions/<id>` (binary body containing realm and event). We don't decode this yet; polling the GET endpoints is enough.

### 3.5 Write and dangerous routes ⚠️ (never call)

Seen in the server binary and the UI code. Do not call these from any tool:

- `/api/1/competitions/results/deliverCompetition` – **sends results to the federation**
- `…/result/deliver`, `…/report/deliver` (invigilator report), `…/result/delete`, `…/report/delete`
- `deleteRound`, `create_round`, `start`, `pause`, `finish`, `complete`, `cancel`, `unfinish`
- `open_checkin`, `close_checkin`, `open_registration`, `close_registration`
- `…/import`, `load/merge`, `extend`, `{id}/activate`, `{id}/login`, `/api/1/stop`, `/api/1/utc_offset` (POST, harmless clock sync by the UI)
- `print*`, `test_print`, `number/draw`, `change_numbers`, `bulk_check_in`

In the UI, the delivery button is **Odeslat do ČSTS** on a closed competition. An orange swallow icon in the header means there are competitions with unsent results.

---

## 4. Data model

### 4.1 Competition (from `/competitions`)

Key fields: `id`, `competition_number`, `name` (often empty), `age`, `class`, `discipline`, `series` (lookup ids), `state`, `check_in_end` (ms since epoch), `planned_check_in_end`, `day`, `block`, `floor`, `hall`, `group`, `position`, `registered_count`, `checked_in_count`, `remaining_count`, `heat_size`, `dances[]` (dance ids), `rounds[]`, `heats_from_final`.

Title as the UI shows it: `<age.value> <class.value> <discipline.abbreviation>`, e.g. "Děti I E SoKOMB".

Competition `state` values: `Planned`, `Registration`, `RegistrationClosed`, `CheckIn`, `ReadyToStart`, `Running`, `Completed`, `Closed`, `Cancelled` (seen: `RegistrationClosed`, `Running`).

### 4.2 Round

`id`, `name` ("1. kolo", "Finále"), `abbreviation` (R1, F), `state`, `judging` (`SkatingElimination`, `SkatingFinal`, …), `judge_count`, `competes`, `advances`, `dance_heat_count`, `started`, `finished`, `cancelled`, `cancellation_reason`, `logical_order`, `physical_order`, `dances[]`, `judges[]{person, device, assessment_state, round_dance}`.

Round `state` values ✅: `Paused` = judging not enabled; `InProgress` = judging enabled (**Povolit hodnocení**), verified 2026-10-17 on Pardubice competition 3; enabling also sets `started`. A cancelled round has state `Cancelled` and `cancelled`/`cancellation_reason` set, and still appears in `/competitions`. `Completed`, `Finished` exist in the UI code.

Round dance: `id`, `dance`, `dance_order`, `state` (`Active`, `Suppressed`), `heat_count`, `seed_method` (`RandomFixed`, `NoSeedSingleHeat`), `completed_at` (null until every judge has finished the dance). The current dance is the first one without `completed_at`; DanS's own display uses the same rule.

Competitor completion values: `YetUnknown`, `Recalled`, `Losing`, `Completed`, `Retired`, `Disqualified`, `Excluded`.

### 4.3 Lookup values (ČSTS realm)

- Age: Do 8 let (U-8), Děti I/II (Juv-I/II), Junioři I/II (Jun-I/II), Mládež (Y), Do 21 let (U-21), Dospělí (A), Senioři I–V (Sen-I…V).
- Class: E, D, C, B, A, M, Otevřená (Open), Bez třídy (En).
- Discipline: STT, LAT, KOMB, 10D, SoSTT, SoLAT, SoKOMB (solo), SySTT/SyLAT (synchro), ChSTT/ChLAT, Show*, KRB, Ba, Me, Ss, Free…
- Dance (`value` / `abbreviation`): Waltz W, Tango T, Viennese Waltz V, Slowfox Sf, Quickstep Q, Samba Sa, Chachacha C, Rumba R, Paso Doble Pd, Jive J, Polka Po, Salsa Ss, Bachata Ba, Merengue Me.
- Official roles: Judge, Vedoucí soutěže (VS), Hlavní sčitatel (HS), Scrutineer (Scr), DJ, Invigilator (Inv), Komisař figur (KF), Master Of Ceremonies (MoC).

---

## 5. Displays (built-in projection)

- Configure under **Konfigurace › Výstupy › Displeje**: abbreviation, URL segment, arrangement (one area, several horizontal, several vertical).
- Attach report queues under **Konfigurace › Fronty**.
- Attach the display to the event under the event's **Nastavení › Displeje › Připojit**. Displays only work for events dated today ± 1 day.
- Show: `http://<server>/display/<url_segment>`.
- Display states: **Promítá** (cycles active reports), **Zmraženo** (freeze), **Pozadí** (background), **Přestávka** (break), **Klíč** (green key), **Info** (list of events).
- Reports that can go to a display: start list of competition/round, heats (competitor → heat, heat → competitors), recalled, eliminated, results of competition/round/dance/final. Schedule and judge lists are print-only.
- Template classes in `/default_template/base.css`: `.background-box`, `.break-background`, `.key-background`, `.report-heats-by-competitors`, `.report-heats-by-heats`, `.report-round-startlist`, `.report-round-result`, `.report-dance-result`, `.report-final-report`; CSS variables `--text`, `--highlight`, `--dimmed-background`, `--dimmed-content`.

---

## 6. SQLite files (fallback, local only)

In `%APPDATA%\dans\`: `dans-sys.db`, `dans-realm-<id>.db`, `dans-event-<event id>.db`, `csts-cache.db`. They are in WAL mode: copy the `.db`, `-wal` and `-shm` together and read the copy, never the live file.

Main event tables: `competition`, `competition_competitor`, `competitor`, `competitor_unit`, `couple`, `person`, `official` (with `label`, `pin`), `official_licence`, `competition_official` (allocation), `round`, `round_dance`, `round_competitor` (heat per competitor per dance), `round_judge`, `mark`, `display_report_*`. IDs are 16-byte blobs. Times are UTC text. Lookup names live in the realm database (`index_*`).

---

## 7. Practical quirks

- Headless browser screenshots of `/display/*` never finish with `--screenshot`, because the page keeps a live connection. Use the DevTools protocol and capture on a timer (see `tools/cdp_sniff.py`).
- Synthetic JavaScript `click()` events don't work in the WASM UI. Real mouse events through DevTools `Input.dispatchMouseEvent` do.
- In the event list, the toolbar after ticking an event shows **Otevřít**, **Upravit**, **Kalkulace**, **Připojit** (link to federation), **Exportovat**, **Odstranit** (delete). Only **Otevřít** is safe for automation.
- Times ✅: the API gives `check_in_end` in milliseconds since epoch, real UTC. The database stores the same instant as UTC text. The UI shows local time: competition 1 in Pardubice is 14:30 UTC in the database and 16:30 on the Organizace page (CEST).

---

## 8. Tools in this project

| Tool | Purpose |
|---|---|
| `app/scripts/snapshot.js` | Records a full read of an event into `app/fixtures/private/` (personal data, not committed) |
| `app/scripts/anonymize-fixture.js` | Makes the shareable `app/fixtures/sample.json` from a snapshot |
| `tools/dans_read.py` | GET-only client: schedule, judge allocation, heats |
| `tools/cdp_sniff.py` | Loads a DanS page in headless Edge, logs all requests, blocks "deliver" URLs |
| `tools/obsws.py` | obs-websocket client |
