# Changelog

Changes to Folder Sort are recorded here with each push.

## 2026-10-16

### Performance improvements

- Replace per-byte CLIP cache conversion with native base64 and Float32Array views where supported, retaining a portable fallback and validation. Existing saved embeddings and backup bytes stay compatible. In a paired Chromium benchmark of 3,000 vectors, validation improved 24.7× (225.0 → 9.1 ms), decoding 83.4× (191.9 → 2.3 ms), and encoding 51.5× (41.2 → 0.8 ms).
- Keep idle photos out of continuous Motion layout measurement; arm the original drag controls for the active gesture. Keep memoized photo props and event identities stable while handlers read current state.
- Update thumbnails through subscriptions for individual photos and previews. Calculate visible pile slots directly while preserving manual rearrangements and offscreen selections. Reuse occupied stash geometry and image ID lists between interaction frames.
- On the generated 3,000-image fixture, median reload through saved-index status fell from 987.8 to 210.0 ms (4.7×); selection, pile scrolling and board panning use about 2.7–3.3× less main-thread CPU. These are specific measured paths, not a universal 10× claim.
- Keep arriving photo surfaces from intercepting clicks on other images; modifier double-clicks retain selection behaviour. Stabilize overview grid rows when filters are hidden and capture the actual scroll position before closing. Make the CSS-selection browser check work with vendor-prefixed properties.
- Add repeatable browser profiling and paired cache benchmarks, correctness checks for native/fallback cache bytes, targeted thumbnail notifications, visible-slot geometry and current-state callbacks. Record methodology and limits in [the performance report](docs/PERFORMANCE.md). Verification covers 104 unit/component checks, strict TypeScript/build, 78 Chromium workflows and 37 WebKit checks.

### Refactor regression checks

- Fix project refresh ordering across both the project-list read and collection read. Protect optimistic board positions and project settings from stale responses, return no stale collection to callers, and coordinate initial loading with new-project/import refreshes. Verify development Strict Mode startup.
- Restore archive support when the app goes offline before its first backup. Keep `libraryStore` as the public API, move image/stash transactions to `imageStore`, and bundle the archive implementation again. This intentionally gives back the earlier 20% entry-size reduction: the current build is 570.25 kB (179.44 kB gzip), compared with 583.51 kB before the audit. The filename and batch-layout speed improvements remain.
- Compress SVG and other uncompressed image formats in backups and sorted ZIPs; avoid redundant compression for common compressed raster formats. Verify compact SVG backups with HTTP unavailable and byte-identical SVG/PNG originals.
- Reserve `assignments.csv` when naming exported stash folders, in addition to avoiding image/subfolder collisions.
- Abort and drain failed backup image/finalization transactions, including synchronous quota errors. Leave no orphaned originals, image/stash records or incomplete published project; retain the previous active project. Apply the same atomic helper to project creation.
- Keep borrowed comparison images clear when first arranging a stash, preserving their assignment and position.
- Preserve a control already focused during workspace entry instead of overwriting it on the next animation frame.
- Keep pointer focus and browser scroll anchoring from competing with the board camera. Check pickup and release of a partly visible image.
- Wait for Add files to become enabled after project creation in import tests. Make stash browser tests wait for visible selection and an actual drag start before the hold phase; document WebKit automation limits for offline Blob reads.
- Add reproductions for each discovered failure and update [the audit report](docs/CODE_AUDIT.md), including the corrected bundle-size comparison. Verification: 98 unit/component checks, strict TypeScript/build, 78 Chromium workflows and 29 WebKit checks, including first offline exports, fresh project creation, import/backup recovery, settings/indexing, stash moves, touch/Undo and reloads.

### Code audit and refactoring

- Audit the current screens, data flow, persistence, imports/exports, background analysis, interaction code, accessibility and deployment. Record fixed findings, module responsibilities, measurements and remaining work in [the code audit](docs/CODE_AUDIT.md).
- Remove unused closed-sort, Q-sort and workflow engines, prototype stack/surface handlers, obsolete media helpers and recording/widget types. Keep the original open-board dragging, lasso, camera, keyboard selection and touch recovery. Reduce the board component from 1,150 to 426 lines; retire tests for removed engines and check the current keyboard behaviour.
- Separate the database connection, backup validation and archive operations. Load ZIP code on demand; avoid recompressing original images. Reduce startup JavaScript from 583.51 to 466.34 kB (182.33 to 148.74 kB gzip).
- Share stash geometry and batch placement between initial layouts, the board and image review. Reserve default sub-stash positions, borrowed images and existing members; calculate one grid per destination. A local 3,000-image placement calculation dropped from about 1,163 ms to 4.3 ms. Reuse numeric filename collation; a local 3,000-path sort dropped from about 106 ms to 7.8 ms. These measurements cover calculation time, not end-to-end browser latency.
- Guard asynchronous project reads against switching projects and newer refreshes. Keep concurrent settings changes when renaming a project. Abort failed per-image intake transactions, show completed imports after a later storage failure, and prevent orphaned originals.
- Reject invalid/non-finite backup metadata and duplicate paths before writes. Preserve old backup compatibility and imported feature validation. Prevent exported image filenames from colliding with sub-stash directories. Describe backup layout coverage as image positions; stash tile anchors and cameras remain browser preferences.
- Recover CLIP indexing after failed cache reads or writes; remove unsaved features from the live cache so Retry actually saves them. Dispose inference inputs after failures as well as successful runs. Validate restored camera records.
- Update the vulnerable development dependency source-map-js to 1.2.2. The dependency audit now reports zero known vulnerabilities.
- Verification: strict TypeScript and production build, 89 unit/component checks, 75 Chromium workflows and 26 WebKit checks passed. Check injected import failure/rollback, lazy archive loading, project-read races, concurrent rename/settings writes, CLIP retry/tensor cleanup, exports and 3,000-image layouts. Retain native phone touch/Undo, keyboard focus, reload and backup checks. Wait for visible selections before creating the nested stash in its browser test; that WebKit case passed three consecutive isolated runs. Inspect project, stack and phone layouts visually; run the local stack/Undo/export smoke check without page errors.

## 2026-10-15

### Stashes that work as stacks

- Put each new addition on top of its stash, including batches, source-folder imports and re-added images. Save stack order with the project and in backups; restore it with Undo.
- Drag the top image out of a closed stash onto the board, another stash or the parent pile. Click or tap it to open the stash. Inside a stash, drop an image on Back to move it to the parent and reveal it there. Keep cancelled and same-stash drops unchanged, and retain the grabbed point on wide and tall images.
- Arrange all direct images in a compact grid the first time a new stash opens. Place later additions into free slots, avoiding images and named stacks. Preserve subsequent manual arrangements and clears; retain existing positions in older projects while arranging previously hidden contents. Keep large stashes virtualized.
- Restore membership, stack order and exact board or pile placement together when undoing a stash move. Keep newer image analysis intact. Save the initialized layout in backups without changing the existing project format or hierarchy rule.
- Reserve existing stash positions before placing new stacks, so a stash created from image review cannot appear underneath another stash.
- Ignore synthesized touch clicks after pointer handling so a drag cannot also open its source stash. Check the restored membership and current view explicitly in the phone Undo test. Wait for imported images rather than a temporary status message in the pile-navigation check.
- Skip optional Node GPU-provider downloads in CI. The static app uses the browser worker and WebAssembly runtime; publishing no longer depends on downloading unused native GPU files from NuGet.
- Release the stash preview's pointer capture before saving a drop. Run native touch extraction and Undo before the full Pages test suite, and retain synthetic test traces on failure for diagnosis.
- Keep the phone test's drag and subsequent Undo tap in one native CDP touch stream, with an enabled-button check and explicit assertions for restored membership, order and view.
- Capture the native touch event sequence on a failed phone check to distinguish an input-routing failure from a failed project restore.
- Preserve native pointer-down behaviour on stash previews, matching the original card drag code. Keep drag selection and touch scrolling controlled through CSS rather than cancelling the pointer event, so the next touch tap can generate its click.
- Finish the preview's native touch release before saving a drop, and open stashes through normal button activation. Suppress activation after a drag while retaining keyboard access; cancel pending drops when the preview unmounts.
- Pace the phone test's drag moves by animation frames and use the browser's native 60 ms tap gesture for Undo. Retain the same restored-state assertions and timeouts.
- Make Undo respond to a completed touch press even when a browser omits the synthesized click after dragging. Ignore moved or cancelled presses and duplicate clicks; keep mouse and keyboard activation unchanged.
- Compile the recovery tests with the project's automatic JSX runtime.

- Verification: 104 unit tests, 74 Chromium workflows and 13 WebKit stash checks passed, including phone touch extraction, cancelled drags, nested moves, exact drop placement, stack-order Undo, reloads, backup compatibility and 3,000-image virtualization. Check touch recovery without a synthesized click, cancelled presses, duplicate suppression, keyboard activation and changed or busy actions. Inspect closed stacks, opened contents and phone layouts visually. WebKit uses isolated persistent profiles; native touch gestures are tested in Chromium.

## 2026-10-14

### Automatic content indexing

- Start CLIP automatically for the active project when Content matching is enabled. Share one worker and index between the project page, board, browser and image review; navigating no longer restarts or stops indexing. Load saved features before downloading a model, and process only missing images after imports or reloads.
- Show indexed, waiting and skipped counts, download/indexing progress, Pause, Resume, Retry and Rebuild index in project settings. Keep a small progress ring in the board menu bar that opens the same settings. Rebuild content features without changing originals, stashes, positions or visual metadata; keep existing features when switching CLIP off.
- Include saved embeddings in project backups. Pick up files added during a running index, preserve an explicit Pause across navigation and imports, and retry after the browser comes back online. Keep inference in the worker, throttle progress updates and whole-pile ordering, and hold indexing/reordering during dragging.
- Use content matching by default. Keep Content and Color in Add similar; remove the misleading Shape/pHash matching option. Retain perceptual hashing as an experimental pile order, and label aspect-ratio ordering explicitly. Refresh content previews as more embeddings become available without changing the pile order when choosing a matching method.
- Restore directory input attributes when switching projects so folder imports and backup restores keep working with the shared project session.
- Verification: 96 unit tests, 70 Chromium workflows and eight WebKit settings/index checks, including incremental indexing, cached reloads, safe rebuild, pause/disable/resume, backup compatibility, folder intake, narrow layouts and 3,000-image virtualization. Run the real CLIP model on three local test images and verify distinct saved embeddings and a cached reload without model requests.

### Project controls and content matching

- Replace the project launch slogan and percentage panel with project contents and three direct actions: Open board, Browse images and Export. Keep image intake, supported formats, settings, stash administration, backup restore and help in distinct sections. Remove repeated collection counts and the stale Board saved message on returning from the workspace.
- Extract the project screen and its settings into reusable components. Keep project names, form labels and messages direct. Reset project-specific forms and old collection data when switching projects.
- Add a Content matching (CLIP) switch to project settings, enabled by default for new and existing projects. Save the choice with the project and include it in ZIP/directory backups; older backups default to enabled. Validate imported settings before creating project records.
- Recover an interrupted settings write after an immediate reload. Keep a small local preference journal until the IndexedDB transaction finishes; replay it when opening the project list.
- Load CLIP only when a content action is used. Turning it off cancels indexing/downloads, releases the worker and removes content matching and ordering choices across the board, pile and browser. Keep color/shape matching usable. Offer the same settings from the board menu without leaving the workspace.
- Put model download and local-processing information in settings. Remove that explanation and the method jargon from the similarity popover. Keep board menus above the intake strip so they cannot cover Explore.
- Verification: 95 unit tests and 68 Chromium workflows passed, including six new settings/page checks. All six new checks also passed in WebKit using isolated persistent profiles. Verify default values, project switching, reload and backup persistence, interrupted-save recovery, cancellation/restart, content-action gating, 3,000-image virtualization and narrow/desktop layouts.

### A quieter sorting interface

- Reserve one fixed top menu bar for navigation, selection and recovery. Selecting images replaces that bar's actions with Move to stash and Create stash. Remove floating selection, zoom, Tools, export and Undo panels from the canvas; gather secondary actions under the same menu on phones and desktop.
- Keep the lower strip for image intake: a compact +, adjacent batch count, pile toggle/count, Explore and pile options. Keep the contextual + and similarity previews beside a selected image. Use distinct icons for returning images to a pile, clearing the board and downloading exports.
- Keep Undo visible in the menu bar; briefly highlight it after a reversible change, then leave it available. Put explanations in tooltips, Help and Activity. Preserve the existing latest-action Undo rule and hierarchy rule: a parent may hold direct images and sub-stashes.
- Replace the paginated project library with a link to the shared, virtualized image browser. Use one original-image reviewer and stash chooser across the board and browser. Previous/next stays within the initiating collection; changing a stash or filter does not unexpectedly close review. Keep modal focus and screen reader access within the active dialog.
- Share ZIP, folder, CSV, hierarchy and PNG export actions between project and workspace menus. Keep project management and stash administration in compact disclosures. Hide repeated membership labels within the currently open stash; keep origin cues on borrowed images.
- Create and assign stashes atomically from every entry point, with the current stash as parent and recoverable image placement. Bring selected pile images onto their new stash's board. Preserve the parent when renaming a stash from its workspace menu.
- Remove obsolete drawer, export, card-library and Undo components. Reuse menu dismissal, keyboard handling and action icons. Preserve the original board dragging, thumbnail cache and virtualization. Capture pile scroll position before collapse and retain the bottom of the collection when resizing browser thumbnails.

- Verification: 91 unit tests, 62 Chromium browser workflows and 10 WebKit menu/pile checks, including narrow phones, short landscape, keyboard focus, stash creation/moves/renaming, recovery, 3,000-image virtualization and exports. Inspect the project, board, selection, browser and image-review screens visually. WebKit checks use isolated persistent profiles because temporary profiles on this Mac cannot store image blobs.

## 2026-10-13

### Adding images from the pile

- Replace scattered board + buttons and the detached 1 / 3 / 5 controls with one persistent pile bar. Put the batch picker beside Add; changing the count does not add images. Say Add random images, Add next images, Add remaining, or Pile empty according to the available images and current order.
- Collapse thumbnails with the toggle or by pulling the divider down; keep Add, counts and Explore available. Pull up to expand, restore the previous height and browsing position, and remember collapsed state per project. Support keyboard resizing and compact phone and landscape layouts.
- Gather ordering, reverse, shuffle, thumbnail size and pane height in Pile options. Keep the expanded pile browser one click away. Within a stash, draw from its direct pile and offer Browse project in the options; preserve existing stash assignments.
- Animate a small batch from visible thumbnails or the add control with a short, staggered arrival and a quiet confirmation. Keep drag and focus geometry stable, allow images to be picked up immediately, and respect reduced motion.
- Place batches within the visible, panned and zoomed board using an index of nearby occupied areas. Keep stash stacks and floating controls clear; allow image overlap when space is tight instead of adding images off screen. Keep the camera steady and the pile virtualized, with no thumbnail cards mounted while collapsed.
- Retain the contextual + for similar images and show the batch count in its preview. Fix a Safari focus interaction that could close Pile options before a button click completed.

- Verification: 90 unit tests and 57 Chromium browser checks passed, including six new pile-intake workflows, touch dragging, 3,000-image virtualization, backup compatibility and exports. All six intake workflows also passed in WebKit using separate persistent test profiles; temporary WebKit profiles on this Mac cannot store image blobs. Inspect desktop, phone and collapsed layouts visually.

### Stash board

- Replace the category sidebar and Free / Stacks / Linked switcher with one board. Stashes appear as named image stacks; open a stash to arrange its direct images and child stashes, then return through breadcrumbs or the parent button. Remember camera, zoom and stash positions in this browser. Find the first image cluster or sub-stash when opening a stash for the first time, including images from distant parts of the board.
- Hold an image over the centre of another for 600 ms to preview a new stash. Show matching image previews, a progress ring, image count and release instruction; commit on release. Quick drops place images freely, moving away cancels grouping, and dropping onto an existing stash moves the selection into it immediately. Support batches and touch dragging.
- Name new stashes inline. Offer Create stash and a searchable Move to stash chooser for touch and keyboard use. Use stash language throughout the project, image review, pile browser and exports; remove visual links and their controls.
- Show direct image counts and counts including sub-stashes. Keep the existing hierarchy rule: each image belongs directly to one stash, and a parent may contain images alongside sub-stashes. A leaf-only hierarchy remains an open product decision.
- Scope the lower pile to Unsorted at the overview and direct stash contents inside a stash. Browse the project or add similar images to compare outside images; keep their membership until an explicit move or grouping action. Save working-board scope independently and remap it when importing a project backup.
- Create stashes and move their images in one atomic transaction. Prominent Undo restores the previous memberships and exact image positions, removes the newly created stash, and returns to the parent when undoing from inside it. Clear board keeps stash membership and originals intact. Undo covers the most recent stash creation/move, clear/return or deletion; switching projects or reloading ends it.
- Keep stash positions stable when adding images. Render only visible images and stack previews, keep thumbnail loading bounded, count and preview branches with maps, and use one bulk read for large stash creations.
- Handle a fast pointer release before the first animation frame so Safari drops are saved reliably. Cancelled drags restore the displayed position without creating a stash or changing membership.
- Keep sorted folders, CSV, stash Markdown/JSON and board PNG exports available. Retain the existing JSON schema and project backup compatibility.

- Verification: 86 unit tests and 51 Chromium browser checks passed, including touch dragging, accurate drops at multiple zoom levels, 3,000-image virtualization, backup imports, nested stashes, clear/restore, original recovery and exports. The stash workflow also passed in Safari; its fast-drop regression passed repeated runs.

### Earlier undo improvements

- Show a prominent Undo prompt after clearing the board, returning an image to the pile, changing or removing a category, and deleting an image from the project. Keep it visible without a timer, support Ctrl/Cmd+Z outside text fields, and keep Undo available when moving between the board, expanded pile, image review and project overview.
- Restore the exact board positions after clearing or returning images to the pile. Keep category membership and originals intact; restore only the fields changed by the action so newer image analysis is preserved. Apply large clears and restores in one atomic transaction.
- Use clearer action labels: Clear board, Clear sorted images, Remove category, and Delete from project. Explain what is kept and what Undo restores. Delete directly from image review with recovery of the imported original, thumbnail, category and board position; source files on the device are kept.
- Make an independent recovery copy before deletion so Undo can restore image data in Safari as well as Chromium.
- Keep a collapsed stack in view after reviewing a very large group, and honor repeated navigation to the same location after panning elsewhere.
- Undo covers the most recent category change, clear/return or deletion. A newer action of those kinds replaces it; switching projects or reloading ends this Undo history. Category Undo restores membership and keeps the current board layout. Separate arrangement Undo remains available for Gather and Tidy stacks.
- Keep the hierarchy rule unchanged: each image has one direct category, and parent categories may hold images alongside subcategories. Whether stashes should require images to live only in leaf categories remains an open product decision. Stash navigation, separate direct/total counts and the simpler stash workflow remain upcoming work.

## 2026-10-07

- Put a small + beside the selected board image. Hover or focus to preview matching thumbnails, then click to add that batch beside the image. Offer direct CLIP, color and pHash add actions in the preview; keep existing categories and avoid duplicates.
- Keep the + readable at every board zoom and the preview inside the window. Support tap-to-preview, tap-to-add and keyboard dismissal. Prevent changing the loading icon from swallowing a quick click.
- Compare image palettes locally using small cached color histograms computed alongside pHash. Reuse valid legacy hashes, update color metadata only when needed, and keep the thumbnail cache bounded.
- Start CLIP only after an explicit choice, prepare a small starter pool for the first search, and let indexing continue in the background. Reuse the exact previewed results when adding images, and let a color or pHash choice replace an add that is still waiting for CLIP.

## 2026-10-04

- Export the complete category hierarchy as a readable Markdown outline or a versioned JSON tree, with direct and nested image counts. Offer the same downloads beside categories in the workspace, expanded pile and project library, including empty categories.
- Save the visible board or the whole arrangement as a clean PNG, with image proportions, category colors, stacks and links. Include off-screen layout images, preserve assignments and positions, and leave controls and the pile out of the image. Decode previews one at a time, cap output dimensions and pixel area, show progress and allow cancellation; mark unavailable previews in the output.
- Keep floating export and Tools menus above the board and pile boundaries so their actions remain reachable in short landscape windows.

- Open the sorting workspace after the first successful image import into an empty project, after any subfolder choice. Keep later additions and restored project backups in the project library, and focus the new workspace for keyboard use.
- Resize the bottom pile with a draggable, keyboard-accessible divider or the Size controls. Adjust image size independently, remember dimensions per project in this browser, and adapt to smaller screens without overwriting the saved preference. Preserve collection position, image-fit selection outlines and accurate drops while keeping large piles virtualized.

- Exercise category focus before dragging a reviewed stack, so browser checks respect the current board camera.
- Keep stack-review browser checks reliable when an expanded stack extends beyond the visible board and its images are virtualized.

- Give the project library a clear sorting launch, progress ring, compact image import, and expandable help and project management. Carry category colors into folder controls and library images.
- Use shared colors, surfaces, control sizes, focus states and icon roles across the library, Free/Stacks/Linked boards, expanded pile, category drawers and original-image review. Make selection wording consistent, improve touch targets and retain reduced-motion support.
- Gather occasional board actions into a Tools menu. Export sorted originals and their CSV directly from the workspace as a ZIP, or into a folder where supported. Use return-to-pile icons for clearing the board and reserve the trash icon for removing an image.
- Replace persistent board-save messages with a quiet saving indicator, expire action notices, and show a completion cue once every image has a category. Keep assignment undo available in the category pane.
- Align both original-image viewers, add previous/next and arrow-key navigation to library review, and contain and restore keyboard focus in original-review and folder-import dialogs. Handle unavailable originals gracefully and offer a way to clear empty library filters.
- Share the bounded thumbnail cache between library, board and pile instead of loading full originals for library tiles. Count category branches once, compact short landscape layouts and keep pile images inside the available height.


- Add Free, Stacks, and Linked board views. Gather categories into compact stacks, spread a stack out for review, or connect a category's images visually and move them together. Switching views preserves the free-board arrangement and assignments.
- Sort by dropping onto a category stack or an already categorized image. Select a whole board category from its label, move it by dragging the label or an image, and use Tidy stacks or Gather with arrangement undo to keep the board clear. Nested categories retain their own groups and export folders.
- Add a Next unsorted batch action and optional Auto next loop in Stacks. Show project sorting progress, clearer category colors, recipient previews during dragging, and a subtle settling pulse after assignment. Respect reduced motion and prevent grouped images from bouncing back on release.
- Remember board views, stack positions, open stacks, and Auto next locally for each project. Category focus reveals the group on the board; group Explore opens its branch in the overview. Keep mobile controls reachable and prevent focus from scrolling the whole workspace sideways.
- Virtualize expanded category stacks and linked connections, keep collapsed stacks to a few image previews, and save group movements in one atomic database transaction with queued writes.
- Make category assignment the main workspace flow: select images and click or tap a category. Show the selection and larger assignment targets together in the category pane, with create-and-assign and undo.
- Select several images with Shift/Cmd/Ctrl-click, Shift-drag a board area, or use a tap-friendly selection mode. Drop the selected group on a category to assign it together; keep existing board positions and place pile images on the board.
- Assign marked images or a previewed original directly from the expanded pile. Include images already on the board in category review without adding duplicates.
- Match category colors on folder icons, image labels, and edges that follow the actual image. Highlight a category and its nested folders on the board, then explore that branch from the same view.
- Keep pile images in place during multi-selection, close the mobile category picker after assignment or focus, and restore keyboard focus after choosing a category. Add S/Shift-S selection, Escape to clear, and Cmd/Ctrl-Z for assignment undo.
- Save batch assignments atomically, queue database writes together, read large selections in one request, and count category branches in one pass. Preserve originals, image analysis, saved positions, and folder export behavior.

## 2026-10-03

- Expand the lower image pile into a full-screen, continuously scrollable overview. Switch between a loose mess and an aligned grid, resize images, jump through the collection, and browse the pile or the whole project.
- Search filenames and categories, filter category branches or unassigned images, and mark individual images, ranges, or all matches. Preview originals with previous/next navigation, then add the marked set to the sorting board without changing categories or duplicating images already there.
- Share random, metadata, pHash and CLIP ordering between the strip and overview. Preserve marks, image size, layout and browsing position when returning to the board; keep CLIP pause/resume controls available in the overview.
- Cache small thumbnails locally, decode them in a worker with a browser fallback, bound concurrent loading and retained previews, and prioritize images near the viewport. Virtualize both the expanded overview and the sorting board for large collections, including bulk additions.
- Preserve the board camera when zooming or extending the board. Keep added similar images slightly inside the visible edges.
- Add keyboard navigation and marking, focus containment, reduced-motion support, and compact controls for phone and landscape views.
- Verify added images stay inside the board with a half-pixel tolerance for browser rounding, keeping deployment checks reliable during zoom and animation.
- Add optional content similarity with MobileCLIP: order the pile by related content and use CLIP or pHash to add similar images beside selected or existing board images.
- Keep CLIP inference and matching in a worker, use hardware acceleration when available with a CPU fallback, and cache embeddings and skipped originals in browser storage and project backups. The model downloads only when needed; images stay local.
- Show CLIP indexing progress with pause, resume, and retry. Prioritize board references, pause new inference during dragging, and allow sorting and searches over the images already indexed. Use bounded similarity ordering for large datasets and release model resources when switching to pHash.
- Order the image pile by visual similarity, file modified date, file size, resolution, aspect ratio, or filename. Reverse metadata orders or shuffle back to random; + follows the selected pile order.
- Add close visual matches beside a selected board image, or use all board images as references, with the same 1 / 3 / 5 image count.
- Analyze perceptual hashes and dimensions locally on demand, using a background worker and a browser fallback. Cache the results and file dates in the project, including ZIP and folder backups.
- Keep similar additions inside the visible board and keep the pile virtualized for thousands of images. Images that cannot be decoded are skipped by similarity matching.
- Fix a startup race that could leave a project unselected when images were imported immediately after loading the app.
- Keep manually dropped images at the chosen position, including when overlapping other images or working with a zoomed and panned board.
- Keep the dragged preview attached to the part of the image you grabbed and match its size to the destination.
- Dropping a pile image onto a category now assigns it and places it near the center of the visible board. Category and placement are saved together.

## 2026-10-01

- Show common image formats beside the import controls and give a more helpful message when a folder has no supported images.
- Explain that the board's + buttons add random images from the pile.
- Label the 1, 3, and 5 options as the number of images added per + click, including on mobile.

## 2026-09-30

- Initial public release of Folder Sort.
