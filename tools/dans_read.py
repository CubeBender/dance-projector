"""Read-only DanS client. It can only issue GET requests; nothing here can change or deliver data.

usage: python dans_read.py [--server http://host:port] [--event <event-id or abbreviation>]
Prints the schedule, the judge allocation per competition and the heats of every open round.

Key fact: event-scoped endpoints need the header  dans-event: <event id>  (otherwise 404 "Not found").
Endpoints used (all GET):
  /api/1/events                         list of events
  /api/1/competitions                   competitions of the event, incl. rounds and dances
  /api/1/events/{e}/judges              judges (label, name, licences; also PINs -> never display)
  /api/1/events/{e}/officials/competitions   person -> competition allocation (role id)
  /api/1/events/{e}/startlist           competitors with names, clubs, numbers
  /api/1/rounds/{r}/draw/competitors    heats per competitor per dance (read-only, verified)
  /api/1/index_dance, /api/1/index_age, /api/1/index_class, /api/1/index_discipline, /api/1/index_official_role
"""
import argparse, collections, json, sys, urllib.request
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument("--server", default="http://localhost:8686")
p.add_argument("--event", default="CS1761")
args = p.parse_args()


def get(path, event=None):
    req = urllib.request.Request(args.server + path, method="GET", headers={"accept": "application/json"})
    if event:
        req.add_header("dans-event", event)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def coll(path, event=None):
    return get(path, event).get("collection") or []


events = coll("/api/1/events")
ev = next(e for e in events if args.event in (e["abbreviation"], e["authorities"][0]["event_id"]))
E = ev["authorities"][0]["event_id"]
print(f"# {ev['name']} ({ev['abbreviation']}) {ev['authorities'][0]['date']} {ev['location']}")

ix = {}
for name in ("index_age", "index_class", "index_discipline", "index_dance", "index_official_role"):
    for x in coll(f"/api/1/{name}", E):
        ix[x["id"]] = x.get("abbreviation") or x.get("value")

comps = sorted(coll("/api/1/competitions", E), key=lambda c: c["competition_number"])
judges = {j["person_id"]: j for j in coll(f"/api/1/events/{E}/judges", E)}
alloc = collections.defaultdict(list)
for a in coll(f"/api/1/events/{E}/officials/competitions", E):
    alloc[a["competition"]].append(a)

start = {}
for s in coll(f"/api/1/events/{E}/startlist", E):
    start[s.get("id") or s.get("competitor_id")] = s


def title(c):
    return f"#{c['competition_number']} {ix.get(c['age'], '?')} {ix.get(c['class'], '?')} {ix.get(c['discipline'], '?')}"


def hhmm(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M") if ms else "--:--"


print("\n## Schedule (check-in end)")
for c in sorted(comps, key=lambda c: (c.get("check_in_end") or 0)):
    print(f"{hhmm(c.get('check_in_end'))}  {title(c):32} {c['state']:10} checked in {c['checked_in_count']}/{c['registered_count']}")

print("\n## Judges per competition")
for c in comps:
    if alloc[c["id"]]:
        names = sorted(
            f"{judges[a['person']]['label'] or '-'} {judges[a['person']]['person_display']['name']} {judges[a['person']]['person_display']['surname']}"
            for a in alloc[c["id"]] if a["person"] in judges)
        print(f"{title(c)}: " + ", ".join(names))

print("\n## Heats of open rounds")
for c in comps:
    for r in c.get("rounds") or []:
        if r.get("cancelled"):
            continue
        draw = get(f"/api/1/rounds/{r['id']}/draw/competitors", E)["entity"]
        dances = [ix.get(d["dance"], "?") for d in sorted(r["dances"], key=lambda d: d["dance_order"])]
        print(f"{title(c)} / {r['name']} ({r['state']}), {r['competes']} -> {r['advances']}")
        for di, dname in enumerate(dances):
            heats = collections.defaultdict(list)
            for comp in draw["competitors"]:
                if di < len(comp["dances"]):
                    heats[comp["dances"][di]["heat"]].append(comp["number"])
            print(f"  {dname}: " + " | ".join(f"heat {h}: {sorted(v)}" for h, v in sorted(heats.items())))
