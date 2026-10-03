# Changelog

Changes to Folder Sort are recorded here with each push.

## 2026-10-03

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
