# Changelog

Changes to Folder Sort are recorded here with each push.

## 2026-10-03

- Expand the lower image pile into a full-screen, continuously scrollable overview. Switch between a loose mess and an aligned grid, resize images, jump through the collection, and browse the pile or the whole project.
- Search filenames and categories, filter category branches or unassigned images, and mark individual images, ranges, or all matches. Preview originals with previous/next navigation, then add the marked set to the sorting board without changing categories or duplicating images already there.
- Share random, metadata, pHash and CLIP ordering between the strip and overview. Preserve marks, image size, layout and browsing position when returning to the board; keep CLIP pause/resume controls available in the overview.
- Cache small thumbnails locally, decode them in a worker with a browser fallback, bound concurrent loading and retained previews, and prioritize images near the viewport. Virtualize both the expanded overview and the sorting board for large collections, including bulk additions.
- Preserve the board camera when zooming or extending the board. Keep added similar images slightly inside the visible edges.
- Add keyboard navigation and marking, focus containment, reduced-motion support, and compact controls for phone and landscape views.
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
