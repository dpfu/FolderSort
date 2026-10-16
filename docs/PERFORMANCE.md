# Performance measurements — 2026-10-16

Compared with `2031e3f`, using generated data on the same Mac and headless Chromium 147. No CPU throttling. The scripts are included so these results can be repeated. Results depend on the browser and hardware.

## Saved CLIP index

3,000 saved, normalized 512-dimensional vectors. Medians of seven alternating before/after runs in the same browser process:

| Operation | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Validate the saved index | 225.0 ms | 9.1 ms | 24.7× |
| Decode vectors | 191.9 ms | 2.3 ms | 83.4× |
| Encode vectors | 41.2 ms | 0.8 ms | 51.5× |

Native TypedArray base64 conversion removes thousands of JS callbacks per image. Little-endian machines can read the resulting Float32Array directly. Browsers without these APIs use a tight byte loop. Validation still checks model identity, format, dimensions, finite values and normalization. Cache and backup bytes remain compatible; existing embeddings do not need rebuilding.

These measurements cover saved feature processing. They do not measure model downloads or inference, and do not imply a 10× gain for every action.

## Large-project interface

Medians of three fresh-profile runs per build, alternating before and after. Fixture: 3,000 generated images and saved embeddings, 100 stashes, 300 loose board images, 1,200 unsorted pile images and 1,500 assigned images. All thumbnails are already stored. CLIP is disabled to isolate saved-index hydration and UI work from model inference.

| Scenario | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| Reload through saved-index status, elapsed time | 987.8 ms | 210.0 ms | 4.7× |
| 60 selections, main-thread CPU | 568.7 ms | 214.2 ms | 2.7× |
| 90 pile scroll steps, main-thread CPU | 1,256.4 ms | 438.9 ms | 2.9× |
| 90 board pan steps, main-thread CPU | 716.8 ms | 219.9 ms | 3.3× |
| Board pan scripting, same sequence | 320.6 ms | 59.5 ms | 5.4× |

CPU comes from Chrome's `Performance.getMetrics`, excluding idle time. Reload elapsed time includes navigation and Playwright's readiness polling. Selections and scrolling are paced by animation frames; lower CPU work creates frame budget, rather than making a fixed number of display frames run several times faster. This fixture does not benchmark importing or decoding thousands of full-resolution originals.

### Changes

- Memoize photos by their presentation values and keep callback identities stable. Unchanged photos skip React/Motion updates; callbacks still use current committed state.
- Arm the original Motion drag only for the active pointer gesture. Idle photos no longer force continuous layout projection and scroll measurements. Keep the existing touch, quick-release, cancellation and precise-drop paths.
- Subscribe photos, stash previews and similarity previews to their own thumbnail URLs. A newly loaded thumbnail updates its own UI instead of rebuilding the collection and board.
- Calculate the visible pile slots directly. Preserve manually moved and selected/dragged images, including those outside their original slots. Ordinary scrolling visits visible slots instead of all 3,000 records.
- Reuse dataset IDs and occupied geometry when only selection, thumbnail readiness or z-order changes.

## Regression checks

104 unit/component checks, strict TypeScript and production build, the 78-workflow Chromium suite, and 37 WebKit checks cover the changed paths. Native touch extraction/Undo and hold-to-group run in Chromium; WebKit uses isolated persistent profiles for IndexedDB Blob support in this automation environment. Browser checks retain exact drop placement at three zoom levels, virtualized 3,000-image browsing, matching previews, assignments, backup/restore and reloads.

Faster interaction exposed arrival-surface hit targets and an overview grid with implicit rows when its filters were hidden. Photo arrival now keeps hit testing on the fixed frame; the grid uses explicit tracks. Closing the overview captures its actual scroll position before the next throttled update. These checks passed before publication.

## Reproduce

Use Node 22.12 or newer and the installed Playwright Chromium:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4190
```

In another terminal:

```sh
PERF_CLIP=1 npm run perf:ui
npm run perf:content
```

`PERF_URL` selects another local production build; `PERF_IMAGES` changes the dataset size. `PERF_PROFILE` optionally saves a Chrome CPU profile outside the repository. `PERF_BASELINE` selects the Git revision for the paired cache comparison; its default is `2031e3f`, which requires that revision in the local Git history. To compare full UIs, serve that revision's production build on a second port and run the same UI command against it.

The fixtures use a fresh temporary browser profile, generated images and no model downloads. They do not read existing browser projects.
