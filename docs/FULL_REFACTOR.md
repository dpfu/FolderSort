# Full state-machine refactor

## Scope and goal

Complete the audit-led refactor across all 44 families on `codex/cleanup-state-machines`. Keep exact image positions, folder membership, matching/sorting algorithms, saved schemas and import/export compatibility. Give coupled workflows a single owner and explicit transitions; retain native and already-clear machines with an evidenced disposition. No new framework is required.

## Work sequence

1. [x] Camera ownership and reveal: resolve the existing containment failure and centralize stable viewport measurements.
2. [x] Project lifecycle: collection requests, application navigation/review context, commands, import/export and history.
3. [x] Workspace domains: folder commands, matching/order preparation, selection, grouping, export and feedback; reduce orchestration in the view.
4. [x] Gesture lifecycle: card press/drop, follower movement, pan/pinch/lasso, tile movement and extraction; preserve single completion and cancellation.
5. [x] Browser lifecycle: panel modes, temporary import context, scrolling/focus restoration, ordering and starter.
6. [x] Naming and UI: submission/request ownership, suggestions, linked hints, menus, modal/review and Undo touch handling.
7. [x] Resource lifecycle: metadata analysis, worker request ownership, thumbnails, model runtime/recovery and archive compensation; retain distinct fallback policies.
8. [x] Final disposition of every family, obsolete-code removal, unit/build/full desktop and focused WebKit gates; clean reviewable commits.

## Verification

Existing workflow tests remain the behavioral contract. Add tests for concrete missing lifecycle guarantees rather than mirroring extraction. Targeted checks follow each domain; whole-app gates follow integration. A passing test must never depend on moving existing images, relaxing membership/position assertions, forced clicks or swallowing storage failures.

## Evidence and decisions

- Starts from `2dd2cbe`, with six ownership boundaries already extracted and 182 unit/component tests. The existing camera containment failure is included in this full pass.

## Implementation record

- `e761f83`: explicit task, gesture, camera, request and resource lifecycle primitives with transition tests.
- `8442693`: project/workspace integrations, domain extraction and obsolete-code removal.
- `d9288cf`: preserve the pointer-down help action through Safari’s blur/refocus before click.
- `LibraryApp` decreased from 453 to 209 lines; `SortingWorkspace` from 1,084 to 925. Domain policy now lives in project session/commands/transfers, workspace matching/order/export, browser context, naming and gesture/resource modules.
- Static application graph: **134 / 134** application TypeScript modules are reachable from `main.tsx`, including type-only and worker/dynamic imports. The sole audited orphan, `StackNameInput`, was removed.
- No dependency, model checkpoint/dtype/revision, matching algorithm, placement algorithm, IndexedDB schema, compatibility field or archive format changed. The original user draft checkout remains separate from this cleanup worktree.

## Integration findings

- Creating a folder released the project task before visible anchor/camera commit. The workspace now keeps its local folder task through panel/layout commit and uses prevent-scroll name focus.
- Native focus/reveal on folder controls could still overwrite the camera. `useBoardCamera` separates requested placement, observed movement and focus admission. Integration checks showed that a general scroll guard also blocked programmatic pans and image reveal; the final guard is scoped to folder controls and supports deliberate takeover of a settling placement.
- Metadata flush failure previously left transient metadata looking complete. Retry now invalidates hydration and reads durable state before deciding what still needs saving.
- Reused the existing persistent WebKit storage fixture for order-help tests and forwarded `hasTouch`. The three initial failures stopped inside fixture Blob writes, before interaction with help. Assertions and production storage behavior are unchanged.
- Once the WebKit fixture reached interaction, it exposed a second-tap blur/refocus cycle that unpinned help before the click. `HintSession` now snapshots activation intent on pointer-down; two unit regressions and all nine repeated WebKit help checks pass.

## Final verification

All eight stages are complete. Code is committed on `codex/cleanup-state-machines`; this branch has not been pushed or deployed.

| Gate | Outcome |
| --- | --- |
| Production build and strict TypeScript | Passed; existing chunk-size advisory only |
| Unit/component tests | 210 passed across 57 files |
| Four camera/export/edge/partial-drag workflows, five repeats each | 20 passed |
| Full desktop Chromium suite | 164 passed (5.5 minutes) |
| Focused WebKit gesture/navigation/preview/naming/help suite | 29 passed; 3 native-CDP checks are Chromium-only and skipped |
| Whitespace / obsolete-path / algorithm-and-format diff checks | Passed |

The final browser runs use the frozen build from `d9288cf`. No containment, position, membership, pixel or camera assertion was relaxed, and no forced click was added.

```sh
npm test
npm run build
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=4492 npx playwright test --project=chromium --reporter=list
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=4493 npx playwright test e2e/board-gestures.spec.ts e2e/group-drag.spec.ts e2e/stash-navigation.spec.ts e2e/board-suggestions.spec.ts e2e/in-place-add.spec.ts e2e/text-search-naming.spec.ts e2e/order-help.spec.ts --project=webkit --reporter=list
```

## Family dispositions

| Family | Workflow | Status / owner and rationale |
| --- | --- | --- |
| M01 | Project startup and collection hydration | Refactored — `useProjectLibrary` has an atomic loading/ready/error collection and independent `RequestOwner` channels for summaries and collection reads. Mutation invalidation and Strict Mode replay are covered by its existing seven hook tests. |
| M02 | Application navigation and overlays | Refactored — `projectSession` reducer / `useProjectSession` own route entry, review context, settings and reset. `LibraryApp` is composition; commands and transfers have dedicated modules. |
| M03 | Foreground operation ownership | Retained explicit owner — `ForegroundOperations` leases preserve permitted overlap. `useProjectCommands` now owns mutation, Undo and setting orchestration; board saves remain independent. |
| M04 | CLIP setting persistence and replay | Retained journal — `setProjectClipEnabled` writes the synchronous recovery journal before its IndexedDB transaction and startup replay. Its rollback now lives in `useProjectCommands`; readiness remains an independent CLIP lifecycle. |
| M05 | Image import intake | Refactored — `useProjectTransfers` owns optional import choice, partial-success refresh and foreground progress. `importIntake` isolates recursive discovery; an `AsyncTask` rejects superseded discovery and completion after a project switch. |
| M06 | Backup restore saga | Retained bounded saga — `projectArchive.importProjectFiles` validates the manifest, tracks written IDs, commits each asset/image atomically and compensates before rejecting. It has one call lifetime; introducing persisted workflow state would change recovery/format contracts. Archive tests cover failure and compatibility. |
| M07 | Archive/folder export | Extracted — `useProjectTransfers` owns snapshot/export/download orchestration through foreground leases. `projectArchive` retains bounded snapshot/write loops, directory-picker timing and existing formats. |
| M08 | Persisted image location | Retained persisted boundary — `normalizeFolderImage`, assignment/place/remove transactions and `imageOnScopeBoard` already give Waiting/Staging/folder one meaning. Legacy omitted `rootOnBoard`, compatibility mirrors and archive schemas are unchanged; folder/staging/backup tests enforce this. |
| M09 | Folder-board initialization and migration | Clarified ownership — atomic store migration/preparation remains in `imageStore`; visible creation is held by the workspace folder task through panel/layout/anchor commit. Camera framing is a view effect, separate from durable layout initialization. Existing positioned records are never normalized into new positions. |
| M10 | Folder naming intent and suggestions | Refactored — `useFolderNameDraft` uses `PreviewSession` for suggestion/load/edit/save ownership and a separate journal task for seen state. Manual save can supersede suggestion loading; late suggestions preserve edits. Persisted unnamed intent is unchanged. |
| M11 | Folder mutation form family | Refactored — tile, project and workspace rename forms, picker and empty-folder actions use exclusive `AsyncTask` submission ownership. Each retains its own error/focus/cancellation policy. Workspace create/assign/delete share a folder task rather than a second ref lock. |
| M12 | Optimistic board persistence | Retained explicit receipt — `BoardEdit` separates unchanged/local acceptance from durable saved/failed completion. `useBoardActions` keeps optimistic history invalidation and field-limited reconciliation; overlapping board writes are preserved. |
| M13 | Action history and Undo execution | Extracted orchestration, retained history — `useActionHistory` is already one bounded owner of entries and inverse identity. Execution moved to `useProjectCommands` under a foreground lease; inverse payloads and initial-rename grouping are unchanged. |
| M14 | Folder navigation transaction | Retained explicit transaction — `FolderNavigation` owns preparation, leave, commit, enter, cancellation and final focus. Motion owns DOM animations and inert cleanup; tests cover interrupted and deleted targets. |
| M15 | Camera ownership, restore and persistence | Refactored — `CameraPlacement` / `useBoardCamera` own requested versus observed camera, reflow settling and native-scroll admission. `useBoardNavigation` owns per-folder persistence. Native focus/reveal from folder controls cannot replace the camera. Image reveal, programmatic pans and pan/wheel/keyboard intent remain supported. The existing containment regression is a required gate. |
| M16 | Workspace selection | Refactored — `workspaceSelection` reducer owns IDs, last-interacted ID and multi-select mode atomically. The intentionally retained last-interacted ID is distinct from current membership; group dragging snapshots membership at press. |
| M17 | Individual card press/drag | Refactored — `CardDragSession` owns press, Motion start, quick release, cancellation and single completion. Render flags and Motion values are projections. Setup resizing and public card props remain supported. |
| M18 | Selected-group drag | Retained dedicated owner — `useBoardGroupDrag` already snapshots membership, mounted followers and previous DOM translations in one gesture. End/unmount restores followers. Persistent positions change only at accepted completion; group-drag workflows cover cancellation and bounds. |
| M19 | Mouse/pen pan and Space hand mode | Retained native adapter — `useBoardPan` already owns one typed `PanGesture`, capture, Space ownership and release/blur/visibility reset. Hand-mode/panning flags project that state; camera movement now explicitly signals user intent to the camera owner. |
| M20 | Touch/pinch/trackpad camera takeover | Retained explicit controller — `boardGestures` plus `useBoardGestures` already separate touch/pinch/trackpad transitions from DOM capture and camera callbacks. Native CDP tests cover takeover/cancellation; Safari gesture fallback is separately tested. |
| M21 | Lasso selection | Refactored pointer ownership — lasso coordinates and pointer identity now share `PointerSession`. Move/up read synchronous gesture data; an unrelated pointer cannot complete it. Selection intersection geometry is unchanged. |
| M22 | Folder tile movement | Extracted — `useFolderGestures` owns tile movement through `PointerSession`; completion/cancel/lost capture are exclusive. The layer renders controls; the workspace persists anchors and inverse history. |
| M23 | Taking the top image out of a folder | Extracted — `useFolderGestures` separately owns press versus extraction, fitted-image grab anchor, click suppression and deferred native release. Unmount cancels the pending frame and ends the image gesture. |
| M24 | Cross-surface drop and assignment | Retained pure routing, clarified effects — `resolveImageDrop` supplies typed outcomes. Workspace folder task owns assignment; `useProjectCommands` owns durable mutation/history. Source-specific hit testing and placement remain view adapters. |
| M25 | Hold-to-create-folder | Refactored — `HoldToGroup` owns target, serial, slop, timer, readiness and cancel. The workspace supplies current hit testing and cue position. Obsolete completion cannot arm a replacement hold. |
| M26 | Browser panel visibility and resizing | Refactored — `useBrowserPanel` has collapsed/docked/expanded modes; the child view reports dimensions rather than creating another expansion owner. Native resizing uses `PointerSession` and one terminal transition. |
| M27 | Browser context, scroll and keyboard focus | Refactored — `browserSession` separates saved versus temporary import context; `BrowserScroll` owns restore/return/anchor/focus intent across collapsed DOM and virtualization. Pixel geometry stays in the browser view. Return-to-filter/scroll continuity is tested. |
| M28 | Browser ordering preparation | Extracted — `usePreparedImageOrder` owns metadata preparation and semantic-order request supersession independently. Dragging still pauses semantic reorder; order algorithms, random sequence and direction remain unchanged. |
| M29 | First-use Staging starter | Retained small one-shot owner — `useRootIntake` persists seen/count per project; `BoardStarter` has a synchronous started latch plus animation projection. It never owns saved board coordinates and unmount is its completion. |
| M30 | Random preview draft | Retained explicit draft — random preview uses `PreviewSession`, exact displayed moves, candidate revalidation and `BoardEdit`. Its native draft movement remains separate from persistence. |
| M31 | Related/text preview draft | Retained explicit draft — related/text preview uses `PreviewSession`, request supersession, debounce, fixed draft slots and acceptance receipts. Naming uses the same ownership primitive with an explicit manual-save override, not changed ranking behavior. |
| M32 | Board-wide find/add-similar | Extracted — `useWorkspaceMatching` replaces request/lock/render duplication with `AsyncTask`. It owns board-wide matching/revalidation; preview search is owned by its calling draft. Candidate scopes and placement algorithms remain unchanged. |
| M33 | Arrival, acceptance and transient feedback | Refactored transient feedback — `useTimedValue` owns notices/pulses and one atomic arrival cohort. Existing per-card WAAPI/captured-frame lifetime stays with its DOM owner; cancellation never writes positions. |
| M34 | Metadata/perceptual/color indexing | Refactored — `AnalysisSession` serializes different metadata needs, owns decoder disposal and invalidates older generations. Failed metadata flush invalidates hydration so a retry re-reads durable state; the regression test verifies a second write, not a false cached success. |
| M35 | CLIP content-index orchestration | Retained explicit index owner — `ContentIndexLifecycle` owns task/worker/drain/rebuild. `useContentAnalysis` retains progress and cache policy. CLIP enable, pause/resume, recovery and Strict Mode checks cover the separation. |
| M36 | Worker-client request protocols | Refactored — `WorkerRequests` owns IDs, timers, once-only settlement, post errors and rejecting pending requests. Each client keeps its distinct timeout and fallback/disposal contract; late disposed CLIP progress is ignored. |
| M37 | CLIP worker model and inference runtime | Retained worker owner — model-loading promises and serial inference queue already belong exclusively to `clip.worker`. GPU fallback, CPU q8 text loading, tensor cleanup and bounded text-vector cache remain distinct policies. No checkpoint, dtype, revision or inference algorithm changed. |
| M38 | Thumbnail demand, cache and decoder lifetime | Refactored resource boundary — thumbnail cache retains its existing consumer leases, generation/LRU and restart policy; RPC bookkeeping moved to `WorkerRequests` and browser decoding to `decodeImage` with idempotent URL release, abort and timeout. |
| M39 | Interrupted CLIP-session recovery | Retained tab recovery owner — `clipRecovery` owns the resident-owner set and session marker, including bfcache events and explicit retry. It intentionally outlives project mounts; recovery workflows remain its contract. |
| M40 | Disclosures and nested menu pages | Retained platform state — native `details.open` remains authoritative, with React open as its rendering projection. Existing nested menu-page unions remain local. Replacing them with a second disclosure machine would duplicate browser ownership. |
| M41 | Information hint / linked help popover | Refactored — `HintSession` owns hidden/transient/pinned phases, delayed hover, focus restoration suppression and timer cleanup. `InfoHint` handles popover geometry, reference focus and native top-layer placement. A press snapshot preserves tap intent through Safari blur/refocus; keyboard activation ignores an abandoned pointer press. |
| M42 | Modal focus and deferred action focus | Retained platform/DOM adapters — `Modal` owns a native dialog lifetime, prior sibling inert states and opener restoration. Deferred action/name focus remains next to its DOM node with timer/frame cleanup. Modal and workflow tests cover containment and restoration. |
| M43 | Original-image review and destination chooser | Extracted — `useOriginalImage` owns loading/unavailable/ready original state, stale reads and one object URL. The review destination disclosure remains a simple local toggle; its asynchronous picker has its own submission task. |
| M44 | Undo control touch and highlight | Clarified pointer ownership — Undo touch activation now uses `PointerSession`, retaining the action-ID/position snapshot and compatibility-click suppression. Its 4.5 s freshness timer remains a presentation effect with cleanup; keyboard Undo uses the command owner. |
