import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionsSchema,
  draftActions,
  draftLayout,
  type Control,
} from "../src/browser/plans";
import {
  decodeSite,
  hostPattern,
  pageAddress,
  pageRequest,
} from "../src/browser/protocol";

const controls: Control[] = [
  { label: "Dashboard", kind: "link" },
  { label: "Reports", kind: "link" },
  { label: "New note", kind: "button" },
];

test("generates ordered shortcuts and responsive layout preferences", () => {
  const { layout } = draftLayout(
    'Put "New note" and Reports in a compact, three-column panel at the bottom. Most visited first.',
    controls,
  );
  assert.deepEqual(layout, {
    shortcuts: [controls[2], controls[1]],
    position: "bottom",
    density: "compact",
    columns: 3,
    first: "visits",
  });
});

test("refines the last layout and reports missing controls", () => {
  const { layout } = draftLayout(
    'Add "Reports" and "New note" at the top.',
    controls,
  );
  const refinement = draftLayout(
    'Add "Dashboard" and "Billing" in one column.',
    controls,
    layout,
  );
  assert.deepEqual(refinement.layout.shortcuts, [
    controls[0],
    controls[1],
    controls[2],
  ]);
  assert.match(refinement.message, /couldn't find “billing”/);
  assert.deepEqual(
    draftLayout('Remove "Reports".', controls, refinement.layout).layout
      .shortcuts,
    [controls[0], controls[2]],
  );
  assert.deepEqual(
    draftLayout("Clear shortcuts and put most visited first", controls, layout)
      .layout.shortcuts,
    [],
  );
  assert.deepEqual(
    draftLayout('Keep only "Reports"', controls, refinement.layout).layout
      .shortcuts,
    [controls[1]],
  );
  assert.throws(() => draftLayout('Add "Billing".', controls), /couldn't find/);
  assert.throws(
    () => draftLayout("Tell me something", controls),
    /Try a position/,
  );
});

test("parses a sequence while preserving punctuation, quotes and Unicode in typed text", () => {
  assert.deepEqual(
    draftActions(
      'Click New note; then type "Draft \\"update\\"; then café 👋" into "Note".',
    ),
    [
      { kind: "click", target: "New note" },
      { kind: "type", target: "Note", text: 'Draft "update"; then café 👋' },
    ],
  );
  assert.deepEqual(
    draftActions('Type "a" in Search and then click "Reports"'),
    [
      { kind: "type", target: "Search", text: "a" },
      { kind: "click", target: "Reports" },
    ],
  );
});

test("rejects unsupported, incomplete and oversized action plans", () => {
  assert.throws(
    () => draftActions("Open a website and download a file"),
    /Try/,
  );
  assert.throws(() => draftActions("Type draft into Note"), /double quotes/);
  assert.throws(() => draftActions("Click Reports; then"), /Try/);
  assert.throws(
    () => draftActions(Array(7).fill('Click "Reports"').join("; ")),
    /six/,
  );
  assert.ok(
    !actionsSchema.safeParse([{ kind: "script", code: "alert(1)" }]).success,
  );
});

test("keeps layouts scoped by origin and route and validates browser messages", () => {
  assert.deepEqual(
    pageAddress("https://work.example/new?token=secret#/reports?select=three"),
    {
      origin: "https://work.example",
      path: "/new#/reports",
    },
  );
  assert.deepEqual(pageAddress("https://work.example/a#section"), {
    origin: "https://work.example",
    path: "/a",
  });
  assert.equal(
    hostPattern("http://127.0.0.1:41287/dash"),
    "http://127.0.0.1/*",
  );
  assert.equal(pageAddress("chrome://extensions"), null);
  assert.equal(pageAddress("https://user:pass@work.example/"), null);
  assert.ok(
    !pageRequest.safeParse({
      type: "run",
      scope: { instance: "wrong", href: "https://work.example" },
      actions: [],
    }).success,
  );
  assert.deepEqual(decodeSite({ pages: {}, visits: "bad" }), {
    pages: {},
    visits: [],
  });
});
