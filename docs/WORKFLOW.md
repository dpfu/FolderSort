# FolderSort workflow

## Purpose

Sort a local image collection into named, nested stashes. Export the original images into the corresponding folders.

First user test: desktop **import → create stashes → sort → export**.

## Workspace

- **Image browser:** the whole project, with All, Unsorted and Sorted filters. Search filenames or stash names; filter a stash branch or the current board. Change image order and thumbnail size. Optionally show one to three larger focus images. Expand or collapse the browser; resize its width on desktop.
- **Every board is a folder.** Root is the original overview and contains all unsorted images and top-level stashes. A stash board contains every directly assigned image and its immediate sub-stashes. Images can be arranged freely within their folder; pan, zoom, Fit, keyboard movement and selection remain available.
- **Navigation:** the current stash and its parent remain accessible during selection. Opening a stash changes the board, while browser filters stay as chosen.
- **History:** Undo is always in the menu bar. Recent actions highlight it briefly; recovery does not expire with the highlight.

On small screens the browser sits below the board and can expand to fill the workspace. Zoom and Export move into the same bar’s ⋯ menu; project settings and less frequent board actions stay there.

CLIP progress, statistics, pause, retry and rebuild live in **Project settings**. The active content-index badge opens those settings; it disappears when indexing finishes. On compact layouts it appears as Content indexing inside ⋯. There is no separate Activity page. Board-image export progress, Cancel and error dismissal stay under **Export → Current board**. Storage and export errors still open the board menu so they remain visible on phones.

## Touch and zoom

- Drag an image with one finger. Drag empty board space with one finger to pan.
- Pinch with two fingers to zoom the board between 5% and 200%; moving both fingers pans. Keep the same world point under the finger midpoint. Ignore rotation and extra fingers.
- A second finger cancels an image or stash drag before taking over navigation. Lift all fingers before starting another image drag. Navigation must not create assignments, stashes or layout-history entries.
- Keep the workspace interface at its normal size during gestures. The image browser retains native one-finger vertical scrolling. Editable fields use at least 16px type on phones to reduce input-focus magnification.
- Trackpad pinch and Ctrl-wheel over the board use the same anchored camera. Keep ordinary wheel scrolling. Fit and zoom buttons remain available as gesture alternatives.
- Save the camera with the current stash's browser preferences. Coalesce gesture updates to animation frames and preserve thumbnail virtualization.
- Scope native-zoom suppression to the workspace. Do not add a global `user-scalable=no` or `maximum-scale` viewport restriction. Browser/OS accessibility magnification is outside the app's control.

## Visual structure

Use the [free-board visualization](https://foldersort-free-stashes.daniel-pfurtscheller.chatgpt.site/) as the desktop visual reference.

- Use one workspace bar: project return, Root and stash ancestry, a reserved image-action slot, then zoom, Undo, Export and ⋯. Do not repeat the current stash title above the canvas.
- With no selection show Select and New stash. With a selection show its count, Move to stash, Stash selected images and Deselect in that same slot. Keep navigation and utility positions stable. Zoom contains minus/plus and Fit; Export opens the real image, hierarchy and backup actions directly.
- Image-browser filters and Move here remain in the browser. Move here moves a selection into the open folder; Here marks images already in it. Move and Deselect live in the shared bar. Adding a batch keeps it selected so it can immediately become a stash. Creating a stash from the expanded browser returns to the board for inline naming. Compact labels on phones and keep complete accessible action names.
- The browser starts at roughly one-third of the desktop width, with readable type and consistent thumbnail slots. Contain the full image; do not crop documents or stretch photos.
- Show short stash names in neutral captions. Preserve the full path in tooltips and project data. Selection uses the strong mint outline; assignment does not add a competing colored frame.
- Stashes use compact neutral panels. Drag the folder-and-name header to move the stash; keep its color on the folder icon. The ⋯ disclosure holds Rename, direct image counts and totals including sub-stashes. The slim footer shows direct images and immediate sub-stashes; click it or the image stack to enter. Keep entry free of tooltips. Gently open the footer folder on hover or keyboard focus (150 ms); switch states without motion when reduced motion is requested. Touch enters immediately. Preserve movable positions and top-image extraction.
- Keep dropdown styling consistent across browsers while retaining native select semantics. Respect reduced motion. Keep original images, assignments and saved layout independent from presentation preferences.

## Interaction rules

| Action | Result |
| --- | --- |
| Add or drag a browser image onto the board | Move it into that folder, removing its previous membership. Root means Unsorted. |
| Quickly drop an image over another image | Place them together in the current folder, without creating a new stash. |
| Hold an image over another for about 600 ms, then release | Create a stash from the dragged selection and target; name it inline. |
| Drop onto a named stash | Move the images into it, exclusively; new additions appear on top. |
| Drag a stash header, or nudge it with arrow keys | Move the stack's position on this board. |
| Drag the top image out of a closed stash onto the board | Move it to the current parent and place it at the drop point. |
| Drag a top image into another stash | Move its membership; put it on top. |
| Drag a top image into the Image browser | Cancel the move; browsing is never a destination. Use Root or the parent breadcrumb to move out. |
| Drag a loose board image into the Image browser | Cancel the move and retain its folder and position. |
| Move to Unsorted | Move into Root, where the image appears on the overview board. |
| Click the centre trash icon on an empty stash | Delete only that container. Undo restores its name and position. Stashes with images or sub-stashes cannot be deleted this way. |
| Delete from project in image review | Remove that project image; keep the source file. Undo can restore the project copy. |

The contextual image **+** moves similar images by content or color into the open folder, just like other intake. Undo restores their previous folders and positions. Clear board, Clear sorted images and Remove from board are removed: folder members cannot be hidden from their boards. Content indexing follows the project setting, which defaults to enabled.

During hold-to-create, place the cue above the touch point with room for a finger. Fit the measured cue within the workspace and use a clear side when the upper edge leaves insufficient space. Keep the hold duration and release requirement independent of presentation.

Use the compact **Create stash** capsule: fill its background left to right across the 600 ms hold, then align the miniature images and show a check. Keep its label and size steady. Cancelling or changing targets resets the fill; a full capsule still requires release. Settle the new stack briefly before focusing its inline name. Respect reduced motion and keep the progress cue off the finger.

## Data and persistence

- Every image belongs to exactly one folder: Root or a stash. Parents may contain direct images and sub-stashes.
- Folder membership is the single source of truth for board contents and export. Stack order, positions within that folder and image analysis remain separate properties. Legacy `boardScope` mirrors membership; legacy hidden/borrowed locations are repaired once using saved assignments, preserving originals and valid layouts.
- Browser filters never move images or change their folder, order, layout or analysis.
- Originals, assignments, working positions and saved analysis round-trip in project backups. Sorted export includes originals in stash folders and an assignments CSV.
- Stash tile positions, camera and browser preferences are currently saved only in this browser.
- Undo records up to 50 recent edits in memory. Project switching and reload end the history.
- Large collections use virtualized views and bounded thumbnail decoding. Showing a collection must not mount one element or decode one full image per project record.

## Acceptance checks

1. Import a folder; choose whether existing subfolders become stashes.
2. Browse all images, including assigned images; filter to Unsorted and back without losing data.
3. Compare images, create two stashes, rename them and move an image between them.
4. Create and open a sub-stash; return to its parent. Confirm direct and inclusive counts.
5. Extract a top image; verify its placement and new membership. Cancelled drops keep the previous state.
6. Move an image after creating a stash. The next Undo restores the movement, keeping the stash.
7. Move a browser image into an open stash, then back to Root. Undo each move and reload. Membership, board contents and saved positions remain consistent; dragging into the browser cancels.
8. Export sorted images and a project backup; inspect folders, originals and CSV. Restore the backup.
9. Browse and bulk-add 3,000 images with bounded rendered elements; confirm no invalid positions or duplicated records.
10. On touch, pinch over board images, pan, add/lift an extra finger and cancel a drag with a second finger. Confirm stable interface size, unchanged memberships/positions, working browser scrolling and restored camera after reload.

## Decisions retained for the test

- Single stash membership; no overlapping tags.
- Parent stashes can hold direct images alongside sub-stashes.
- A stash is a movable object on the free board; there is no fixed stash dock or category sidebar.
- Source-folder interpretation is an import decision. Browser ordering is only a way to browse, not an automatic assignment.
