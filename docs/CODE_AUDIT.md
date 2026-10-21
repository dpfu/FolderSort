# Code audit — 2026-10-16

Scope: the FolderSort repository, its reachable screens, persistence, image processing, exports, accessibility, tests and Pages deployment. This is a code review with targeted regression and browser checks. It does not claim coverage of every browser, image codec or hardware configuration.

Subsequent performance measurements and their reproducible benchmarks are in [PERFORMANCE.md](PERFORMANCE.md). The sizes and timings below describe the earlier audit/recheck builds.

## Image browser workflow — 2026-10-21

The sorting workspace now has a project-wide Image browser beside the original free board. Browser filters do not follow the current stash; assignment and board placement remain separate fields. The mobile layout keeps the browser below the board. The replaced pile dock, modal overview and sizing code have been removed.

The orchestration component is reduced from 1,075 to about 790 lines. Responsibilities extracted in this pass:

| Responsibility | Module |
| --- | --- |
| Browser filtering, search, virtualization, focus images and sizing | `ImageBrowser.tsx`, `imageBrowserView.ts` |
| Shared browser/board selection | `useWorkspaceSelection.ts` |
| Stash scope, camera persistence and render window | `useBoardNavigation.ts`, `stashView.ts` |
| Placement planning and arrival animation | `useImageIntake.ts` |
| Optimistic placement/clearing and persistence | `useBoardActions.ts` |
| Bounded project action history | `useActionHistory.ts` |
| Stash anchor persistence and recovery across workspace mounts | `useBoardPreferences.ts` |

History now records ordinary image and stash movements as well as assignment, clear and deletion. Undo restores changed fields only; a later analysis result is preserved. Naming a newly created stash updates the creation entry using typed data rather than parsing a notification. Failed optimistic writes invalidate dependent history entries. History remains in memory and ends on project switch or reload.

Regression checks found and fixed three integration problems: narrow-board bulk placement exceeding the store's coordinate limit; competing thumbnail demands from the browser and board; and arrival surfaces intercepting other controls after their old stylesheet was retired. Thumbnail consumers now hold separate interests in the shared bounded cache. The original drag, touch, worker processing and transactional storage paths remain in use.

A pre-push verification reproduced two additional regressions. A stash-position inverse closed over an unmounted workspace, so undoing after reopening changed storage without updating the visible board. Anchor recovery now notifies the currently mounted board for that project and merges only the restored anchor. Browser keyboard navigation previously searched only the small thumbnails; it now follows the rows of both the large focus images and the continuous grid. Both failures have browser regressions, and the anchor hook also checks remounts, unrelated anchors and project isolation.

The remaining coordinator still handles cross-area gestures, similarity search and export orchestration. Further extraction should follow a concrete change or reproduced bug. Image positions and stash membership round-trip in backups; camera positions, browser preferences and stash tile anchors remain browser preferences.

Agreed workflow and acceptance criteria are in [WORKFLOW.md](WORKFLOW.md).

Verification for this pass: strict TypeScript and production build, 108 unit/component tests, 69 Chromium workflows, and Firefox/WebKit smoke flows in persistent profiles. Retain exact-placement, native touch, clear/Undo across workspace exits, storage failure, backup, CSV/PNG and 3,000-image checks. The retired dock/modal cases are replaced by Image browser cases. The UI benchmark now measures vertical browser scrolling; that metric is not directly comparable to the former horizontal pile scroll.

## Refactor recheck

A second review reproduced and fixed regressions in the first pass, plus missed edge cases:

- The project-read guard did not cover the project-list await or optimistic local updates. Separate versions now protect project summaries and collections from older responses, and coordinate the initial load with an explicit new-project/import refresh. Stale reads no longer overwrite newer names/settings or board positions. Development Strict Mode replay is covered.
- The lazy archive split made a first backup fail after the app went offline. Archive support is bundled again through the public `libraryStore` facade; `imageStore` contains the transaction implementation. **The earlier 20% startup-size reduction no longer applies.** The recheck entry was 570.25 kB (179.44 kB gzip), versus 583.51 kB before the audit. Filename and batch-placement improvements remain.
- Storing every image without ZIP compression made SVG-heavy backups substantially larger. PNG/JPEG/GIF/WebP/AVIF/HEIC/HEIF retain the fast path; SVG and other formats use compression. Backup checks with HTTP unavailable verify exact SVG/PNG contents and compact output.
- Do not let the scheduled workspace-entry focus overwrite a control the user has already focused; this affected a quick keyboard resize after opening the board.
- Give pointer focus `preventScroll` and disable scroll anchoring on the canvas so the board camera owns its position. Check pickup and release of a partly visible image as well as the selected-batch grouping gesture.
- Stash folders now also avoid the root `assignments.csv` filename. This closes the remaining file/folder collision case.
- A synchronous image or metadata write failure during backup restore could leave an orphaned asset or publish an incomplete project. Abort and drain both transactions before cleanup; retain the previous active project. Use the same transaction helper for project creation.
- First-open grids now reserve borrowed comparison images as well as direct members and child stash tiles, without changing the borrowed image's assignment or position.

Each failure was reproduced before its fix. The recheck retains the existing database/backup versions, project compatibility and stash/Undo rules.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | A project rename read and wrote in separate transactions, allowing it to overwrite a concurrent settings change. | Read and update in one transaction. Add a concurrency regression. |
| High | A late collection read or failed-save refresh could overwrite a newer project selection. | Extract `useProjectLibrary`; guard project summaries and collections independently, including optimistic local writes and initial project loading. Ignore older reads and stale return values. |
| High | Intake errors could hide already committed images until reload. An exception between asset and image writes could leave an orphaned original. | Abort and drain a failed per-image transaction; refresh completed imports after a later error. Browser check injects a storage failure and verifies one saved image, no orphan, export and reload. Backup restore also checks failed image/metadata writes without changing the active project. |
| High | CLIP kept unsaved embeddings in its live cache after a write failed, allowing Retry to report a complete index without saving those embeddings. Failed hydration also retained a rejected promise. | Remove unsaved results from the live cache on failure; allow hydration to retry. Check storage failure, retry and failed initial reads. |
| Medium | CLIP inputs were released only after successful inference. A failed inference could retain tensors. | Cover inference and fallback in the disposal block; check both successful and failed inference. |
| Medium | An image filename could match a sub-stash directory, producing an export that cannot be represented in a filesystem. | Reserve directory names when allocating filenames; verify the distinct output path and matching CSV. |
| Medium | Imported manifests accepted non-finite dates/sizes, fractional sizes and duplicate source paths. | Validate before writes or asset reads. Retain v1/v2 compatibility, validate settings/features and whitelist stash fields. Check failed-import rollback. |
| Medium | First opening a parent could lay its images over unsaved child-stack positions, pushing those stacks far below the images. | Share `stashTileGeometry` between rendering, initial grids and assignments; reserve default child positions before arranging images. |
| Medium | Reviewer assignments rebuilt the occupancy grid for every incoming image. Board and reviewer placement rules differed, including handling borrowed images. | Share `planStashAssignments`; calculate one batch per destination and reserve borrowed images, existing members and child stacks. |
| Medium | Numeric filename sorting repeatedly constructed locale options in a hot comparator. | Share one `Intl.Collator` across project image reads, folder names, stash order and archive planning. |
| Medium | ZIP compression/parsing was part of startup, and compressed image formats were recompressed during export. | The first pass loaded `projectArchive` on demand. The recheck restores bundled archive support for offline use and keeps selective raster compression avoidance. SVG, manifests and CSV remain compressed. |
| Medium | The board still carried unreachable closed-sort, Q-sort, setup surfaces and prototype stack interactions. | Reduce `Board` from 1,150 to 426 lines; delete unused workflow/surface/widget engines and their obsolete tests, media helpers and recording/widget types. Retain the original open-board drag, camera, lasso and keyboard behaviour. Replace retired board-target tests with current board keyboard checks. |
| Low | Malformed saved camera maps could break subsequent navigation. | Validate restored camera coordinates and zoom, ignore invalid records, retain valid navigation and legacy stash anchors. |
| Low | One transitive build/test dependency had a published denial-of-service advisory. | Update `source-map-js` from 1.2.1 to 1.2.2 in the lockfile. `npm audit` now reports zero known vulnerabilities. See [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). This dependency is in development tooling, not the delivered image-sorting runtime. |

## Structure after refactoring

| Responsibility | Main files |
| --- | --- |
| Project loading and stale-read protection | `useProjectLibrary.ts` |
| Application actions and recent-action Undo | `LibraryApp.tsx`, `useActionHistory.ts`, `useBoardActions.ts`, `UndoControl.tsx` |
| Database schema, connection and transaction failure helper | `libraryDatabase.ts` |
| Public persistence API | `libraryStore.ts` |
| Image/stash transactions and metadata merging | `imageStore.ts` |
| Backup validation | `projectManifest.ts` |
| ZIP/directory imports and sorted exports, bundled for offline availability | `projectArchive.ts` |
| Open canvas, camera and lasso | `Board.tsx`, `useBoardPan.ts` |
| Sorting orchestration and cross-area dragging | `SortingWorkspace.tsx`; navigation, selection and intake hooks listed above |
| Stack previews and gestures | `stashBoard.ts`, `StashBoardLayer.tsx` |
| Stack geometry and batch placement | `stashGeometry.ts`, `stashLayout.ts`, `stashPlacement.ts` |
| Virtualized collection browser | `ImageBrowser.tsx`, `imageBrowserView.ts`, `pileLayout.ts` |
| Bounded thumbnail decoding and URL lifetime | `imageThumbnails.ts`, `imageThumbnail.worker.ts` |
| Content indexing and inference | `ContentIndex.tsx`, `useContentAnalysis.ts`, `clipClient.ts`, `clip.worker.ts` |
| Color/pHash/date metadata | `useImageAnalysis.ts`, `imageAnalysisClient.ts`, `imageAnalysis.worker.ts` |
| Project, review and shared controls | `ProjectScreen.tsx`, `ProjectSettings.tsx`, `ImageViewer.tsx`, `MenuBar.tsx`, `ActionMenu.tsx`, `Modal.tsx`, `UiActions.tsx` |
| Hierarchy/CSV/PNG output | `categoryExport.ts`, `ExportActions.tsx`, `boardExport.ts` |

The database name/version and backup schema remain unchanged. `categoryId` and category-named storage functions are retained as internal compatibility names. The interface continues to use stashes. Existing Linked preferences retain saved anchors without restoring the retired Linked interface.

## Measured changes

Local production builds and synthetic calculations on the same machine:

| Measure | Before audit | First pass | After recheck |
| --- | ---: | ---: | ---: |
| Startup JavaScript, minified | 583.51 kB | 466.34 kB | 570.25 kB |
| Startup JavaScript, gzip | 182.33 kB | 148.74 kB | 179.44 kB |
| Sort 3,000 numeric paths | 106.3 ms | 7.8 ms | Algorithm unchanged |
| Calculate placement for 3,000 incoming images in one stash | 1,162.9 ms | 4.3 ms | Algorithm unchanged |

Filename timing is the median of six warm local Node runs. Placement is one local synthetic calculation of the previous per-image loop versus the shared batch planner. These are computation measurements, not end-to-end latency promises. Startup now includes archive support; the PNG exporter and ML worker/runtime remain separate. The initial ML download and 118 kB stylesheet are unchanged.

## Verification

- Strict TypeScript compilation and production build.
- 98 unit/component checks, including new failure, concurrency, import/export, grid and keyboard regressions. The unit count decreased because tests for deleted prototype engines were retired; current product browser coverage was retained.
- 78 Chromium workflows: complete current product workflows, including native phone touch extraction and Undo, zoom/drop geometry, keyboard focus, nested stashes, exact restoration, backup compatibility, exports, CLIP settings/indexing and 3,000-image virtualization.
- 29 WebKit checks: stash, menu, settings/indexing and intake recovery in isolated persistent profiles. Native CDP touch gestures are Chromium-only; WebKit uses its normal pointer workflows.
- Visual inspection of synthetic project, stack, open-board and phone layouts; local and deployed smoke checks.

Import tests wait for the visible Add files action to be enabled after creating a project; hidden-input uploads had bypassed the disabled interface. Stash drag tests now wait for an actual drag to start before moving onto the target, so Motion receives the same gesture phases as a normal pointer interaction. The nested-selection check waits for each visible selection before creating its stash; this removes an observed WebKit test timing race and verifies that all three selected images enter the stash. It passed three consecutive isolated runs. The Pages workflow repeats the unit, build, native touch and full Chromium gates before publishing.

WebKit uses isolated persistent profiles because this automation build cannot persist readable IDB Blobs in ephemeral profiles. Its `setOffline(true)` also makes native FileReader and Blob.arrayBuffer reads fail on saved assets, independent of the archive code. The image-containing backup check therefore blocks HTTP requests while allowing local Blob reads; the empty first-backup check additionally uses the offline toggle. Physical offline Safari behaviour remains a manual platform check.

## Remaining work and decisions

1. **Large archive memory use.** ZIPs are still assembled/decompressed in memory. Directory export writes files incrementally where the browser supports the directory picker. Very large projects can exceed memory or browser storage quota. A streaming archive worker with progress/cancellation is the next export improvement; it needs explicit cross-browser testing.
2. **Sorting workspace responsibilities.** The Image browser pass extracted selection, navigation, intake and history; the coordinator is now about 800 lines. Cross-area gestures, similarity requests and export orchestration remain. Extract further when a concrete change needs it, retaining the native touch and exact-placement checks.
3. **Stylesheet layering.** Old library, sidebar and floating-toolbar rules remain beneath newer shell overrides. Consolidate by screen and remove verified dead selectors, with desktop, phone and short-landscape visual comparisons. This audit leaves the appearance stable.
4. **Multiple open tabs.** Transactions protect writes, but the UI does not synchronize project changes across tabs. Consider a single-writer notice or explicit change notifications before advertising simultaneous editing. CoLabSort is a separate application and was not audited here.
5. **Backup scope.** Backups save originals, features, assignments, image positions and initialization/order flags. Stash tile anchors, cameras and Image browser preferences remain local. Full view-preference portability needs a deliberate schema extension.
6. **Hierarchy and Undo.** Images still have one direct stash; parents may hold direct images and sub-stashes. The Image browser pass changed Undo to a bounded history of recent edits, including ordinary movement. Switching projects or reloading ends that history.
7. **Platform limits.** The real model/GPU/decoder matrix, Firefox, low-memory mobile devices and storage eviction are not exhaustively tested by this audit. UI inference checks use deterministic worker fixtures; tensor lifecycle tests isolate inference failures. Model/runtime versions stay pinned.
