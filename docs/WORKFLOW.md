# FolderSort workflow

## Purpose

Sort a local image collection into named, nested stashes. Export the original images into the corresponding folders.

First user test: desktop **import → create stashes → sort → export**.

## Workspace

- **Image browser:** the whole project, with All, Unsorted and Sorted filters. Search filenames or stash names; filter a stash branch or the current board. Change image order and thumbnail size. Optionally show one to three larger focus images. Expand or collapse the browser; resize its width on desktop.
- **Board:** a free space for comparing images and arranging movable stashes. It supports pan, zoom, Fit, keyboard movement and selection.
- **Navigation:** the current stash and its parent remain accessible during selection. Opening a stash changes the board, while browser filters stay as chosen.
- **History:** Undo is always in the menu bar. Recent actions highlight it briefly; recovery does not expire with the highlight.

On small screens the browser sits below the board and can expand to fill the workspace. Export, project settings and less frequent board actions use the existing menu.

CLIP progress, statistics, pause, retry and rebuild live in **Project settings**. The active content-index badge opens those settings; it disappears when indexing finishes. There is no separate Activity page. Board-image export progress, Cancel and error dismissal stay under **Export project → Current board**. Storage and export errors still open the board menu so they remain visible on phones.

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

- Global navigation shows FolderSort, Overview and the stash ancestry. Undo and secondary project actions stay in that row.
- A separate board header contains the current board title, selection actions, zoom, Fit and Stash. Keep it stable when selection changes. Compact the controls on small screens.
- The browser starts at roughly one-third of the desktop width, with readable type and consistent thumbnail slots. Contain the full image; do not crop documents or stretch photos.
- Show short stash names in neutral captions. Preserve the full path in tooltips and project data. Selection uses the strong mint outline; assignment does not add a competing colored frame.
- Stashes use compact neutral panels, a small color identity mark and distinct direct/inclusive counts. Preserve their movable positions and top-image extraction.
- Keep dropdown styling consistent across browsers while retaining native select semantics. Respect reduced motion. Keep original images, assignments and saved layout independent from presentation preferences.

## Interaction rules

| Action | Result |
| --- | --- |
| Add or drag a browser image onto the board | Place it for comparison; keep its stash assignment. |
| Quickly drop an image over another image | Overlap them without changing assignments. |
| Hold an image over another for about 600 ms, then release | Create a stash from the dragged selection and target; name it inline. |
| Drop onto a named stash | Move the images into it, exclusively; new additions appear on top. |
| Move a stash by its handle | Move the stack's position on this board. |
| Drag the top image out of a closed stash onto the board | Move it to the current parent and place it at the drop point. |
| Drag a top image into another stash | Move its membership; put it on top. |
| Drag a top image into the Image browser | Move it to Unsorted and remove its working placement. |
| Drag a loose board image into the Image browser | Remove its working placement; keep its assignment. |
| Clear board | Remove loose working images from the current board; keep all originals and stashes. |
| Move to Unsorted | Remove stash membership explicitly. |
| Click the centre trash icon on an empty stash | Delete only that container. Undo restores its name, position and working layout. Stashes with images or sub-stashes cannot be deleted this way. |
| Delete from project in image review | Remove that project image; keep the source file. Undo can restore the project copy. |

The contextual image **+** adds similar images by content or color directly to the board. Similarity does not assign a stash. Content indexing follows the project setting, which defaults to enabled.

During hold-to-create, place the cue above the touch point with room for a finger. Fit the measured cue within the workspace and use a clear side when the upper edge leaves insufficient space. Keep the hold duration and release requirement independent of presentation.

Use the compact **Create stash** capsule: fill its background left to right across the 600 ms hold, then align the miniature images and show a check. Keep its label and size steady. Cancelling or changing targets resets the fill; a full capsule still requires release. Settle the new stack briefly before focusing its inline name. Respect reduced motion and keep the progress cue off the finger.

## Data and persistence

- One image belongs to at most one stash. Parents may contain direct images and sub-stashes.
- Assignment, stack order, working placement and image analysis are separate properties.
- Browser filters must never modify any of those properties.
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
7. Clear the board, undo the clear, then reload. Membership and saved positions remain correct.
8. Export sorted images and a project backup; inspect folders, originals and CSV. Restore the backup.
9. Browse and bulk-add 3,000 images with bounded rendered elements; confirm no invalid positions or duplicated records.
10. On touch, pinch over board images, pan, add/lift an extra finger and cancel a drag with a second finger. Confirm stable interface size, unchanged memberships/positions, working browser scrolling and restored camera after reload.

## Decisions retained for the test

- Single stash membership; no overlapping tags.
- Parent stashes can hold direct images alongside sub-stashes.
- A stash is a movable object on the free board; there is no fixed stash dock or category sidebar.
- Source-folder interpretation is an import decision. Browser ordering is only a way to browse, not an automatic assignment.
