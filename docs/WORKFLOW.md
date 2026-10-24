# FolderSort workflow

## Purpose

Sort a local image collection into named, nested stashes. Export the original images into the corresponding folders.

First user test: desktop **import → create stashes → sort → export**.

## Workspace

- **Image browser:** the whole project, with All, Unsorted and Sorted filters. Search filenames or stash names; filter a stash branch or the current folder's direct members. In this folder only includes waiting Root images and excludes sub-stash members. On board marks images placed on the current working surface. Change image order and thumbnail size. Optionally show one to three larger focus images. Expand or collapse the browser; resize its width on desktop. Retain order, direction, random sequence and scroll position when reopening or reloading.
- **Root is the working overview.** New unsorted imports wait in the image browser until added in batches or individually. Root shows those added images and top-level stashes. A stash board contains every directly assigned image and its immediate sub-stashes. Adding to a stash always moves membership there; stash boards never contain borrowed images. Existing saved Root layouts remain visible.
- **Navigation:** the current stash and its parent remain accessible during selection. Opening a stash changes the board, while browser filters stay as chosen.
- **History:** Undo is always in the menu bar. Recent actions highlight it briefly; recovery does not expire with the highlight.

On small screens the browser sits below the board and can expand to fill the workspace. Zoom and Export move into the same bar’s ⋯ menu; project settings and less frequent board actions stay there.

### First batch

An empty new Root offers one centred starter: **Let’s start with [3] random images**. The number picker accepts 1–24, bounded by the available unsorted images. Three small previews show the first images in that sample. The add action commits immediately; the starter contracts over 140 ms while the photos arrive in a short stagger. Respect reduced motion. Dismissal, selecting images manually or adding a batch completes the welcome for that project; Undo and reopening do not repeat it.

Afterwards, **Add random** and its compact number picker live in the browser footer when nothing is selected. Draw only unsorted images not already on Root that match the active browser filters. The waiting count follows those filters; Sorted, a stash-only filter or an unmatched search disables random intake. Choosing filters completes the first-use starter so it cannot add images hidden by the chosen view. Selected queued images use **Add to board**; existing board images use **Show on board**. Creating a stash works directly from the browser too. Importing more images stages them without disturbing the working board.

On the project screen, clicking a stash name opens that stash's board, including for nested or empty stashes. Keep Rename in a separate stash action menu. Rename edits the final name while retaining its parent; show validation errors in the dialog.

Adding a mixed selection keeps the entire group selected, including images already on that board. Only missing members move or receive new positions. Creating a stash afterwards uses the whole group. Initial naming belongs to stash creation; every later Rename has its own Undo action. Accepting the default name or cancelling the naming form ends initial naming too.

The folder-import choice reports the total supported images, the subset in subfolders and any images in the main folder separately. Unsupported files do not count as images.

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
- Image-browser filters and Move here remain in the browser. Move here names the destination and uses the folder-arrow icon. For selections already in this folder it becomes Show on board, which frames the selection without changing membership, positions or Undo. On board marks placed images; folder filtering uses membership, including queued Root images. Move and Deselect live in the shared bar. Creating a stash from browser selections puts it in the visible board without jumping to their old positions. Creating from the expanded browser returns to the board for inline naming.
- Select all in the browser replaces the selection with the filtered results; it does not retain hidden selections from other folders. Apply the batch in one state update, including for large collections.
- The browser starts at roughly one-third of the desktop width, with readable type and consistent thumbnail slots. Contain the full image; do not crop documents or stretch photos.
- Show short stash names in neutral captions. Preserve the full path in tooltips and project data. Selection uses the strong mint outline; assignment does not add a competing colored frame.
- Stashes use compact neutral panels. Drag the folder-and-name header to move the stash; keep its color on the folder icon. The ⋯ disclosure holds Rename, direct image counts and totals including sub-stashes. The slim footer shows direct images and immediate sub-stashes; click it or the image stack to enter. Keep entry free of tooltips. Gently open the footer folder on hover or keyboard focus (150 ms); switch states without motion when reduced motion is requested. Touch enters immediately. Preserve movable positions and top-image extraction.
- Keep dropdown styling consistent across browsers while retaining native select semantics. Respect reduced motion. Keep original images, assignments and saved layout independent from presentation preferences.

## Interaction rules

| Action | Result |
| --- | --- |
| Add or drag a browser image onto the board | Move it into that folder, removing its previous membership. Root means Unsorted. |
| Show on board | Reveal selected members in place. Change only the camera; do not add a history entry. |
| Quickly drop an image over another image | Place them together in the current folder, without creating a new stash. |
| Hold an image over another for about 600 ms, then release | Create a stash from the dragged selection and target; name it inline. |
| Drop onto a named stash | Move the images into it, exclusively; new additions appear on top. |
| Drag a stash header, or nudge it with arrow keys | Move the stack's position on this board. |
| Drag the top image out of a closed stash onto the board | Move it to the current parent and place it at the drop point. |
| Drag a top image into another stash | Move its membership; put it on top. |
| Drag a top image into the Image browser | Cancel the move; browsing is never a destination. Use Root or the parent breadcrumb to move out. |
| Drag a loose board image into the Image browser | Cancel the move and retain its folder and position. |
| Move to Unsorted | Move into Root, where the image appears on the overview board. |
| Delete empty stash from a stash menu, its centre trash icon, or the project list | Delete only that empty container. Inside it, return to its parent. Undo restores its name and position. Stashes with images or sub-stashes cannot be deleted this way, including parents whose sub-stashes are empty. |
| Delete from project in image review | Remove that project image; keep the source file. Undo can restore the project copy. |

On Root, similarity first adds unsorted matches waiting in the browser, with Undo. When no queued images remain, Find selects and reveals existing matches without changing folders, positions or history. Inside a stash it uses the folder-arrow icon and Move by content or color. Only unsorted images are candidates by default. Include other stashes is an explicit option, reset on navigation; show each match's current stash in the preview. Recheck eligibility after asynchronous matching. Undo restores previous folders and positions after moves. Clear board, Clear sorted images and Remove from board remain removed. Content indexing follows the project setting, which defaults to enabled.

Export names its scope: Entire project · images + CSV includes all images, shows the total and unsorted count, and explains that unsorted originals go into `_Unassigned`. Current board names the open folder and offers visible/whole-board PNGs. Stash hierarchy and project backup remain separate export sections.

During hold-to-create, place the cue above the touch point with room for a finger. Fit the measured cue within the workspace and use a clear side when the upper edge leaves insufficient space. Keep the hold duration and release requirement independent of presentation.

Use the compact **Create stash** capsule: fill its background left to right across the 600 ms hold, then align the miniature images and show a check. Keep its label and size steady. Cancelling or changing targets resets the fill; a full capsule still requires release. Settle the new stack briefly before focusing its inline name. Respect reduced motion and keep the progress cue off the finger.

## Data and persistence

Search and folder filters remain visible as removable chips when Filters is closed. After a matching group is sorted, Continue with unsorted clears the selection and those restrictive filters, retaining Unsorted across the whole project. Images selected on the current board keep their useful selection and are labelled on board. Root can be found by either Root or Unsorted in the move chooser. Rename errors belong beside the name; they do not open Board actions.

Inside a stash, Unsorted plus In this folder only explains the empty result rather than presenting it as completed sorting. Show this stash’s images switches to All and keeps the current-folder filter. Continue with unsorted explicitly switches to the project-wide queue. Neither action changes memberships or image positions.

New stashes are placed within the actual board viewport after saving. Returning from a stash minimally reveals its stack, preserving its anchor and the saved zoom whenever it fits. Desktop Fit is directly available in the single menu bar; mobile keeps it under Board view.

- Every image belongs to exactly one folder: Root or a stash. Parents may contain direct images and sub-stashes.
- Folder membership owns stash contents and export. Root additionally records whether an unsorted image has been added to its working surface (`rootOnBoard`); missing values preserve legacy boards. Queue state, originals, positions and analysis survive Undo and backups. Legacy `boardScope` still mirrors membership, never an independent stash location.
- Browser filters never move images or change their folder, order, layout or analysis. Browser order and position are local viewing preferences, saved separately from project data; scroll preference writes wait for scrolling to settle.
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
11. With queued images, Root similarity adds only unsorted candidates and Undo returns them to the browser. With no queue, Find only reveals existing matches. In a stash, matching excludes other stashes until explicitly included; check preview origins and Undo.
12. Select an off-screen folder member and Show on board. Create a stash from browser-selected off-screen images; confirm the new tile is visible and the camera stays steady. Fit, enter/return and reopen the project; retain the saved view.
13. Start from a blank Root, change the default count, add a random batch, Undo and reload. The welcome must not return. Try a small collection, skip to manual intake, create a stash, draw another batch and export every original, including queued images.
14. Search for Root and Unsorted in the move chooser. Try a duplicate and blank stash name; keep validation local and recover without opening Board actions. Delete an empty stash from its tile menu, inside it and from the project list; Undo and reload. Protect populated stashes and parents with empty children.
15. Close Filters while a query is active; keep it visible and removable. Move the last matching unsorted group into a stash, then Continue with unsorted. Clear the finished selection and query, retain Unsorted and show the remaining project images. Double-click a filtered image in the expanded browser without losing the thumbnail area.
16. Select two existing board images and two waiting images, then Add. Keep all four selected and the existing positions unchanged. Create a stash with all four. Rename it again; Undo restores the previous name and keeps its contents. A second Undo reverses creation.
17. Combine Unsorted with the current-folder filter inside a stash. Show its direct images locally, then continue with the global unsorted queue; keep memberships unchanged. Import a folder containing both loose and nested images and verify the separate counts before choosing how to start.

## Decisions retained for the test

- Single stash membership; no overlapping tags.
- Parent stashes can hold direct images alongside sub-stashes.
- A stash is a movable object on the free board; there is no fixed stash dock or category sidebar.
- Source-folder interpretation is an import decision. Browser ordering is only a way to browse, not an automatic assignment.
