# OL-20c: Edit clip-type sources while a production is live

- Status: Proposed
- Date: 2026-10-15
- Author: architect
- Scope: `open-live-studio` only (frontend). No backend / API contract change.
- Issue: [Eyevinn/open-live-studio#204](https://github.com/Eyevinn/open-live-studio/issues/204)
- Parent epic: [#199](https://github.com/Eyevinn/open-live-studio/issues/199) (OL-20), proposal item 4
- Depends on: OL-19 (`CLIP_CUE` contract, [Eyevinn/open-live#504](https://github.com/Eyevinn/open-live/issues/504)) — merged

## Problem Statement

In the Setup view (`SourcesPanel`), every source assigned to an active (or activating)
production is locked for Edit and Delete. The lock is deliberate: mutating a source's address
or latency mid-production can disrupt a live feed, so the panel disables both actions
(`src/pages/SetupPage/SourcesPanel.tsx:647`, `locked = inActiveProduction || gatewayOwned`).

Clip-type sources (`streamType: 'clip'`) are different. A clip source carries no live
transport; its `address` holds a JSON `ClipReference` (a `url` or `s3` pointer — see
`SourcesPanel.tsx:62`, `ClipRefType`) that the backend resolves only when the clip is cued.
Since OL-19, a reference change takes effect at the **next Cue** via the existing `CLIP_CUE`
command (`src/hooks/useControllerWs.ts:99`) — it never disturbs a clip that is already playing.
Operators therefore need to swap a clip's reference (fix a wrong URL, point at an updated
asset) while the production is live, as long as that specific clip is not currently on air.

This spec relaxes the active-production lock **selectively, for Edit of clip-type sources
only**, while keeping everything else locked exactly as today.

## Grounding (verified source references)

| Fact | Location |
|------|----------|
| Single combined lock drives row click + Edit + Delete | `src/pages/SetupPage/SourcesPanel.tsx:647` (`locked = inActiveProduction \|\| gatewayOwned`) |
| `inActiveProduction` derivation (active/activating productions' `sources[].sourceId`) | `SourcesPanel.tsx:334-338` (`activeSourceIds`) |
| Row click opens Edit when unlocked | `SourcesPanel.tsx:664` (`onClick={() => { if (!locked && !isPhone) openEdit(src) }}`) |
| Edit button, `disabled={locked}`, `title={editTitle}` | `SourcesPanel.tsx:707-716` |
| Delete button, `disabled={locked}`, click guarded by `!gatewayOwned` | `SourcesPanel.tsx:717-725` |
| Clip source type / `ClipReferenceFields` edit form | `SourcesPanel.tsx:778-784`, `ClipReferenceFields` at `SourcesPanel.tsx:143` |
| Clip edit save path (writes `address` only when the serialized ref changed) | `SourcesPanel.tsx:469-479` (`handleEdit`) |
| `streamType` union incl. `'clip'` | `src/lib/api.ts:65` |
| Production source assignment carries `{ sourceId, mixerInput }` | `src/lib/api.ts` `ProductionSourceAssignment` (`sourceId`, `mixerInput`) |
| Live clip playback state, keyed by `mixerInput` | `src/store/production.store.ts` `clipStates: Record<string, ClipState>` (reset on production change) |
| `ClipPlaybackState` values | `production.store.ts:78-79`: `'idle' \| 'cued' \| 'playing' \| 'paused' \| 'stopped' \| 'completed' \| 'error'` |
| `CLIP_STATE` fed from controller WS broadcast + connect-time sync | `production.store.ts` (`clipStates` doc), `useControllerWs.ts:383` (`case 'CLIP_STATE'`) |
| `applyClipState(clip)` store setter | `production.store.ts` (`ProductionActions.applyClipState`) |
| Session-level keep-alive socket **ignores all inbound frames** | `src/hooks/useSessionKeepAlive.ts` (`socket.onmessage = null`), mounted in `src/components/layout/Shell.tsx:16` |
| Controller WS (full state sync) only mounted on mixer / pane views | `src/pages/ControllerPage/index.tsx:600`, `src/pages/PanePage/index.tsx:335` |

## Lock-relaxation rule

Replace the single `locked` flag with two derived flags so Edit and Delete can diverge.

### Which source types

Only `src.streamType === 'clip'`. Every other `streamType` (`srt`, `efp`, `whip`, `html`,
`test1`, `test2`) keeps today's behavior unchanged. Gateway-owned sources
(`gatewayOwned === !!src.gatewayId`) stay locked for both Edit and Delete regardless of type
(gateways recreate them each heartbeat — open-live#263); clip sources are never gateway-owned
in practice, but the guard is kept to be safe.

### The "unless playing" guard — how "playing" is known

The guard keys off the clip's live playback state. To read it for a given source row:

1. Build a `sourceId → mixerInput` map from the active/activating productions' assignments
   (the same productions already filtered for `activeSourceIds`; each assignment carries both
   `sourceId` and `mixerInput`).
2. Look up `clipStates[mixerInput]?.state` (`clipStates` from `useProductionStore`).
3. Treat the clip as **on air** when `state === 'playing' || state === 'paused'`.

```
isClip         = src.streamType === 'clip'
mixerInput     = mixerInputBySource.get(src.id)            // from active assignments
clipState      = isClip ? clipStates[mixerInput ?? '']?.state : undefined
clipOnAir      = clipState === 'playing' || clipState === 'paused'

editLocked     = gatewayOwned || (inActiveProduction && (!isClip || clipOnAir))
deleteLocked   = gatewayOwned || inActiveProduction        // unchanged from today's `locked`
```

- `playing` and `paused` both count as on air: a paused clip still holds its current frame on
  its slot, so swapping its reference under the operator is as disruptive as while playing.
- `cued` does **not** lock: the clip is armed but not yet on air, and any edit re-serializes the
  reference that the next `CLIP_CUE` will resolve — the operator simply re-cues to pick it up.
- `idle`, `stopped`, `completed`, `error`, and **unknown** (no `CLIP_STATE` for that
  `mixerInput`) are all editable. Unknown defaults to editable (mirrors `ClipPanel`'s
  `clip?.state ?? 'idle'`); this is safe because, per OL-19, an edit never affects the current
  playout — it only stages the reference for the next Cue — so even a momentarily stale guard
  cannot disturb what is on air.

`clipStates` is reset on production change and is only kept fresh while a controller WS is
connected. See "Keeping `clipStates` fresh on the Setup view" below — without that, the guard
would read stale/empty state on Setup.

### Keeping `clipStates` fresh on the Setup view

The full controller WS (`useControllerWs`) that syncs `clipStates` is mounted only on the mixer
(`ControllerPage`) and pane (`PanePage`) views. On the Setup view the only socket for the
active production is the app-shell session keep-alive (`useSessionKeepAlive`, mounted in
`Shell.tsx`), which today sets `socket.onmessage = null` and ignores every inbound frame. So on
Setup, `clipStates` is stale/empty and the guard cannot see "playing".

**Decision:** extend `useSessionKeepAlive`'s socket to handle exactly one inbound message type —
`CLIP_STATE` — by calling `applyClipState(...)`, while continuing to ignore all other frames.
The backend already emits `CLIP_STATE` on connect (connect-time sync) and on every clip
transition, so the keep-alive socket receives current clip state for the active production
whenever the operator is on Setup. This:

- requires **no backend / API change** (the `/ws/productions/:id/controller` endpoint and the
  `CLIP_STATE` broadcast already exist);
- preserves the single-subscriber invariant (#139) — no new socket is opened, and the keep-alive
  still stands down to the mixer connection when the mixer view is mounted;
- leaves full state sync owned by the mixer view (we add only the `CLIP_STATE` case, not the
  whole reducer).

This is the chosen alternative over (a) opening a second full `useControllerWs` from
`SourcesPanel` (violates the single-subscriber design and is heavyweight) and (b) adding a REST
endpoint for clip state (forbidden API change).

## UI behavior

### Row and buttons

- Row `onClick` and the Edit button gate on `editLocked` (replacing `locked`). The Delete button
  gates on `deleteLocked` (identical to today's `locked`), and its click guard stays `!gatewayOwned`.
- Row cursor/border styling follows `editLocked` (the row click is an edit affordance).
- Tooltips (`editTitle` / `deleteTitle`):
  - Editable clip in a live production: `editTitle = 'Editable while live — changes apply at the next Cue'`.
  - Clip on air (`clipOnAir`): `editTitle = 'Cannot edit while the clip is playing'`.
  - All other locked cases keep today's copy (`'Cannot edit source in an active production'`,
    gateway-owned message, etc.).
  - `deleteTitle` is unchanged.

### Edit Source dialog copy

When the Edit Source modal (`SourcesPanel.tsx:758`) is open for a **clip source whose production
is active** (`isClip && inActiveProduction`), render a non-blocking info note at the top of the
modal body (after the Name field, before `ClipReferenceFields`):

> This production is live. Changes to this clip apply at the next Cue.

Styling: a muted/info banner consistent with the existing in-modal notes (e.g. the
`text-[--color-text-muted]` italic note used in `ProductionsPanel.tsx:525`). The note is
informational only — Save stays enabled (gated solely by `editReady`). No change to the save
path: `handleEdit` already writes `address` only when the serialized reference differs
(`SourcesPanel.tsx:472-476`), so a no-op edit sends nothing.

## What stays locked

- **Delete** of any source in an active/activating production — unchanged (`deleteLocked`).
- **Edit and Delete** of any **non-clip** source in an active production — unchanged.
- **Edit** of a clip source whose clip is **playing or paused** (`clipOnAir`).
- **Edit and Delete** of any **gateway-owned** source, any type, any state (open-live#263).
- Phone tier (`isPhone`, <768px): rows stay inert and all mutating controls hidden (#105) —
  this spec does not change phone behavior.

## Test plan

Unit / component (Vitest + Testing Library, matching existing `SourcesPanel` tests):

1. Clip source in an active production, `clipStates` reports `idle` (or no entry) → Edit enabled,
   row click opens the Edit modal; Delete disabled.
2. Clip source in an active production, state `cued`/`stopped`/`completed`/`error` → Edit enabled.
3. Clip source in an active production, state `playing` → Edit disabled, tooltip
   `'Cannot edit while the clip is playing'`.
4. Clip source in an active production, state `paused` → Edit disabled.
5. Non-clip source (`srt`/`efp`/`html`/`whip`) in an active production → Edit and Delete both
   disabled (regression guard on unchanged behavior).
6. Gateway-owned clip source in an active production, state `idle` → Edit and Delete both
   disabled; gateway tooltip shown.
7. Clip source NOT in any active production → Edit and Delete enabled (baseline).
8. Edit Source modal for a clip in an active production renders the "applies at the next Cue"
   note; the same modal for a clip with no active production does not.
9. Save of a clip edit in a live production calls `updateSource` with the new serialized
   `address`; a no-op edit (unchanged reference) sends no `address` field.
10. `useSessionKeepAlive`: an inbound `CLIP_STATE` frame calls `applyClipState` and updates the
    store; a non-`CLIP_STATE` frame is ignored; the single-subscriber hand-off to/from
    `useControllerWs` still works (no second socket while the mixer is mounted).

Manual (against the `openlivedev` beta, per `beta-regression-check.md`):

11. With a live production containing an idle clip source, edit its reference from Setup, Save,
    then Cue the clip in the mixer and confirm the new asset plays.
12. Start the clip playing, return to Setup, confirm its Edit is disabled; Stop it, confirm Edit
    re-enables.

## Open Questions (resolved)

1. **Does `paused` count as "playing" for the guard?** — Resolved: yes. `playing` and `paused`
   both lock Edit; a paused clip still occupies its slot with a held frame. Only states that are
   definitively not on air (`idle`/`cued`/`stopped`/`completed`/`error`/unknown) are editable.
2. **Should Delete be relaxed too?** — Resolved: no. OL-20c scope is Edit only. Removing a source
   from a live production changes its assigned input set, which is more disruptive than a
   deferred reference swap; `deleteLocked` keeps today's `inActiveProduction || gatewayOwned`.
3. **How is "playing" known on the Setup view, where the full controller WS is not mounted?** —
   Resolved: extend `useSessionKeepAlive` to handle the `CLIP_STATE` frame only and feed
   `applyClipState`. No backend change; preserves the single-subscriber invariant.
4. **What if `clipStates` is momentarily empty/stale on Setup?** — Resolved: default unknown to
   editable. Safe because, per OL-19, an edit only stages the reference for the next Cue and
   cannot disturb the current playout, so a brief stale window has no live-output consequence.
5. **Is an ADR required?** — Resolved: no. This is a single-service UI lock relaxation with no new
   API contract, protocol, data model, or dependency; it does not meet the
   `epic-workflow.md` ADR threshold. The keep-alive `CLIP_STATE` handling reuses an existing
   contract. This spec is the design record.

## Risks

- **Stale `clipStates` before the keep-alive connect-time sync lands** — mitigated: edits apply
  at the next Cue, so an editable-while-playing race has no on-air effect (Open Question 4).
- **Keep-alive scope creep** — adding message handling to a socket whose contract was
  "ignore inbound frames" must stay limited to the `CLIP_STATE` case; all other full-state sync
  remains owned by `useControllerWs`. Covered by test 10.
