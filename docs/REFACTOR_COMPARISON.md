# FolderSort: refactor quality and performance comparison

Measured 7 November 2026. Three frozen source commits are compared in the same session. Earlier two-version measurements are kept separately and are not pooled with these samples.

| Version | Commit | Purpose |
|---|---|---|
| original | `4796ffc3993c3c5637b6625ad5d01004e4338ee8` | Committed feature branch before cleanup |
| prior | `25a6428f8277f70a7d6ca3ef83b287f4c6d40e21` | Completed initial state-machine refactor |
| final | `5782d76333553935d75f1ebd4715040d260ee8a7` | Readability, narrower contracts, placement extraction and lifecycle follow-up |

## Code quality assessment

The final refactor is the preferred foundation for continued development. Its main gains are explicit ownership, safer asynchronous completion and independent lifecycle tests. It remains a React application with small local controllers; no state-machine framework or production dependency was introduced.

| Dimension | Original | Final refactor |
|---|---|---|
| State ownership | Coupled render flags, refs and asynchronous completions distributed through views | Named owners for navigation, preview drafts, task submission, selection, browser context and worker/resource lifetimes |
| Concurrency and cancellation | Repeated request versions, guards and cleanup policy at individual call sites | Request ownership and once-only settlement reused; domain-specific timeout and fallback policy retained |
| Component responsibilities | LibraryApp combines UI, commands, history and transfers; workspace combines placement math with orchestration | Project commands/transfers/session extracted; folder tile planning is pure and separately testable |
| Interfaces | Internal hook return shapes used as dependencies | Project commands, transfers, matching and order preparation consume named, narrower contracts |
| Readability | Compact code, including several transitions on one line | Lifecycle owners use consistent multiline formatting and clearer transition boundaries |
| Testing | More behavior requires browser integration to observe | Direct tests for stale requests, cancellation, once-only acceptance, write failures and queue independence supplement browser workflows |
| Navigation cost | Fewer files, more tangled local responsibilities | More files to follow; this follow-up adds no production modules |

### What this follow-up changed

1. Defined `ProjectLibrary`, `ActionHistory` and `ImageAnalysis` contracts. Consumers declare the fields they need. Transfers no longer require a whole session hook return; its test fixtures implement the actual small contract without an `as unknown as` options cast.
2. Extracted `placeCreatedFolder` into the existing placement module. It plans a new tile and optional camera reveal without moving existing images. Explicit grouping drops retain their chosen point; browser creation retains the existing visible-placement policy. No new source module was introduced.
3. Fixed metadata queue independence: a failed request still rejects its original caller, while a different metadata need waiting behind it can run.
4. Preserved selection identity across metadata/position-only writes, and avoided external-store notification when cancelling an already idle task.
5. Formatted lifecycle code consistently. An emitted-JavaScript AST comparison against the previous refactor found equivalent runtime syntax in 34 of 39 changed production files; the other five contain the intended planner extraction and lifecycle changes. This is an audit aid, not a formal equivalence proof.

Five regression tests were added for the concrete placement, queue and update guarantees. The final unit/component suite has 215 passing tests across 57 files. Browser verification results are recorded in the repository's refactor follow-up notes.

### Structural measurements

Line counts are descriptive, not a quality score; formatting increases lines in the lifecycle modules. Application-module counts exclude unit tests, `testSetup.ts` and the ambient `vite-env.d.ts` declaration; including those last two gives 102 → 136 → 136 non-test source files.

| Measure | Original | Previous refactor | Final |
|---|---:|---:|---:|
| Production TypeScript modules | 100 | 134 | 134 |
| Unit/component test files | 37 | 57 | 57 |
| src/LibraryApp.tsx, lines | 458 | 209 | 209 |
| src/SortingWorkspace.tsx, lines | 1089 | 925 | 910 |
| src/Board.tsx, lines | 436 | 371 | 371 |

### Remaining tradeoffs

- `SortingWorkspace` still owns substantial view orchestration. The current extraction deliberately leaves pointer hit testing, DOM geometry and animation commits together where their timing is visible. Further splits should have a concrete ownership or testability benefit.
- There are 34 more production modules than on the original branch. Contributors must learn the controller boundaries. This follow-up improves existing modules without adding wrappers.
- Some lifecycle controllers remain imperative, and the preview state/data relationship is not a fully discriminated union. Explicit ownership reduces race opportunities but does not make all invalid states unrepresentable.
- Passing tests are evidence for the tested contracts, not proof of correctness under every browser schedule or memory-pressure event.

The stopping point is a reviewable implementation with readable lifecycle owners, narrower domain interfaces, concrete failure coverage and passing build/workflow gates. Further changes should follow observed behavior or a specific maintenance need.

## Verification

| Gate | Original | Final refactor |
|---|---|---|
| Unit/component suite, rerun here | 161 passed / 37 files | 215 passed / 57 files |
| Strict TypeScript and production build | Passed | Passed |
| Full desktop Chromium workflows | Not rerun in this pass | 164 passed |
| Focused WebKit workflows | Not rerun in this pass | 29 passed, 3 Chromium-only skips |

The previous refactor's recorded unit gate is 210 passing tests. Test counts are not a coverage percentage or a quality score. Browser gates use the final frozen source, without relaxed position/membership assertions or forced clicks.

## Runtime comparison

The final version is broadly similar to the original in this desktop fixture, with small localized costs rather than a demonstrated overall speedup. Startup is 75.9 → 75.6 ms, import 411.5 → 408.3 ms, and ZIP export 7.30 → 7.42 s. Selection and browser scrolling are close on renderer CPU; board pan uses about 11 ms more CPU across 90 steps. Folder creation uses 60.6 → 66.4 ms CPU (+5.8 ms), compared with 69.8 ms in the previous refactor.

The full-workflow removal measurement is higher (29.8 → 37.6 ms CPU). A separate, shorter check below finds a smaller difference with overlapping ranges. Both results are retained; neither is used to claim a universal improvement.

The final initial bundle is 6.79 KiB (+3.1%) larger compressed than the original, and 0.15 KiB larger than the previous refactor. Retained JS heap after the primary interaction workflow is 12.756 → 12.831 MiB (+0.075 MiB). The follow-up does not add a material new payload or memory cost in these fixtures.

These are local automated timings, not human input latency or network cold-start measurements. Inspect both wall time and renderer CPU before calling a small change faster or slower. Interquartile ranges overlap for many operations; this experiment does not establish statistical equivalence or a universal speedup.

### Wall time

Six measured runs per version, median and inclusive interpolated 25th–75th percentiles. Lower is faster.

| Workload | Original median [IQR], ms | Previous refactor median [IQR], ms | Final median [IQR], ms | Final vs original |
|---|---:|---:|---:|---:|
| Empty app startup | 75.9 [74.7–76.5] | 84.0 [83.5–84.3] | 75.6 [74.5–86.6] | -0.4% |
| Restore 3,000-image project | 174.6 [173.0–178.1] | 180.2 [171.6–180.5] | 169.4 [167.3–169.5] | -3.0% |
| Open board and decode visible images | 162.8 [155.5–164.6] | 155.5 [149.1–158.4] | 159.6 [158.8–166.8] | -2.0% |
| 60 selection changes | 675.3 [658.1–691.3] | 652.2 [643.8–683.6] | 657.2 [648.1–674.3] | -2.7% |
| 90 browser scroll steps | 1054.9 [1037.8–1062.0] | 1047.4 [1002.4–1062.7] | 1015.1 [999.9–1025.2] | -3.8% |
| 90 board scroll/pan steps | 1019.4 [1013.6–1036.3] | 1048.7 [1020.8–1065.7] | 1085.2 [1023.7–1122.7] | +6.5% |
| Drag two selected images | 330.6 [319.1–358.9] | 324.6 [317.0–353.2] | 347.9 [336.0–359.7] | +5.2% |
| Create folder from two images | 170.2 [160.7–177.8] | 179.6 [177.4–183.6] | 189.1 [174.3–196.4] | +11.1% |
| Enter folder, including transition | 515.6 [510.0–517.9] | 514.1 [510.6–522.3] | 511.1 [504.8–514.2] | -0.9% |
| Return to Staging, including transition | 410.3 [404.7–418.9] | 401.3 [397.7–409.8] | 399.8 [395.5–403.9] | -2.5% |
| Preview three random images | 76.5 [74.4–79.5] | 84.1 [76.1–89.6] | 88.7 [73.2–96.7] | +16.0% |
| Accept three previews in place | 165.8 [155.3–187.7] | 170.2 [164.8–170.7] | 162.8 [158.0–163.3] | -1.8% |
| Remove three images from Staging | 150.6 [149.3–159.6] | 129.1 [84.8–173.5] | 169.3 [160.2–174.7] | +12.4% |
| Export ZIP of 3,000 tiny PNGs | 7302.1 [7017.4–7519.4] | 7645.6 [7301.2–7990.3] | 7422.3 [7305.9–7610.0] | +1.6% |
| Export board view as PNG | 167.7 [163.3–174.2] | 177.5 [164.0–183.6] | 176.7 [167.0–194.4] | +5.3% |
| Import 300 JPEG originals | 411.5 [406.6–412.4] | 411.2 [407.1–416.5] | 408.3 [407.1–409.4] | -0.8% |

### Main renderer CPU time

CDP `TaskDuration` deltas. Worker, GPU and storage-service CPU are excluded. CPU and wall-time medians are computed separately.

| Workload | Original median [IQR], ms | Previous refactor median [IQR], ms | Final median [IQR], ms | Final vs original |
|---|---:|---:|---:|---:|
| Empty app startup | 44.7 [44.3–45.1] | 46.6 [45.3–47.2] | 44.4 [44.1–44.8] | -0.6% |
| Restore 3,000-image project | 47.4 [46.8–48.1] | 49.4 [48.7–50.0] | 48.0 [47.9–48.3] | +1.3% |
| Open board and decode visible images | 98.8 [96.0–100.2] | 95.3 [94.5–97.1] | 98.7 [93.8–100.0] | -0.1% |
| 60 selection changes | 234.2 [229.6–238.3] | 228.0 [221.6–235.9] | 229.1 [225.1–231.9] | -2.2% |
| 90 browser scroll steps | 358.8 [346.4–371.3] | 363.3 [358.0–363.5] | 359.1 [355.9–361.9] | +0.1% |
| 90 board scroll/pan steps | 209.5 [209.4–216.3] | 219.3 [217.2–220.6] | 220.7 [197.7–225.2] | +5.3% |
| Drag two selected images | 70.3 [66.7–72.3] | 65.6 [64.1–73.7] | 65.1 [64.3–70.2] | -7.4% |
| Create folder from two images | 60.6 [60.5–61.0] | 69.8 [68.3–74.5] | 66.4 [65.6–68.8] | +9.6% |
| Enter folder, including transition | 66.6 [64.9–68.4] | 69.2 [67.5–70.7] | 68.1 [67.3–69.6] | +2.4% |
| Return to Staging, including transition | 45.4 [44.0–47.0] | 47.8 [46.6–48.0] | 48.1 [47.9–48.7] | +6.0% |
| Preview three random images | 17.5 [17.0–17.9] | 16.7 [16.1–17.5] | 16.8 [16.3–17.0] | -3.5% |
| Accept three previews in place | 37.5 [36.3–38.6] | 39.4 [37.6–40.2] | 37.5 [35.7–38.2] | +0.2% |
| Remove three images from Staging | 29.8 [28.5–31.0] | 33.7 [31.8–35.1] | 37.6 [34.7–41.6] | +26.2% |
| Export ZIP of 3,000 tiny PNGs | 521.2 [461.3–535.1] | 536.9 [519.5–557.3] | 521.4 [514.9–548.3] | +0.0% |
| Export board view as PNG | 39.1 [37.3–40.0] | 40.2 [39.9–41.3] | 40.3 [39.4–41.1] | +3.1% |
| Import 300 JPEG originals | 193.5 [192.6–195.0] | 197.6 [193.3–211.1] | 198.0 [194.1–203.5] | +2.3% |

### Retained JavaScript heap

Measured after two forced garbage collections, outside timed phases. This excludes decoded image surfaces, GPU memory, much Blob backing storage and other process memory. It is neither total RAM nor a peak-memory measurement or long-term leak test.

| Checkpoint | Original, MiB | Previous refactor, MiB | Final, MiB |
|---|---:|---:|---:|
| Project | 4.933 | 5.114 | 5.084 |
| Board | 8.231 | 8.334 | 8.340 |
| Interactions | 12.756 | 12.916 | 12.831 |
| Exports | 13.810 | 13.986 | 13.976 |
| Import | 5.590 | 5.709 | 5.687 |

### Payload and build

| Measure | Original | Previous refactor | Final |
|---|---:|---:|---:|
| Initial JS + CSS, raw KiB | 759.16 | 777.34 | 777.73 |
| Initial JS + CSS, gzip-6 KiB | 217.06 | 223.69 | 223.84 |
| Main JS, gzip-6 KiB | 193.11 | 199.73 | 199.89 |
| TypeScript + Vite build median, ms | 2945.1 | 2992.0 | 2986.2 |

Builds ran three times per version in rotated order. These few samples are indicative; OS caching is not controlled. Gzip-6 sizes are recompressed file sizes, not the preview server's measured transfer encoding. Type-only edits and source organization can alter bundler/minifier symbol allocation and compressed size; formatting is not a promised payload optimization.

## Saved CLIP cache check

This is a separate six-round experiment with 3,000 deterministic packed 512-dimensional vectors in the saved project. CLIP stays disabled and no model is loaded. Restore timing waits for the status to confirm all 3,000 cached vectors were hydrated. The earlier interaction fixture is otherwise reused through scrolling/panning. It measures saved-cache handling, not semantic quality or inference.

| Measure | Original median [IQR] | Previous refactor median [IQR] | Final median [IQR] |
|---|---:|---:|---:|
| Restore + cache hydration, ms wall | 284.7 [283.5–292.8] | 283.5 [283.2–285.0] | 286.4 [284.6–294.4] |
| Restore + cache hydration, ms CPU | 82.9 [82.3–83.2] | 88.3 [87.1–88.7] | 83.9 [83.2–84.6] |
| Open board, ms wall | 173.8 [166.0–183.1] | 154.8 [150.0–156.6] | 157.7 [151.6–162.8] |
| Retained JS heap, project, MiB | 21.458 | 21.695 | 21.610 |
| Retained JS heap, board, MiB | 24.725 | 24.865 | 24.820 |
| Retained JS heap, interactions, MiB | 27.652 | 27.812 | 27.753 |

Cached-project restore is effectively unchanged (284.7 → 286.4 ms wall). Interaction heap is 27.652 → 27.753 MiB. The model/inference runtime remains unmeasured.

## Focused removal check

The primary workflow showed +7.8 ms renderer CPU for removal, so a separate six-round check starts from the initial board, selects the same three images and removes them. The timed action dispatches the button in the browser, avoiding Playwright pointer/actionability work, then waits by animation-frame polling for the cards to disappear and saving to finish. Results are not pooled with the full workflow, which includes earlier navigation and animations.

| Remove three images | Original median [IQR], ms | Previous refactor median [IQR], ms | Final median [IQR], ms |
|---|---:|---:|---:|
| Wall time | 77.9 [75.4–91.6] | 70.5 [67.4–73.6] | 68.3 [59.9–71.0] |
| Renderer CPU | 42.7 [42.2–43.6] | 47.2 [41.8–50.1] | 44.4 [42.1–45.1] |

The focused CPU gap is +1.6 ms (42.7 → 44.4 ms), with overlapping ranges. This does not reproduce the full +8 ms as a stable isolated removal cost. It also does not invalidate the full-workflow observation. Both experiments passed their storage and page-error checks.

## Controls and limits

- Apple M4, 10 logical CPUs, 32 GiB RAM, macOS; Node v26.5.1; Chromium 147.0.7727.15; viewport 1440 × 1000. No CPU or network throttling.
- Separate detached worktrees, identical dependencies, production builds. All six order permutations are used once over the six measured rounds, so each version runs first, second and third twice. One warmup per version is excluded.
- Fresh browser contexts and identical synthetic data. UI fixture: 3,000 images, 100 folders, 300 on Staging, 1,200 waiting, 1,500 assigned. Cached 160 × 100 PNG thumbnails and tiny PNG originals. The browser panel is open; 47 board cards are mounted at the final viewport in every run. Existing migration/layout markers are seeded.
- Separate import fixture: 300 generated 1024 × 768 JPEGs, 113.84 MiB total, twelve base images repeated with unique filenames. Completion means all originals are stored and the starter is ready; subsequent thumbnail processing may continue.
- ZIP export uses tiny originals: it tests file-count/export overhead rather than representative large-photo compression throughput. PNG export tests the current view only.
- CLIP is disabled and model hosts are blocked. Model startup, embeddings, text search, naming inference, real iOS memory pressure and huge-original decoding are not benchmarked. Algorithm/model/schema files listed in `code-structure.json` are identical across the three commits.
- Timed actions include Playwright readiness/actionability checks, save completion and relevant animations. Frame loops execute one action per animation frame. Their totals are not per-input latency and frame scheduling is not assumed to be 60 Hz.

## Runtime validation

All 18 measured samples and all three warmups completed with no page errors. Every run verified both dragged images changed stored positions, folder navigation completed, previews were accepted at exactly their displayed coordinates, all three removals returned to waiting, ZIP contained all 3,000 originals, both downloads were nonempty and import stored all 300 originals.

## Reproduce the workflow comparison

Use isolated checkouts of the three exact commits listed above. Install the same
lockfile dependencies, run `npm run build` in each, then serve each production
build with `npm run preview -- --host 127.0.0.1 --port PORT --strictPort`.
The protocol defaults to original on 4610, prior on 4611, final on 4612.

The reusable [workflow benchmark](../scripts/benchmark-workflow.mjs) is stored in
this repository. Run it from the refactor checkout while the servers are running:

```sh
PERF_OUTPUT=output/workflow-performance node scripts/benchmark-workflow.mjs
PERF_OUTPUT=output/workflow-performance PERF_CACHED_ONLY=1 PERF_IMPORT_IMAGES=0 node scripts/benchmark-workflow.mjs
```

The defaults are six measured rounds covering all six version orders, plus one
warmup per version. Optional variables: `PERF_ORIGINAL`, `PERF_PRIOR`, `PERF_FINAL`,
`PERF_IMAGES`, `PERF_IMPORT_IMAGES`, `PERF_REPEATS`, `PERF_WARMUPS` and
`PERF_PACKAGE_JSON`. Changing fixture sizes or round counts requires updating the
analysis and interpreting the new workload separately. Synthetic saved vectors
use the checked-out `contentSimilarity` implementation; it is identical across
the three commits measured here.

The full report, raw measurements, summary JSON/CSV, build runner, focused-removal
harness, AST audit and verification logs are retained locally under
`output/refactor-review-2026-11-07/` (gitignored). They are separate from the earlier
`output/performance-2026-11-07/` comparison. The versioned protocol is for the
primary and saved-cache experiments; the focused-removal harness remains in the
local artifact directory.

Production source is frozen at `5782d76`; later report/protocol commits do not
change that source. Existing user drafts were excluded. Changes remain on the
refactor branch; this pass does not deploy the application.
