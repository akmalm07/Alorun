import test from "node:test";
import assert from "node:assert/strict";
import { relevantSettings, isPinned } from "../src/domain/settings-chat";
import { threadMetaSchema } from "../src/shared/contracts";

test("settings guide returns relevant controls without inventing unknown settings", () => {
  assert.equal(relevantSettings("save my chat history")[0].id, "history");
  assert.equal(
    relevantSettings("change my theme to black")[0].id,
    "appearance",
  );
  assert.equal(relevantSettings("stop voice check-ins")[0].id, "checkins");
  assert.deepEqual(relevantSettings("change my submarine engine"), []);
  assert.ok(
    relevantSettings("delete account history and reminders").length <= 3,
  );
});
test("manual pin and unpin override automatic importance", () => {
  assert.equal(isPinned({ manualPin: "pinned", autoPin: false }), true);
  assert.equal(isPinned({ manualPin: "unpinned", autoPin: true }), false);
  assert.equal(isPinned({ manualPin: null, autoPin: true }), true);
  assert.equal(isPinned({ manualPin: null, autoPin: false }), false);
});
test("branch metadata rejects excessive snapshots and unsupported pin authority", () => {
  assert.equal(
    threadMetaSchema.safeParse({ title: "Branch", manualPin: "system" })
      .success,
    false,
  );
  assert.equal(
    threadMetaSchema.safeParse({
      title: "Branch",
      parentSnapshot: Array.from({ length: 21 }, () => ({
        role: "user",
        content: "test",
      })),
    }).success,
    false,
  );
});
