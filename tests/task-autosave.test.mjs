import assert from "node:assert/strict";
import test from "node:test";
import { createTaskAutosave } from "../lib/task-autosave.ts";

test("clicking away drains in-flight edits serially and closing twice does not duplicate saves", async () => {
  let latest = "first", saved = "original", release;
  const started = Promise.withResolvers();
  const writes = [];
  const controller = createTaskAutosave({
    read: () => latest === saved ? null : latest,
    save: async (draft) => {
      writes.push(draft);
      if (draft === "first") { started.resolve(); await new Promise((resolve) => { release = resolve; }); }
      saved = draft; return true;
    },
  });
  const close = controller.flush();
  await started.promise;
  assert.equal(controller.getState(), "saving");
  latest = "second";
  const secondClose = controller.flush();
  assert.equal(close, secondClose);
  release();
  assert.equal(await close, true);
  assert.deepEqual(writes, ["first", "second"]);
  assert.equal(saved, latest);
  assert.equal(controller.getState(), "saved");
  await controller.flush();
  assert.equal(writes.length, 2);
});

test("a failed save keeps the draft and prevents close until retry succeeds", async () => {
  let saved = "original", canSave = false;
  const controller = createTaskAutosave({ read: () => saved === "edited" ? null : "edited", save: async (draft) => { if (!canSave) return false; saved = draft; return true; } });
  controller.changed(); assert.equal(controller.getState(), "unsaved");
  assert.equal(await controller.flush(), false);
  assert.equal(controller.getState(), "error");
  assert.equal(saved, "original");
  canSave = true;
  assert.equal(await controller.flush(), true);
  assert.equal(saved, "edited");
  assert.equal(controller.getState(), "saved");
});

test("unexpected save errors leave unsaved data available for retry", async () => {
  let pending = true, fail = true;
  const controller = createTaskAutosave({ read: () => pending ? { title: "Keep this draft" } : null, save: async () => { if (fail) throw new Error("Unavailable"); pending = false; return true; } });
  assert.equal(await controller.flush(), false);
  assert.equal(pending, true);
  fail = false;
  assert.equal(await controller.flush(), true);
});

test("reverting edits and opening an unchanged task require no write", async () => {
  let draft = "unchanged", writes = 0;
  const controller = createTaskAutosave({ read: () => draft === "unchanged" ? null : draft, save: async () => { writes++; return true; } });
  await controller.flush();
  draft = "edit"; controller.changed();
  draft = "unchanged"; controller.changed();
  assert.equal(controller.getState(), "saved");
  await controller.flush(); assert.equal(writes, 0);
});
