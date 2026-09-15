# ADR-001: Phone-tier (<768px) responsive mode

- Status: Accepted
- Date: 2026-09-15
- Deciders: svensson00 (PM decision authority)
- Related issues: [#102](https://github.com/Eyevinn/open-live-studio/issues/102) (decision), [#105](https://github.com/Eyevinn/open-live-studio/issues/105) (implementation), [#91](https://github.com/Eyevinn/open-live-studio/issues/91) (responsive breakdown)

## Context

Open Live Studio is a browser-based live production controller. The responsive
breakdown (#91) surfaced the question of how the UI should behave on phone-sized
viewports (<768px). Three strategies were on the table (#102):

- (a) a reduced "operator-lite" mode,
- (b) a redirect to a dedicated mobile view, or
- (c) an explicit block with a "use a tablet or wider" message.

A product/UX call was required before the phone-tier implementation sub-issue
(#105) could proceed against a written record.

## Decision

Adopt **(a) a reduced "operator-lite" mode, read-only in v1**.

- Below 768px, the only essential panels are **Tally** and **production/source
  status**.
- Nothing that mutates state renders below 768px: no Take/Cut/Stop controls and
  no source editing.
- Where the mixer would otherwise render, show the message: **"use a tablet or
  wider to operate"**.
- A dedicated mobile view is **declined for now** — there is no demand evidence
  to justify it.

## Consequences

- Phone users get glanceable, read-only status on the studio floor, which is the
  primary value on phone.
- The risk of mis-taps on live controls is designed out, since no state-mutating
  controls are present below 768px.
- This decision unblocks the implementation sub-issue #105.
- Phone-side control is not precluded; it can be revisited as a later upgrade if
  real usage demonstrates demand.
