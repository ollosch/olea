# Catalog performance measurement — 2026-11-09

Step 17 measured catalog search with an invented, disposable large catalog. The representative synthetic localhost run showed **no material load, search or memory delay**, so no production performance change was delivered. Payload size was recorded as a diagnostic but is not by itself evidence of a material problem. No real Wi-Fi or server-CPU measurement was performed.

A scoped gzip experiment was implemented and reviewed during step 17, then removed at the product owner's request. No compression production code or compression-specific tests remain; this document records the measured baseline and the reversion.

## Dataset

`scripts/perf-catalog.ts` generates the invented data. The measured run used **2,000 spells**:

- 1,715 `PHB` and 285 `XGE` records, varied levels and five schools.
- Names `Perf Spell 0001` through `Perf Spell 2000`, with stable `source_id`s.
- Every record carries invented source JSON: page, entries, higher-level text, list blocks, time, range, duration, components and misc tags.
- The catalog list response is **7,212,738 bytes decoded** (average 3,606 bytes/record). All content is synthetic; no repository source file or personal database was read or imported.

`E2E_CATALOG_PERF=1` makes `scripts/e2e-server.sh` generate the file inside the disposable data directory and import it. The whole directory is deleted when the server exits.

## Method

Command used for the measurement (an untracked temporary config kept the repository's default ports free):

```sh
E2E_PORT=8092 E2E_CATALOG_PERF=1 E2E_CATALOG_PERF_COUNT=2000 \
  bunx playwright test --config=.playwright-step17.config.ts \
  e2e/catalog-performance.spec.ts --workers=1
```

- Disposable PocketBase on **8092** (8091 was occupied); Vite on **5174**; default 5173 was left untouched. The temporary config was removed after verification.
- Playwright Chromium, fresh browser context per project. Desktop viewport **1920×1080**; phone is Playwright's **Pixel 8** emulation with **CDP CPU throttling 4×**.
- The app shell (`/games`) is loaded first, then the catalog navigation is measured, so Vite module loading is excluded. Network is not throttled because this is a synthetic localhost run.
- Load time: from `page.goto` of the catalog URL to the rendered entry count.
- Search time: from the input event until two animation frames after the URL query and result count render. This includes the browser's ~33 ms two-frame floor and is therefore conservative.
- Transfer: `PerformanceResourceTiming.transferSize` plus encoded/decoded body sizes for the catalog list requests. Detail requests are measured separately.
- Memory: CDP `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`, compared with the same page after the shell loaded. This is JavaScript heap only.

### Materiality criterion

The original experiment used thresholds of 1.5 s desktop load, 2.5 s phone load, 100 ms search, 64 MB incremental heap, 100 KB detail payload and 5 MB list payload. After the owner's review, payload size alone was no longer treated as evidence of a material user-visible problem. The measurements below are assessed using these timing and memory thresholds:

- catalog list load over **1.5 s** on desktop or **2.5 s** on the 4×-throttled phone;
- search-to-render over **100 ms**;
- incremental JavaScript heap over **64 MB**. Detail-open timing is also reported.

Data transfer was recorded but is not a materiality threshold: a large payload on localhost says nothing by itself about real Wi-Fi latency. No server CPU or native memory profile was taken.

## Measurements

Three representative runs, median (range):

| Measure | Desktop 1920×1080 | Pixel 8, 4× CPU |
|---|---:|---:|
| Catalog list load | **619 ms** (585–622) | **1,613 ms** (1,603–1,629) |
| Search-to-render, worst query | **62.9 ms** | **77.0 ms** |
| List requests | 3 | 3 |
| Transfer | **7,213,638 B** (~6.88 MiB) | same payload |
| Encoded / decoded | 7,212,738 / 7,212,738 B | same |
| Incremental JS heap | **+9.46 MB** | **+9.45 MB** |
| Detail payload | 4,041 B transferred / 3,741 B decoded | same |
| Detail open | 87–96 ms | 148–156 ms |

All observed load, search, memory and detail timings were below the materiality thresholds. Sorting and filtering 2,000 records stayed under the search threshold; rendering was already bounded to 30 rows.

## Headroom stress case (beyond the representative dataset)

A separate 6,000-record run (21,642,390 bytes decoded) was measured only to show the next limit:

| Measure | Desktop 1920×1080 | Pixel 8, 4× CPU |
|---|---:|---:|
| Transfer | 21,642,390 B | same payload |
| Catalog list load | 1,724 ms | 3,143 ms |
| Worst search | 65.0 ms | 107.9 ms |
| Incremental JS heap | +27.0 MB | same |

At three times the representative size, the synthetic phone load and one worst-case search crossed the thresholds. That size is beyond the representative dataset and the local fixtures; it was not used to justify a production change. If real catalogs reach it, a real Wi-Fi/server profile should come before considering a list-specific payload, server pagination/search or caching.

## Stale-request, filter, sort and count checks

- `e2e/catalog-performance.spec.ts` verifies 2,000 entries, 30 rows per page, 67 pages, page 2 starting at `Perf Spell 0031`, level 3 filtering to 200 entries, the 1,715-entry `PHB` default, the 285-entry explicit `XGE` filter, and single-result search. It also checks that the detail payload is less than 1/100 of the list payload.
- `e2e/catalog-history.spec.ts` adds a race test: a held old spell request is released after a newer creature request has rendered, and the old response cannot replace the newer results.
- Existing `e2e/catalog-history.spec.ts` and `e2e/catalog-workspace.spec.ts` coverage still passes for browser/explicit returns, sanitization, delayed typing, same-name sources, and AD&D book/list/fractional-CR semantics.

## Reverted experiment

The gzip middleware, its route binding, its Go tests and the gzip-specific Playwright assertions were removed before completion. Nothing in the delivered step compresses catalog responses. The measurements above are the uncompressed baseline; the earlier compressed numbers are not part of the delivered behavior.

## Server search assessment

Server-side search is not needed for the measured representative size. If it is pursued later, the server would need to preserve:

- filters on `source`, `book_source`, `level`, `school`, `sphere`, `creature_type`, `challenge_rating`, `item_type` and `rarity`, plus arbitrary system-defined paths such as `original_json.mood`;
- `list` matches split on commas/newlines with each member normalized and compared exactly;
- `minimum`/`maximum` challenge-rating comparisons over whole and fractional values;
- the system default source filter, which currently depends on whether any loaded record has that source;
- case-insensitive substring name search, name/CR sort order, post-filter counts and pagination.

The current client already loads records in 1,000-record pages with `skipTotal`; the representative run needed three requests.

## Verification

- `bun run typecheck`: passed.
- `bun run build`: passed; only the existing >500 kB chunk warning.
- `go -C server test ./...`: all packages passed.
- `bun src/lib/catalogFilters.test.ts` and `bun src/lib/systems.test.ts`: passed.
- Playwright, desktop and Pixel 8 emulation:
  - `e2e/catalog-performance.spec.ts` with `E2E_CATALOG_PERF=1`: **4/4 passed** (measurement and filter/sort/count contracts on both projects).
  - `e2e/catalog-history.spec.ts` + `e2e/catalog-workspace.spec.ts`: **32/32 passed**.
- Temporary `.playwright-step17.config.ts` used Vite **5174** and disposable PocketBase **8092**, then was removed. Port 5173 was untouched.

## Limitations

- Browser emulation only: no physical phone, touch keyboard, real Wi-Fi/latency/throughput variation or memory-pressure run.
- Synthetic localhost measurement only: no real network transfer timing and no server CPU/allocation profile. The 7.2 MB payload is therefore a diagnostic, not proof of a user-visible delay.
- The measurement uses one dataset shape (spells) and synthetic source JSON; the 6,000-record stress case is beyond the representative size.
- JS heap only; native/browser process memory and server allocation were not measured.
- Vite dev proxy was used for the frontend; production static serving was not separately measured.
- No printer, screen reader or physical-device verification is implied.
- The opt-in 2,000-record measurement runs only with `E2E_CATALOG_PERF=1`; it is not part of the default suite.
