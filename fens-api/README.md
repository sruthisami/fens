# flowlens-api

Node + Express API on port 4000. Part of [FlowLens](../CLAUDE.md). It serves crawl graphs from FalkorDB to the dashboard, read-only. The endpoints and response shapes are in the [API contract](../CLAUDE.md#api-contract-flowlens-api).

## Requirements

- Node 20.19 or newer, npm
- Docker (for local FalkorDB)

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d        # FalkorDB on localhost:6379, UI on localhost:3000
```

Fill in `.env` as needed. Empty values count as unset. `FALKORDB_URL` defaults to `redis://localhost:6379`. The AI and GitHub keys are not needed for `/health` and can stay empty until the agents are built.

## Run

```bash
npm run dev                 # builds, then runs on http://localhost:4000 with watch
npm run build -- --watch    # optional, second terminal: rebuild on save
```

Check it:

```bash
curl http://localhost:4000/health
# {"status":"ok","service":"flowlens-api"}
```

## Graph endpoints

```bash
curl http://localhost:4000/api/graphs
curl http://localhost:4000/api/graphs/demo-shop-v1/summary
curl http://localhost:4000/api/graphs/demo-shop-v1/graph
curl "http://localhost:4000/api/graphs/demo-shop-v1/screens/%2Fcheckout%2Fconfirmation"
curl http://localhost:4000/api/graphs/demo-shop-v1/components
curl http://localhost:4000/api/graphs/demo-shop-v1/components/FormField/screens
```

Screenshots are served from `ARTIFACTS_DIR` (default `../fens-explorer/artifacts`), for example `/api/graphs/demo-shop-v1/screenshots/root.png`.

## Scripts

| Script                            | What it does                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Build, then run with watch                                                                                                                                           |
| `npm run build`                   | Compile TypeScript to `dist/`                                                                                                                                        |
| `npm start`                       | Run the built server                                                                                                                                                 |
| `npm run typecheck`               | Type-check without emitting                                                                                                                                          |
| `npm run lint`                    | ESLint                                                                                                                                                               |
| `npm run format` / `format:check` | Prettier                                                                                                                                                             |
| `npm test`                        | Build, then run the unit tests                                                                                                                                       |
| `npm run linear:check`            | Check the Linear key and team (read-only; `-- --write-test` creates and deletes one issue)                                                                           |
| `npm run ground-truth`            | Check every planted flaw in every layer, both graphs; writes `../GROUND_TRUTH.md` (`-- --no-run` reuses stored findings)                                             |
| `npm run figma:sync-check`        | Compare `figma-prototype.json` (the Figma prototype connections) with both graphs; no Figma call. Re-wire with `../scripts/figma-wire` after a recapture or re-crawl |
| `npm run linear:setup`            | Create the FlowLens labels in the Linear team (idempotent)                                                                                                           |

## Linear

FlowLens sends work that is not a code change to Linear: **findings of category `content`** and **decisions marked `needs_human`**. Everything else goes to GitHub. Nothing is created without the dashboard's preview and confirm, and nobody is ever assigned (the suggested assignee is a line of text in the description).

Setup:

1. Create a Linear workspace (or use one) at linear.app, with at least one team.
2. In Linear, open Settings, Security & access, Personal API keys, and create a key with read and write access. Put it in `.env` as `LINEAR_API_KEY`. It is never printed or returned by the API.
3. Run `npm run linear:check`. It prints who the key belongs to (name and email), the workspace, and every team the key can see (id, key, name). Copy the team's id into `.env` as `LINEAR_TEAM_ID`; with exactly one team and no `LINEAR_TEAM_ID`, it prints the line to copy. Run it again until it says `LINEAR_TEAM_ID matches team …`. It makes no writes.
4. Optional: `npm run linear:check -- --write-test` creates one issue, `[FlowLens] setup test`, in the team and deletes it again (it stays in Linear's trash for 30 days; if delete is refused it is archived).
5. Run `npm run linear:setup`. It makes sure the team has the labels `flowlens`, `ux`, `seo` and `content`, creates the missing ones, and reports what it created and what already existed. Running it again creates nothing.
6. Restart the API (`npm run dev` or `npm start`) so it reads the new `.env`.

| Variable         | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `LINEAR_API_KEY` | Personal API key (Settings, Security & access)                 |
| `LINEAR_TEAM_ID` | Team id (a UUID) from `npm run linear:check`, not the team key |

What an issue holds: title `[FlowLens] <finding title>`; a markdown description with the explanation, the evidence (tool, screens, and path steps with the link text of each step), the recommendation, the suggested assignee as a text line, and a link back to the finding (`http://localhost:5173/?graph=<graph>&finding=<id>`, which opens it in the dashboard); the labels `flowlens` plus the finding's category (`content`) or lens (`ux`, `seo`); and the priority from the severity (high 2, medium 3, low 4; needs_human decisions 3). Labels that do not exist yet are skipped and reported (run `linear:setup`).

Closing the loop: in the dashboard's Compare view, a resolved finding with a Linear issue offers **Comment and mark done**. After a confirm it comments with the release diff (health, issues fixed and new, findings resolved and new) and moves the issue to the team's first completed state (usually Done). The server refuses (409) while the finding is still present in the newer release, the same rule as for GitHub.

Errors: authentication failed 401, missing permission 403, team not found 404, rate limit 429, anything else from Linear 502. Without `LINEAR_API_KEY` and `LINEAR_TEAM_ID` the preview still works (a dry run) and creating answers 400.

## Channels: GitHub, Linear and Figma for one finding

A finding can be sent to GitHub (code changes), Linear (content findings only) and Figma (a comment pinned on the screen's frame). Each item links the others, and one action closes them all.

- **Same wording everywhere.** Title `[FlowLens] <finding title>`, headline `Severity: … · Category: … · … agent`, a short evidence summary and the dashboard link `http://localhost:5173/?graph=<graph>&finding=<id>` come from one function, `buildCommonPayload`.
- **Send** (dashboard, Investigate tab, a finding's Channels panel): tick the channels, preview, confirm. They are created in the order GitHub, Linear, Figma, so each one links those before it; the earlier ones are then updated with the later links. If one channel fails, the others still run, and each result is shown.
- **Links block.** GitHub bodies and Linear descriptions carry the links between `<!-- flowlens-links -->` and `<!-- /flowlens-links -->`; Sync replaces only that block, so running it again changes nothing. Figma's REST API cannot edit a comment, so new links arrive as a threaded reply.
- **Status.** Each finding shows one text line per channel (`GitHub #12 open`, `Linear FEN-3 done`, `Figma comment posted`, `Figma: not sent`). **Check channels** fetches each item: does it still exist, is it open or closed, are its links current.
- **Resolve everywhere** (Compare tab, on a finding the newer release no longer has): comments on and closes the GitHub issue, comments on and marks done the Linear issue, and replies on the Figma comment. Figma's REST API cannot mark a comment resolved, so resolve that thread in Figma. Nothing is closed while the finding is still present in the newer release.
- **Stored on the Finding:** `github_issue_url`, `github_issue_number`, `linear_issue_url`, `linear_issue_identifier`, `figma_comment_id`, `figma_comment_url`, a `<channel>_created_at` and `<channel>_closed_at` for each, and `closed_in`.

Removing test items afterwards: close the GitHub issue (or delete it in the repository's issue settings if you are an admin), delete the Linear issue (issue menu, Delete; it stays in trash for 30 days), and delete the Figma comment (only its author can; the token's account posted it).

## Stop FalkorDB

```bash
docker compose down         # keeps data in the falkordb-data volume
```
