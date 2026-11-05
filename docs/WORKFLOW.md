# FolderSort workflow

## Purpose

Sort a local image collection into named, nested folders. Export the original images into the corresponding folders.

First user test: desktop **import → create folders → sort → export**.

## Terminology

| Former label | Current label | Meaning |
| --- | --- | --- |
| Stash / stashes | Folder / folders | Each image has one location; a folder can contain images and subfolders. |
| Sub-stash | Subfolder | A folder inside another folder. |
| Stash selected images | New folder | Create a folder containing the selection. The accessible label includes the image count. |
| Move to stash | Move to folder | Change the selected images’ folder. |
| Enter / browse stash | Open folder | Navigate into it without moving images. |
| Content similarity | Subject similarity | Compare normalized MobileCLIP image embeddings using cosine similarity; related subjects and scenes are suggestions, not labels or classifications. |
| Visual similarity | Pattern similarity | Compare 64-bit DCT perceptual hashes of a 32×32 grayscale sample using Hamming distance. The browser orders images by a nearest-neighbor walk. |
| By color | Color | Compare 48-bin RGB color histograms, independent of where colors occur. |

Use **Staging** for the working board of unsorted images and top-level folders. Imported images first wait in the browser; they are not yet staged. **Image browser** is a project-wide view; **board** is the working surface for the open folder. A folder tile shows direct image counts and immediate subfolder counts. Totals that include subfolders say so explicitly.

Folders match nesting, exclusive membership and exported directories. Collections suggests images could belong to multiple groups; stacks describes only the overlapping preview. Opening, moving images and moving the folder tile remain distinct actions. Their Undo labels are **Undo image move** and **Undo folder move** respectively.

The vocabulary changes affect display copy. Filename ordering separately uses the filename alone, as requested; original paths remain intact. Existing names, identifiers, database keys, discriminants, algorithm versions, saved order values, backup/JSON/CSV schemas and legacy export filenames are retained. Markdown prose and board-image captions use the current vocabulary.

## Workspace

- **Image browser:** starts collapsed for new projects. Reopening a project keeps the saved panel preference; Explore images opens it directly. Shows the whole project, with All, Unsorted and Sorted filters. Search filenames or folder names; filter a folder branch or the current folder's direct members. Inside a folder, Current folder only excludes subfolder members. On Staging this option is called Unsorted only, including waiting and staged images. On board marks images placed on the current working surface. Change image order and thumbnail size. Optionally show one to three large previews. Expand or collapse the browser; resize its width on desktop. Retain order, direction, random sequence and scroll position when reopening or reloading.
- **Staging is the working overview.** New unsorted imports wait in the image browser until added in batches or individually. Staging shows those added images and top-level folders. A folder board contains every directly assigned image and its immediate subfolders. Adding to a folder always moves membership there; folder boards never contain borrowed images. Existing saved Staging layouts remain visible.
- **Navigation:** the current folder and its parent remain accessible during selection. Opening a folder changes the board, while browser filters stay as chosen.
- **History:** Undo is always in the menu bar. Recent actions highlight it briefly; recovery does not expire with the highlight.

Select board images with Shift-click or a lasso, then drag any selected image to move the group. All visible members follow the pointer with their spacing intact, including when zoomed or reaching the board boundary. Save the layout once on release and restore the entire move with one Undo. Escape or a cancelled touch restores the group. Dropping folder members in the image browser cancels; dropping staged images there returns the group to waiting. Dropping the selected group into a folder moves its images into that folder.

On small screens the browser sits below the board and can expand to fill the workspace. Zoom and Export move into the same bar’s ⋯ menu; project settings and less frequent board actions stay there.

### First batch

An empty new Staging offers one centred starter: **Let’s start with [3] random images**. The number picker accepts 1–24, bounded by the available unsorted images. Three small previews show the first images in that sample. The add action commits immediately; the starter contracts over 140 ms while the photos arrive in a short stagger. Respect reduced motion. Dismissal, selecting images manually or adding a batch completes the welcome for that project. Emptying Staging, Undo and reopening do not repeat it; the bottom batch control remains available instead. Existing folder tiles are never covered by the starter.

After the first-use starter, the bright mint **＋ Preview 3 random images** control stays at the bottom of Staging, including with selected images and a collapsed browser. Its count is adjustable from 1–24 and starts at 3. It previews only waiting, unsorted images matching the browser filters; accept with + Add 3; Reset filters recovers when none match. It is hidden inside folders. Choose more images in the browser or use the selected image’s **+** to preview related images beside it. Accept the preview group to add it to Staging or move it into the open folder. The **−** beneath it removes that image to the unsorted waiting queue. Staging uses a charcoal canvas with neutral dots; named folders retain the green canvas and dots. Board PNGs use the same scope-specific backdrop. Selected queued images use **Add to staging**; existing board images use **Locate on board**. Creating a folder works directly from the browser too. Importing more images queues them without disturbing the working board. **Remove from staging** returns selected staged images to the queue; dropping staged images back into the browser does the same. One Undo restores the whole batch and its positions. Folder tiles remain. In a named folder, **Remove from “Folder name”** returns its selected direct members to the same unsorted waiting queue. The selected image has a large − directly below similarity’s +, with the same location-specific meaning; the menu bar uses Image minus. Undo restores folder membership, stack order and exact positions. Removal does not delete originals or the folder itself.

Check supported files and duplicate source paths before creating import folders. Reimporting only known images changes neither folders nor assignments. For a mixed import, create source folders only for new supported originals and report duplicate paths separately from unsupported files.

After import, **Show imported images** on the project screen opens a temporary browser view containing that batch. Keep the current board and assignments. Label the temporary filter **Imported N**; removing it restores the previous filters and scroll position. Returning to the regular board also retains the saved browsing context. Explicitly choosing a new assignment/search filter ends the temporary view. Keep this shortcut for the last successful import during the project session.

With **All + Current folder only**, distinguish an actually empty folder from a folder with subfolders but no direct images. A browser with no selection offers no disabled Move to [folder] action; reserve stable space so selecting images does not shift the thumbnail grid. After deleting the current empty folder, return to its parent and focus the available Undo action once saving finishes.

On the project screen, clicking a folder name opens that folder's board, including for nested or empty folders. Keep Rename in a separate folder action menu. Rename edits the final name while retaining its parent; show validation errors in the dialog.

Adding a mixed selection keeps the entire group selected, including images already on that board. Only missing members move or receive new positions. Creating a folder afterwards uses the whole group. Initial naming belongs to folder creation; every later Rename has its own Undo action. Accepting the default name or cancelling the naming form ends initial naming too.

The folder-import choice reports the total supported images, the subset in subfolders and any images in the main folder separately. Unsupported files do not count as images.

CLIP progress, statistics, pause, retry and rebuild live in **Project settings**. The active CLIP-index badge opens those settings; it disappears when indexing finishes. On compact layouts it appears as CLIP embeddings inside ⋯. There is no separate Activity page. Board-image export progress, Cancel and error dismissal stay under **Export → Current board**. Storage and export errors still open the board menu so they remain visible on phones.

## Touch and zoom

- Drag an image with one finger. Drag empty board space with one finger to pan.
- Pinch with two fingers to zoom the board between 5% and 200%; moving both fingers pans. Keep the same world point under the finger midpoint. Ignore rotation and extra fingers.
- A second finger cancels an image or folder drag before taking over navigation. Lift all fingers before starting another image drag. Navigation must not create assignments, folders or layout-history entries.
- Keep the workspace interface at its normal size during gestures. The image browser retains native one-finger vertical scrolling. Editable fields use at least 16px type on phones to reduce input-focus magnification.
- Trackpad pinch and Ctrl-wheel over the board use the same anchored camera. Keep ordinary wheel scrolling. Fit and zoom buttons remain available as gesture alternatives.
- Save the camera with the current folder's browser preferences. Coalesce gesture updates to animation frames and preserve thumbnail virtualization.
- Scope native-zoom suppression to the workspace. Do not add a global `user-scalable=no` or `maximum-scale` viewport restriction. Browser/OS accessibility magnification is outside the app's control.

## Visual structure

Use the [free-board visualization](https://foldersort-free-stashes.daniel-pfurtscheller.chatgpt.site/) as the desktop visual reference.

- Use one workspace bar: project return, Staging and folder ancestry, a reserved image-action slot with an explicit selected count and equal-weight Move/New folder actions, then grouped Zoom/Fit, Undo, labelled desktop Export and ⋯. The root breadcrumb has no leading separator. Do not repeat the current folder title above the canvas.
- With no selection show Select and New folder. With a selection show its count, Move to folder, New folder and Deselect in that same slot. The New folder tooltip states how many selected images it will contain. Keep navigation and utility positions stable. Zoom contains minus/plus and Fit; Export opens the real image, hierarchy and backup actions directly.
- Image-browser filters and Move to [folder] remain in the browser. Move to [folder] names the destination and uses the folder-arrow icon. For selections already in this folder it becomes Locate on board, which frames the selection without changing membership, positions or Undo. On board marks placed images; folder filtering uses membership, including waiting unsorted images. Move and Deselect live in the shared bar. Creating a folder from browser selections puts it in the visible board without jumping to their old positions. Creating from the expanded browser returns to the board for inline naming.
- Select all in the browser replaces the selection with the filtered results; it does not retain hidden selections from other folders. Apply the batch in one state update, including for large collections.
- The browser starts at roughly one-third of the desktop width, with readable type and consistent thumbnail slots. Contain the full image; do not crop documents or stretch photos.
- Show short folder names in neutral captions. Preserve the full path in tooltips and project data. Selection uses the strong mint outline; assignment does not add a competing colored frame.
- Folders use compact neutral panels. Drag the folder-and-name header to move the folder; keep its color on the folder icon. The ⋯ disclosure holds Rename, direct image counts and totals including subfolders. The slim footer shows direct images and immediate subfolders; click it or the image stack to enter. Keep entry free of redundant instructions; its count hint explains direct versus inclusive counts. Gently open the footer folder on hover or keyboard focus (150 ms); switch states without motion when reduced motion is requested. Touch enters immediately. Preserve movable positions and top-image extraction.
- Keep dropdown styling consistent across browsers while retaining native select semantics. Respect reduced motion. Keep original images, assignments and saved layout independent from presentation preferences.

## Interaction rules

| Action | Result |
| --- | --- |
| Add or drag a browser image onto the board | Move it into that folder, removing its previous membership. Moving to Staging removes any folder assignment and puts the image on the working board. |
| Locate on board | Reveal selected members in place. Change only the camera; do not add a history entry. |
| Quickly drop an image over another image | Place them together in the current folder, without creating a new folder. |
| Hold an image over another for about 600 ms, then release | Create a folder from the dragged selection and target; name it inline. |
| Drop onto a named folder | Move the images into it, exclusively; new additions appear on top. |
| Drag a folder header, or nudge it with arrow keys | Move the stack's position on this board. |
| Drag the top image out of a closed folder onto the board | Move it to the current parent and place it at the drop point. |
| Drag a top image into another folder | Move its membership; put it on top. |
| Drag a top image into the Image browser | Cancel the move from a folder preview; use Staging or the parent breadcrumb to move out. Staged loose images dropped in the browser return to the waiting queue. |
| Drag a loose board image into the Image browser | From Staging, return it to waiting with Undo. From a named folder, cancel and retain its membership and position; use its explicit − or Remove from “Folder name” action to return images to waiting. |
| Move to Staging | Move into Staging, where the image appears on the overview board. |
| Delete empty folder from a folder menu, its centre trash icon, or the project list | Delete only that empty container. Inside it, return to its parent. Undo restores its name and position. Folders with images or subfolders cannot be deleted this way, including parents whose subfolders are empty. |
| Delete from project in image review | Remove that project image; keep the source file. Undo can restore the project copy. |

The selected image’s **+** opens related-image suggestions to its right in three fixed columns. Use Subject or Color and choose 1–12 suggestions, starting at 3. Quantity changes extend the grid downward without relocating its existing slots; overlaps are allowed. One lightly tinted dashed frame surrounds the pending batch. The compact toolbar sits above it: drag its grip to move the entire draft, or focus the grip and use arrow keys (Shift for larger steps). **+ Add 3** accepts those exact preview coordinates on Staging or in the open folder. Suggestions use unsorted images only; Staging excludes images already on its board, and other folders’ assignments remain untouched. There is no other-folder checkbox in this picker. Successive accepted batches for the same source and board start below the last accepted batch, including manual draft positioning. This placement memory lasts for the current workspace session; cancellation and quantity changes do not advance it, and Undo excludes undone batches. Neither previewing nor acceptance pans/zooms the camera or moves existing images. Large drafts may extend outside the visible viewport; drag the board to inspect them or use the grip to reposition the draft. Only new photos make the short in-place settling motion, with reduced motion respected. Previewing, dragging a draft, changing method/count and dismissing with X or Escape do not change membership, layout or Undo history. Completed background indexing never replaces a visible cohort. A draft is discarded when its reference/layout changes. One Undo restores former folders, waiting state, positions and stack order. The separate board-wide matching tool retains its explicit scope controls.

The separate board-wide similarity action retains its existing behavior: on Staging it adds queued matches, or selects/reveals existing matches when the queue is empty. Finding existing matches does not change folders, positions or history. CLIP indexing follows the Subject similarity setting, which defaults to enabled. The subject and color algorithms, saved project formats and export compatibility remain unchanged.

Export names its scope: Entire project · images + CSV includes all images, shows the total and unsorted count, and explains that waiting originals go into `_Unsorted`, staged originals into `_Staging`, and each image appears once. These special names are reserved in output only; colliding user folder names receive safe suffixes without changing the saved project. Current board names the open folder and offers visible/whole-board PNGs. Folder structure and project backup remain separate export sections.

During hold-to-create, place the cue above the touch point with room for a finger. Fit the measured cue within the workspace and use a clear side when the upper edge leaves insufficient space. Keep the hold duration and release requirement independent of presentation.

Use the compact **Create folder** capsule: fill its background left to right across the 600 ms hold, then align the miniature images and show a check. Keep its label and size steady. Cancelling or changing targets resets the fill; a full capsule still requires release. Settle the new stack briefly before focusing its inline name. Respect reduced motion and keep the progress cue off the finger.

## Data and persistence

Search and folder filters remain visible as removable chips when Filters is closed. After a matching group is sorted, Continue with unsorted clears the selection and those restrictive filters, retaining Unsorted across the whole project. Images selected on the current board keep their useful selection and are labelled on board. Staging can be found by either Staging or Unsorted in the move chooser. Rename errors belong beside the name; they do not open Board actions.

Inside a folder, Unsorted plus Current folder only explains the empty result rather than presenting it as completed sorting. Show this folder’s images switches to All and keeps the current-folder filter. Continue with unsorted explicitly switches to the project-wide queue. Neither action changes memberships or image positions.

New folders are placed within the actual board viewport after saving. Returning from a folder minimally reveals its stack, preserving its anchor and the saved zoom whenever it fits. Desktop Fit is directly available in the single menu bar; mobile keeps it under Board view.

- Each image is either waiting, on Staging, or in one named folder. Waiting and staged images both count as unsorted. Parents may contain direct images and subfolders.
- Folder membership owns folder contents and export. The legacy `rootOnBoard` field records whether an unsorted image has been added to Staging; missing values preserve legacy boards. Queue state, originals, positions and analysis survive Undo and backups. Legacy `boardScope` still mirrors membership, never an independent folder location.
- Browser filters never move images or change their folder, order, layout or analysis. Browser order and position are local viewing preferences, saved separately from project data; scroll preference writes wait for scrolling to settle.
- Originals, assignments, working positions and saved analysis round-trip in project backups. Sorted export includes originals in matching folders and an assignments CSV.
- Folder tile positions, camera and browser preferences are currently saved only in this browser.
- Undo records up to 50 recent edits in memory. Project switching and reload end the history.
- Large collections use virtualized views and bounded thumbnail decoding. Showing a collection must not mount one element or decode one full image per project record.

## Acceptance checks

1. Import a folder; choose Keep subfolders or Start unsorted.
2. Browse all images, including assigned images; filter to Unsorted and back without losing data.
3. Compare images, create two folders, rename them and move an image between them.
4. Create and open a subfolder; return to its parent. Confirm direct and inclusive counts.
5. Extract a top image; verify its placement and new membership. Cancelled drops keep the previous state.
6. Move an image after creating a folder. The next Undo restores the movement, keeping the folder.
7. Move a browser image into an open folder, then back to Staging. Undo each move and reload. Membership, board contents and saved positions remain consistent; dragging from a folder into the browser cancels; dragging from Staging returns to waiting, with Undo.
8. Export sorted images and a project backup; inspect folders, originals and CSV. Restore the backup.
9. Browse and bulk-add 3,000 images with bounded rendered elements; confirm no invalid positions or duplicated records.
10. On touch, pinch over board images, pan, add/lift an extra finger and cancel a drag with a second finger. Confirm stable interface size, unchanged memberships/positions, working browser scrolling and restored camera after reload.
11. With queued images, Staging similarity adds only unsorted candidates and Undo returns them to the browser. With no queue, Find only reveals existing matches. In a folder, matching excludes other folders until explicitly included; check preview origins and Undo.
12. Select an off-screen folder member and Locate on board. Create a folder from browser-selected off-screen images; confirm the new tile is visible and the camera stays steady. Fit, enter/return and reopen the project; retain the saved view.
13. Start from a blank Staging, change the default count, add a random batch and Undo. The welcome stays dismissed and the bottom control can add another batch. Try a small collection, skip to manual intake, create a folder, choose more images in the browser and export every original, including queued images. Reload preserves the queue and saved positions.
14. Search for Staging and Unsorted in the move chooser. Try a duplicate and blank folder name; keep validation local and recover without opening Board actions. Delete an empty folder from its tile menu, inside it and from the project list; Undo and reload. Protect populated folders and parents with empty children.
15. Close Filters while a query is active; keep it visible and removable. Move the last matching unsorted group into a folder, then Continue with unsorted. Clear the finished selection and query, retain Unsorted and show the remaining project images. Double-click a filtered image in the expanded browser without losing the thumbnail area.
16. Select two existing board images and two waiting images, then Add. Keep all four selected and the existing positions unchanged. Create a folder with all four. Rename it again; Undo restores the previous name and keeps its contents. A second Undo reverses creation.
17. Combine Unsorted with the current-folder filter inside a folder. Show its direct images locally, then continue with the global unsorted queue; keep memberships unchanged. Import a folder containing both loose and nested images and verify the separate counts before choosing how to start.

## Decisions retained for the test

- Single folder membership; no overlapping tags.
- Parent folders can hold direct images alongside subfolders.
- A folder is a movable object on the free board; there is no fixed folder dock or category sidebar.
- Source-folder interpretation is an import decision. Browser ordering is only a way to browse, not an automatic assignment.

## Context help

The Order selector has compact info help for every ordering option. Subject similarity and Pattern similarity use one short explanation plus a Uses reference to MobileCLIP-S0 or pHash. Help supports hover, focus, touch, Escape, outside dismissal, reduced motion and keyboard access to external links.

Additional help placements in project settings, matching, folder counts, filters, backups and Undo remain design drafts. This terminology release changes their wording without adding those popovers.

Filename ordering compares only the filename, with natural numeric order and stable ties; original source paths remain unchanged. Metadata ordering captions change with direction. Pixel count means width multiplied by height, and File modified remains the file modification timestamp.

## Staging acceptance checks

- Start a new Staging with a random sample; keep the bottom control available after emptying it, without repeating the welcome. After the starter is used or dismissed, keep the persistent batch control visible with selections and a collapsed browser, but never inside folders. Its waiting count and additions respect browser filters; keep new images and Fit clear of the control.
- Remove one or multiple staged images by button and drag. Undo restores saved positions; reload retains queue state.
- A named folder labels removal with its own name; only selected direct members return to waiting. Subfolders, other members and folder tiles stay intact. A waiting or mixed-location selection offers no current-board removal action.
- ZIP and directory exports put each original exactly once in `_Unsorted`, `_Staging` or a named folder. Project backups retain the existing v2 format and stage flags, including legacy missing flags.

The contextual +/− pair stops card drag/click propagation, remains a fixed screen size as the board zooms, and uses 44 px targets on phones. While previews are open, the compact suggestion controls replace the image’s +/− pair; closing returns those controls. The preview toolbar stays readable at every zoom and within the board pane. Staging intake and Fit reserve the bottom control area; folder boards use the full canvas. Fit never changes saved coordinates.


Selected-image previews form one coherent group near their reference in the current view. They may overlap current images and subfolder tiles; crowding never extends or reframes the draft. Opening and acceptance preserve the current camera, and acceptance saves the exact draft coordinates. Existing objects keep their positions. The selected image and its +/− controls sit above neighboring folder tiles, while an open folder menu remains on top. Parent navigation may pan minimally to reveal the returned folder; it preserves the folder anchor and initialized contents.

## Intake and restore checks

When browser filters exclude the waiting queue, show **No matching images** with **Reset filters**. Use **No waiting images** only when that queue is actually empty. Later random batches preview in the current view and may overlap earlier images and folder tiles; no camera adjustment occurs. Existing image positions remain unchanged and Undo restores the prior state.

Backup imports retain the manifest’s image MIME type as well as the original bytes, so SVG thumbnails and originals decode after a ZIP round trip. Older untyped restored assets receive their declared type when read. This does not rewrite originals, migrate the database or change the v1/v2 archive formats.


## In-place image intake

- The persistent **Preview 3 random images** button on Staging opens dashed previews above the control. **+ Add 3** accepts the exact draft. The count and **Try other random images** controls change only the draft; X and Escape dismiss it without changing images, folders or Undo history.
- Existing image positions and folder anchors never change when adding. Opening and accepting either random or related-image previews never pans or zooms. The incoming grid may cover existing images, folders or earlier batches; researchers arrange overlaps themselves. Crowding never triggers a search elsewhere on the board.
- One shared dashed frame with a faint tint identifies the whole preview batch. Accepting fades only that decorative frame over 220 ms; the photos become opaque with a tiny 2 px lift and settle. Saved card frames stay at their previewed coordinates and can be dragged immediately. The fading frame never intercepts input. Dismissal removes it immediately, and reduced motion skips the fade and settling effects.
- The selected image's +/− controls stay inside the visible board. They flip to the photo's left when its right edge has no space, with no image movement or camera adjustment.
- Intake spacing is compact: 6 px around the shared preview frame, 12 px between new grid cells, and 4 px toolbar padding/gaps. Desktop controls are 32 px high; touch controls remain 44 px. Related-image controls anchor 8 px below the shared frame, rather than below the invisible square card cells. Saved images retain their existing layout.
- New images appear on top. Select an unwanted image and use its **−** to return it to waiting, or remove a selected batch from the menu bar. Originals, analysis and previous coordinates remain available; Undo restores the exact board state.
- The one-time welcome still adds its chosen first batch directly, using the same in-place layout. The image browser's explicit manual Add/Move actions and drag-and-drop remain available. Large browser bulk additions retain their grid layout; they do not automatically frame the camera.
