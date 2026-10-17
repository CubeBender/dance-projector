# DanS client – specification

Read-only access to the DanS REST API, used by the control app main process.

## Safety

- Only HTTP GET. The client throws on any other method.
- Any URL containing `deliver`, `delete`, `cancel`, `finish`, `close`, `open`, `start`, `print`, `import`, `activate` or `login` is refused before it is sent.
- Judge PINs are dropped as soon as the response is parsed.

## Transport

- Base: `http://<server>[:port]/api/1`. Local test server: `http://localhost:8686`.
- Headers: `accept: application/json`; event-scoped calls also need `dans-event: <event id>`. Without it DanS answers 404 "Not found".
- Responses: `{ messages, paging, collection }` for lists, `{ messages, entity }` for single objects. Lists seen so far return everything in one page even when `paging.limit` says 25.

## Endpoints used

| Endpoint | Content |
|---|---|
| `/events` | Events. Event id is `authorities[0].event_id`. |
| `/competitions` (+ header) | Competitions of the event with `rounds[]`, each with `dances[]` and `judges[]`. |
| `/events/{e}/judges` | Judges: `person_id`, `label` (letter), `country`, `person_display{name,surname,in_authority_id.id}`, `pin` (dropped). |
| `/events/{e}/officials/competitions` | Allocation: `{competition, person, role}`. |
| `/events/{e}/startlist` | Competitors: `id`, `number`, `club`, `people.Persons[]` or couples. |
| `/rounds/{r}/draw/competitors` | Heats: `competitors[]{id, number, dances[]{heat, completion}}`, dance order matches `round.dances` by `dance_order`. Verified read-only. |
| `/index_age`, `/index_class`, `/index_discipline`, `/index_dance`, `/index_official_role` | Lookup names (`value`, `abbreviation`). |

## Values observed

- Competition `state`: `RegistrationClosed`, `Running` (others exist: Planned, Registration, CheckIn, ReadyToStart, Completed, Closed, Cancelled).
- Round `state`: `Paused` seen with judging not enabled. `InProgress`, `Completed`, `Finished` exist in the UI code. Running mapping is decision P-03.
- Round dance: `state` (`Active`/`Suppressed`), `completed_at` (null until all judges finish).
- Times: `check_in_end` is milliseconds since epoch.
- A cancelled round still appears in the database; the API omits it or sets `cancelled`.

## Derived model (what the client returns)

```
competition: { id, number, title, titleShort, state, checkInEnd, registered, checkedIn,
               running, round: { id, name, state, competes, advances, dances[] , currentDanceIndex },
               judges: [personId…] }
judge:       { personId, fedId, label, name, surname, country }
heats:       { roundId, dances: [{ name, abbr, completed, heats: [{ heat, competitors:[{number, name, club}] }] }] }
```
