# Claude Sonnet 5.5 review

Reviewed source commit: `878bf389f8c343459c54c8f405630b50114d9513`.

**APPROVE FOR PRIVATE BETA**

I found no remaining private-owner blockers in the supplied code. This is a read of the pasted code only. I did not run anything, and the 21 passing checks are your report.

**Paid receipt handling**
- **Intent before spend:** `reserveSubmission` runs serially and checks for an existing receipt, then re-validates, applies the hourly cap and writes `{state:'submitting'}` plus the ledger increment in one `storage.set`. Nothing can reach the POST without a persisted receipt. A worker kill after this point leaves a `submitting` receipt, which fails closed.
- **Ambiguous outcomes keep the receipt:** a network error, 5xx, 408, an unparseable 200 body and a 200 with an incomplete queue receipt all keep it. Resubmission then hits the `submitting` guard at line 88.
- **Receipt removal:** only the listed definitive 4xx rejections, including 429, and the post-reserve `validate()` failure remove the receipt. Both are pre-charge, and the spend count is conservatively retained.
- **Dedup:** in-memory `paidEdits` plus the persisted receipt covers concurrent preview/feed calls and worker restarts. `inflight` keys on a settings hash, and `paidEdits` on the content-addressed `jobKey`, so concurrent edits for the same video share one request.
- **Completion ordering:** `cacheSet` runs before `remove(jobKey)`, so a cache failure or worker death after fal completes resumes the same request rather than paying again.
- **Receipt hygiene:** queue URLs are origin-checked on both new and saved receipts, and the result image host is pinned to `fal.media`. Forgetting a receipt requires an options-page sender, a trusted click, an acknowledgment and an existing key.

**Non-blocking observations for the owner**
1. A `failed` receipt, or a result endpoint that keeps returning non-ok (for example a 422 after a content rejection), blocks that edit until you manually forget it in Saved request recovery. This is safe, but you will meet it eventually.
2. The status check treats any truthy `status.error` as failure. If fal ever includes a non-null error field on a completed status, it would be marked `failed` and the result would never be fetched. Checking the result endpoint first would be more robust, but this is not a spend risk.
3. The spend cap is a request-count cap, as the README says, not a dollar limit. The fixed window allows up to 2× the cap across a window boundary.
4. The test harness stubs `setTimeout` to run immediately, so the 120-iteration polling timeout is exercised only logically, not in real time.

Public release stays gated on the documented licensing and provenance work.

## Verification run by Codex

A clean Git archive was installed with `npm ci --ignore-scripts` and passed `npm test`: 8 Node test cases and 13 worker assertions. No fal generations were submitted during this release work. The actual comparison controller was also exercised in a browser using saved, previously approved images; the installed YouTube controls switched between Before and After.

The final documentation-only commit adds this receipt. The reviewed runtime and tests are unchanged.
