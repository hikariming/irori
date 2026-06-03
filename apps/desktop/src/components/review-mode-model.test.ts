import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_REVIEW_MODE,
  isReviewMode,
  reviewModeOption,
  reviewModeOptions,
  sanitizeReviewMode
} from "./review-mode-model.ts";

test("default mode is the manual-review one", () => {
  assert.equal(DEFAULT_REVIEW_MODE, "default");
  assert.equal(reviewModeOption(DEFAULT_REVIEW_MODE).risky, false);
});

test("exactly three modes, only 'all' is risky", () => {
  assert.deepEqual(reviewModeOptions.map((option) => option.id), ["default", "auto", "all"]);
  assert.deepEqual(
    reviewModeOptions.filter((option) => option.risky).map((option) => option.id),
    ["all"]
  );
});

test("isReviewMode accepts known ids and rejects everything else", () => {
  assert.equal(isReviewMode("default"), true);
  assert.equal(isReviewMode("auto"), true);
  assert.equal(isReviewMode("all"), true);
  assert.equal(isReviewMode("nope"), false);
  assert.equal(isReviewMode(undefined), false);
  assert.equal(isReviewMode(2), false);
});

test("sanitizeReviewMode falls back to the safe default", () => {
  assert.equal(sanitizeReviewMode("auto"), "auto");
  assert.equal(sanitizeReviewMode("all"), "all");
  assert.equal(sanitizeReviewMode("bogus"), "default");
  assert.equal(sanitizeReviewMode(null), "default");
});

test("reviewModeOption always returns an option, even for bad input", () => {
  assert.equal(reviewModeOption("auto").id, "auto");
  // @ts-expect-error testing runtime fallback for an invalid mode
  assert.equal(reviewModeOption("bogus").id, "default");
});
