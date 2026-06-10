import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCharacterTimeContext, formatTimeAtmosphere } from "./character-time-context.ts";

test("formatTimeAtmosphere gives a persona-usable late night perception", () => {
  assert.equal(formatTimeAtmosphere(new Date(2026, 5, 3, 2, 48)), "都快凌晨三点了。");
  assert.equal(formatTimeAtmosphere(new Date(2026, 5, 3, 23, 10)), "夜已经深了。");
});

test("buildCharacterTimeContext includes recorded local time and timezone", () => {
  const context = buildCharacterTimeContext(new Date(2026, 5, 3, 2, 48));

  assert.match(context, /系统记录的本地时间：2026年6月3日 星期三 02:48/);
  assert.match(context, /时区：/);
  assert.match(context, /时间氛围：都快凌晨三点了。/);
  assert.match(context, /请以系统记录的真实时间为准/);
});
