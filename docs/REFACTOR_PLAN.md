# State machine cleanup plan — first pass

The first six-boundary pass below is a historical record. The subsequent full refactor and current verification are recorded in [FULL_REFACTOR.md](FULL_REFACTOR.md).

## Goal

Make the highest-coupling control flows explicit and testable on `codex/cleanup-state-machines`, preserving the existing desktop/touch workflows, exact image positions, matching algorithms, saved projects and import/export compatibility. Produce reviewable commits and a verified branch.

The [inventory](STATE_MACHINES.md) describes 44 machine families. This implementation pass targets six ownership boundaries. Small, already-clear disclosures and platform-owned state keep their current implementations.

## Milestones

1. [x] **Preview/add lifecycle.** Replace overlapping preview flags and duplicated ref/state guards with typed transitions. Represent request supersession, dismissal, acceptance and draft movement explicitly. Preserve random cohorts, exact preview coordinates, query debounce and immediate optimistic acceptance.
2. [x] **Foreground commands and persistence.** Give foreground work an operation owner; expose accepted-local and saved/failed outcomes for optimistic board edits. Preserve concurrent board saves, history invalidation, settings rollback and error ownership.
3. [x] **Drop decisions.** Separate target/outcome decisions from effects, with typed outcomes for placement, folder/parent movement, return to waiting, grouping and rejection. Preserve source-specific precedence and the existing pointer/Motion adapters.
4. [x] **Folder navigation transaction.** Centralize request identity and prepare/leave/commit/enter/cancel transitions. Preserve camera restoration, scope resets, inert-control cleanup and keyboard focus.
5. [x] **CLIP lifecycle ownership.** Make task/worker ownership and cancellation explicit alongside progress phases. Preserve enable-before-import, hydration into preloaded workers, priority references, pause/resume/rebuild, recovery guards and bounded inference.
6. [x] **Verification and handoff.** Run type/build checks, unit/component tests and the desktop browser suite; run focused WebKit gesture/navigation/preview checks. Fix concrete regressions, update the inventory to identify extracted owners, and leave the branch clean and committed.

## Invariants

- Existing images and folder anchors move only through the same explicit user actions as before.
- Preview acceptance uses the displayed coordinates and remains immediate; persistence success is a separate event.
- Stale async results cannot replace newer drafts, collections, scopes or saved edits.
- Each physical drag/drop completes at most once; cancel restores transient transforms and releases ownership.
- Every foreground operation and navigation releases only its own lock/state.
- Undo restores prior membership and positions without overwriting newer analysis metadata.
- CLIP disable/unmount releases workers; queued/reference requests settle or reject; saved vectors remain reusable.
- No schema, model checkpoint, matching algorithm, compatibility field or export format changes.

## Verification strategy

Use existing workflow specifications and add focused transition tests for concrete ownership gaps: stale completion, repeat activation, cancellation, failed persistence, superseding navigation and worker disposal. Run targeted tests after each extraction, then the required whole-app gates. Keep continuous pointer coordinates and animation handles outside React render state.

## Progress

- Planning: branch and baseline inventory inspected; implementation milestones and invariants recorded.

- Preview/add: a shared `PreviewSession` replaces competing open/loading/committing flags and request refs; geometry, cached cohorts and debounce behavior remain in the adapters.
- Persistence/foreground: optimistic edits return receipts with independent durable outcomes. Foreground leases account for allowed overlap and replace three separate ref locks; settings rollback and form-owned errors remain local.
- Drop routing: pure `resolveImageDrop` decisions preserve target precedence and source-specific effects; existing Motion/native/keyboard completion adapters stay in place.
- Navigation: `FolderNavigation` owns cancellation and prepare/leave/commit/enter, including stale failures, deleted targets, unmount and focus. Camera math and DOM animation remain existing effects.
- CLIP: `ContentIndexLifecycle` owns a single run and worker slot, serializes stopped-run drainage and rebuild, and prevents stale synchronization/progress. It preserves preloading/hydration, cache persistence and inference scheduling.

## Verification record

- Baseline: 161 unit/component tests and production build passed.
- First extraction: 19 Chromium preview/search/naming workflows passed, including exact preview-to-card coordinates, draft dragging and late responses.
- Added transition coverage: repeat acceptance, supersession/dismissal/unmount, foreground ownership, target precedence, interrupted navigation, save failure recovery, serialized pause/resume/rebuild, disposed workers and Strict Mode hydration.
- Implementation checks: 182 unit/component tests; production build passed (existing bundle-size advisory remains).
- Whole desktop suite: **163 passed, 1 failed** in the final run. The remaining camera-containment failure was reproduced on the unchanged audited baseline (three failures in three repeats); details below. The initial run also exposed a baseline virtualization assumption in one assertion; its membership-based replacement passed three consecutive reruns and the final suite run. A test-module export changed while the first suite was running; that transient loader error is absent from the final run.
- Focused WebKit: 23 distinct workflows passed across the focused suite and corrected navigation rerun; three native CDP touch checks are Chromium-only and skipped on WebKit. Includes exact preview placement, batch dragging, group cancellation, saved camera/filter context, interrupted navigation, reduced motion and phone taps.

### Issues found while validating

- Reproduced this WebKit automation build's Blob-storage failure on the unchanged baseline. Reused the existing persistent-profile fixture for gesture/group/navigation checks; extracted a context lease so the explicit phone context receives the same storage support and always removes its temporary profile.
- Reproduced an intermittent baseline starter assertion: a camera reveal can virtualize an offscreen image. The test now counts durable board membership and verifies that the reference image's coordinates remain unchanged.
- Reproduced a real baseline touch obstruction in navigation: the missing-original placeholder retained a 135 px height inside the compact 104 px preview area, covering the Open row. Matched its dimensions to normal previews. The existing phone navigation workflow now passes without forced taps or synthetic clicks.

### Commands

```sh
npm test
npm run build
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=4466 npx playwright test --project=chromium --reporter=list
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=4465 npx playwright test e2e/stash-navigation.spec.ts --project=webkit --reporter=list
```

The broader WebKit run also includes `board-gestures`, `group-drag`, `board-suggestions` and `in-place-add` specifications. Algorithm/model modules, IndexedDB/schema and archive modules, and dependency manifests are unchanged from the audited baseline.


## Baseline issue found in the first pass

`e2e/desktop-browser-continuity.spec.ts:133`, “repeated stash creation and returning reveal the stack without rearranging saved anchors”, intermittently leaves a folder tile partially outside the viewport. The failing assertion checks tile containment after creation/return; the later saved-anchor comparison is not reached. The first pass did not establish the root cause. The full refactor subsequently traced native focus/reveal scroll overwriting the camera; see its current verification record.

- Unchanged `4796ffc`: three failures in three focused repeats.
- Cleanup branch: one failure in the final whole suite; focused runs both passed and failed. Waiting for navigation to settle alone did not remove the intermittent failure, so that experimental test change was reverted.
- At the first-pass checkpoint this remained a visible camera-reveal issue for a focused change. The branch does not change its placement/camera math to hide the failure, relax containment, force clicks or move saved anchors.

Reproduce on either baseline or cleanup branch:

```sh
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=4466 npx playwright test e2e/desktop-browser-continuity.spec.ts --project=chromium --grep 'repeated stash creation' --repeat-each=3 --reporter=list
```

## Handoff

All six scoped lifecycle boundaries are implemented and verified. The 44-family inventory remains the roadmap for later extractions. Implementation is committed as `46aa136`; the touch-control and browser-fixture fixes are `8be0071`. The whole desktop gate has the explicitly recorded baseline failure above. Changes remain on the isolated cleanup branch.
