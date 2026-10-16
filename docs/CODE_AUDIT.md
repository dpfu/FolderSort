# Code audit — 2026-10-16

Scope: the FolderSort repository, its reachable screens, persistence, image processing, exports, accessibility, tests and Pages deployment. This is a code review with targeted regression and browser checks. It does not claim coverage of every browser, image codec or hardware configuration.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | A project rename read and wrote in separate transactions, allowing it to overwrite a concurrent settings change. | Read and update in one transaction. Add a concurrency regression. |
| High | A late collection read or failed-save refresh could overwrite a newer project selection. | Extract `useProjectLibrary`; guard collection reads by selection and request generation. Ignore older reads, including earlier reads of the same project. |
| High | Intake errors could hide already committed images until reload. An exception between asset and image writes could leave an orphaned original. | Abort and drain a failed per-image transaction; refresh completed imports after a later error. Browser check injects a storage failure and verifies one saved image, no orphan, export and reload. |
| High | CLIP kept unsaved embeddings in its live cache after a write failed, allowing Retry to report a complete index without saving those embeddings. Failed hydration also retained a rejected promise. | Remove unsaved results from the live cache on failure; allow hydration to retry. Check storage failure, retry and failed initial reads. |
| Medium | CLIP inputs were released only after successful inference. A failed inference could retain tensors. | Cover inference and fallback in the disposal block; check both successful and failed inference. |
| Medium | An image filename could match a sub-stash directory, producing an export that cannot be represented in a filesystem. | Reserve directory names when allocating filenames; verify the distinct output path and matching CSV. |
| Medium | Imported manifests accepted non-finite dates/sizes, fractional sizes and duplicate source paths. | Validate before writes or asset reads. Retain v1/v2 compatibility, validate settings/features and whitelist stash fields. Check failed-import rollback. |
| Medium | First opening a parent could lay its images over unsaved child-stack positions, pushing those stacks far below the images. | Share `stashTileGeometry` between rendering, initial grids and assignments; reserve default child positions before arranging images. |
| Medium | Reviewer assignments rebuilt the occupancy grid for every incoming image. Board and reviewer placement rules differed, including handling borrowed images. | Share `planStashAssignments`; calculate one batch per destination and reserve borrowed images, existing members and child stacks. |
| Medium | Numeric filename sorting repeatedly constructed locale options in a hot comparator. | Share one `Intl.Collator` across project image reads, folder names, stash order and archive planning. |
| Medium | ZIP compression/parsing was part of startup, and compressed image formats were recompressed during export. | Load `projectArchive` on demand; store original image bytes without recompressing them, while compressing the manifest/CSV. Browser check verifies lazy loading. |
| Medium | The board still carried unreachable closed-sort, Q-sort, setup surfaces and prototype stack interactions. | Reduce `Board` from 1,150 to 426 lines; delete unused workflow/surface/widget engines and their obsolete tests, media helpers and recording/widget types. Retain the original open-board drag, camera, lasso and keyboard behaviour. Replace retired board-target tests with current board keyboard checks. |
| Low | Malformed saved camera maps could break subsequent navigation. | Validate restored camera coordinates and zoom, ignore invalid records, retain valid navigation and legacy stash anchors. |
| Low | One transitive build/test dependency had a published denial-of-service advisory. | Update `source-map-js` from 1.2.1 to 1.2.2 in the lockfile. `npm audit` now reports zero known vulnerabilities. See [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). This dependency is in development tooling, not the delivered image-sorting runtime. |

## Structure after refactoring

| Responsibility | Main files |
| --- | --- |
| Project loading and stale-read protection | `useProjectLibrary.ts` |
| Application actions and latest-action Undo | `LibraryApp.tsx`, `UndoControl.tsx` |
| Database schema and connection | `libraryDatabase.ts` |
| Image/stash transactions and metadata merging | `libraryStore.ts` |
| Backup validation | `projectManifest.ts` |
| ZIP/directory imports and sorted exports, loaded on demand | `projectArchive.ts` |
| Open canvas, camera and lasso | `Board.tsx`, `useBoardPan.ts` |
| Sorting orchestration, intake and cross-area dragging | `SortingWorkspace.tsx` |
| Stack previews and gestures | `stashBoard.ts`, `StashBoardLayer.tsx` |
| Stack geometry and batch placement | `stashGeometry.ts`, `stashLayout.ts`, `stashPlacement.ts` |
| Virtualized collection browser and lower pile | `PileOverview.tsx`, `PileDock.tsx`, `pileLayout.ts`, `pileSizing.ts` |
| Bounded thumbnail decoding and URL lifetime | `imageThumbnails.ts`, `imageThumbnail.worker.ts` |
| Content indexing and inference | `ContentIndex.tsx`, `useContentAnalysis.ts`, `clipClient.ts`, `clip.worker.ts` |
| Color/pHash/date metadata | `useImageAnalysis.ts`, `imageAnalysisClient.ts`, `imageAnalysis.worker.ts` |
| Project, review and shared controls | `ProjectScreen.tsx`, `ProjectSettings.tsx`, `ImageViewer.tsx`, `MenuBar.tsx`, `ActionMenu.tsx`, `Modal.tsx`, `UiActions.tsx` |
| Hierarchy/CSV/PNG output | `categoryExport.ts`, `ExportActions.tsx`, `boardExport.ts` |

The database name/version and backup schema remain unchanged. `categoryId` and category-named storage functions are retained as internal compatibility names. The interface continues to use stashes. Existing Linked preferences retain saved anchors without restoring the retired Linked interface.

## Measured changes

Local production builds and synthetic calculations on the same machine:

| Measure | Before | After |
| --- | ---: | ---: |
| Startup JavaScript, minified | 583.51 kB | 466.34 kB |
| Startup JavaScript, gzip | 182.33 kB | 148.74 kB |
| Sort 3,000 numeric paths | 106.3 ms | 7.8 ms |
| Calculate placement for 3,000 incoming images in one stash | 1,162.9 ms | 4.3 ms |

Filename timing is the median of six warm local Node runs. Placement is one local synthetic calculation of the previous per-image loop versus the shared batch planner. These are computation measurements, not end-to-end latency promises. Startup excludes the separately loaded archive, PNG exporter and ML worker/runtime. The initial ML download and 118 kB stylesheet are unchanged.

## Verification

- Strict TypeScript compilation and production build.
- 89 unit/component checks, including new failure, concurrency, import/export, grid and keyboard regressions. The unit count decreased because tests for deleted prototype engines were retired; current product browser coverage was retained.
- 75 Chromium workflows: complete current product workflows, including native phone touch extraction and Undo, zoom/drop geometry, keyboard focus, nested stashes, exact restoration, backup compatibility, exports, CLIP settings/indexing and 3,000-image virtualization.
- 26 WebKit checks: stash, menu, settings/indexing and intake recovery in isolated persistent profiles. Native CDP touch gestures are Chromium-only; WebKit uses its normal pointer workflows.
- Visual inspection of synthetic project, stack, open-board and phone layouts; local and deployed smoke checks.

The nested-selection check now waits for each visible selection before creating its stash; this removes an observed WebKit test timing race and verifies that all three selected images enter the stash. It passed three consecutive isolated runs. The Pages workflow repeats the unit, build, native touch and full Chromium gates before publishing.

## Remaining work and decisions

1. **Large archive memory use.** ZIPs are still assembled/decompressed in memory. Directory export writes files incrementally where the browser supports the directory picker. Very large projects can exceed memory or browser storage quota. A streaming archive worker with progress/cancellation is the next export improvement; it needs explicit cross-browser testing.
2. **Sorting workspace responsibilities.** `SortingWorkspace.tsx` remains about 1,060 lines and combines intake, similarity requests, camera navigation and drag coordination. Extract those into focused hooks in separate steps, retaining the existing native touch and exact-placement checks. Avoid rewriting pointer handling in one pass.
3. **Stylesheet layering.** Old library, sidebar and floating-toolbar rules remain beneath newer shell overrides. Consolidate by screen and remove verified dead selectors, with desktop, phone and short-landscape visual comparisons. This audit leaves the appearance stable.
4. **Multiple open tabs.** Transactions protect writes, but the UI does not synchronize project changes across tabs. Consider a single-writer notice or explicit change notifications before advertising simultaneous editing. CoLabSort is a separate application and was not audited here.
5. **Backup scope.** Backups save originals, features, assignments, image positions and initialization/order flags. Stash tile anchors, cameras and pile size remain browser preferences. Help now says “image positions” instead of promising all board layout. Full view-preference portability needs a deliberate schema extension.
6. **Hierarchy and Undo remain product decisions.** Images still have exactly one direct stash. Parents may hold direct images and sub-stashes. Undo remains the latest reversible action for the current session; switching projects or reloading ends it. Neither rule was changed during refactoring.
7. **Platform limits.** The real model/GPU/decoder matrix, Firefox, low-memory mobile devices and storage eviction are not exhaustively tested by this audit. UI inference checks use deterministic worker fixtures; tensor lifecycle tests isolate inference failures. Model/runtime versions stay pinned.
