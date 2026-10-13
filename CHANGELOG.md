# Changelog

Changes to Folder Sort are recorded here with each push.

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
