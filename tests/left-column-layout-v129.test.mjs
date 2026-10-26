import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("v129 keeps all four strength pentagons inside the desktop control column", () => {
  assert.match(css, /\.strength-grid \{[^}]*flex:1 1 0;[^}]*min-height:0;/s);
  assert.match(css, /\.strength-pentagon svg \{[^}]*position:absolute;[^}]*inset:0;/s);
  assert.match(css, /@media \(min-width:851px\) and \(max-height:1100px\)/);
});
