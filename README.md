# dance-projector

Projection for dancesport competitions in OBS, with live data from DanS (dancesport.services).

- `app/` – Electron operator app and the OBS output pages (heats, judges, floor overview). See [app/README.md](app/README.md).
- `tools/` – helper scripts (read-only DanS client, OBS websocket client, DevTools recorder).
- `Docs/` – one folder per task with its spec and plan. Overview in [SPEC.md](SPEC.md), [PLAN.md](PLAN.md), [PROGRESS.md](PROGRESS.md), decisions in [DECISIONS.md](DECISIONS.md).
- [DANS_KNOWLEDGEBASE.md](DANS_KNOWLEDGEBASE.md) – what we know about the DanS API.

## Private data

This repository is public. Competition data contains names of competitors (many of them children), clubs and federation IDs, so it never goes into git.

| Stays local (ignored) | Committed instead |
|---|---|
| `app/fixtures/private/` – real DanS snapshots | `app/fixtures/sample.json` – the same event with made-up names, clubs and IDs |
| `obs/backup-*/` – OBS configuration backups | nothing; backups are local only |
| judge photos, names and app settings (`%APPDATA%\dance-projector`) | nothing |
| media: logos, videos (`assets/`, `*.mp4`, `*.mov`…) | nothing |

A pre-commit hook blocks commits containing private files, e-mail addresses, personal Windows paths (`C:\Users\<name>`), judge PINs or secrets. Enable it once after cloning:

```
git config core.hooksPath .githooks
```

To refresh the sample from a real event:

```
cd app
npm run snapshot -- http://<dans-server> CS1761 fixtures/private/pardubice.json
npm run anonymize -- fixtures/private/pardubice.json fixtures/sample.json
```
