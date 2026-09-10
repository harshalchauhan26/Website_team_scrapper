## What's new in the app

- Scraping a collection is now noticeably faster: up to 5 product pages are fetched at the same time instead of one at a time.
- Everything else is unchanged — same CSV columns, same per-product log line as each product finishes, same start/end summary. The only visible difference is that product log lines may now appear in a different order than the collection listed them, since whichever of the 5 in-flight requests finishes first logs first.

## What was built

- `scrape.js`: added a generic `runPool(items, concurrency, fn)` helper — runs `fn` over `items` with at most `concurrency` in flight at once, returning results in the original item order regardless of completion order.
- `scrape.js`: added `scrapeAll(slugs, origin)`, which calls `runPool` with `CONCURRENCY = 5` and the same per-product fetch/build/log/skip logic that was previously inline in `main()`'s sequential loop.
- `scrape.js`: `main()` now calls `const rows = await scrapeAll(slugs, origin);` instead of looping sequentially. No other part of `main()` changed.
- `scrape.js`: exported `runPool` for the test file.
- `scrape.test.js`: added a self-check that runs `runPool` over 8 fake delayed tasks with a concurrency of 2, asserting max in-flight never exceeds 2, every item is processed exactly once, and results come back in input order.

## Decisions made during this milestone (not pre-specified in the PRD)

- `runPool` returns results in original input order (not completion order) even though rows are appended as work finishes internally — this was simpler to implement correctly (fixed-size results array indexed by cursor position) than tracking completion order, and nothing in the PRD required either order specifically for the final CSV (row order was already confirmed not to matter). Console log lines still print in actual completion order, which is what makes the concurrency visible to the user.
- Concurrency is a top-level `const CONCURRENCY = 5` in `scrape.js`, not a CLI flag — per the earlier locked decision (fixed at 5, no `--concurrency` option).

## Verification performed

- `node scrape.test.js` → "All checks passed.", including the new concurrency check.
- Live re-run against the same real collection URL used in milestone 1 (`isabydollywahal.com/collection/fiza`): same 23 products found and written, same 58-column CSV shape, log lines appeared in a different (completion) order than the sequential milestone-1 run — confirming requests are genuinely running concurrently.

No further milestones are planned in the PRD — this completes the build plan.
