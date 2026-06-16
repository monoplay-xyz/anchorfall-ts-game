// frame-error.test.js — logic check for the frame-loop error surface formatter
// (issue #8 part A). The frame loop catch now calls showFrameError(e), which
// uses the PURE formatFrameError(err) to normalise any thrown value into
// { message, stack, key } before painting the on-screen panel. The panel paint
// itself needs the DOM, but the FORMATTING is DOM-free and is what we verify
// here: it must surface a readable message + stack and produce a stable dedupe
// key so the same error only shows once.
//
// We extract formatFrameError straight from the compiled public/client.js (so
// the test exercises the real shipped code, not a copy) — client.js is a browser
// module that touches window/document at top level, so we can't import it under
// Node; pulling out the one self-contained function is the clean way to test it.

import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, "public/client.js"), "utf8");

// Grab the function source between `function formatFrameError(err) {` and the
// matching closing brace that precedes the `const seenFrameErrors` line.
const start = src.indexOf("function formatFrameError(");
assert.ok(start !== -1, "formatFrameError not found in compiled client.js — did the build run?");
const tail = src.indexOf("const seenFrameErrors", start);
assert.ok(tail !== -1, "could not bound formatFrameError source");
const fnSrc = src.slice(start, tail).trim();

// eslint-disable-next-line no-new-func
const formatFrameError = new Function(fnSrc + "\nreturn formatFrameError;")();

// 1) a real Error: name + message in `message`, full stack in `stack`
{
  const e = new TypeError("cannot read x of undefined");
  const out = formatFrameError(e);
  assert.equal(out.message, "TypeError: cannot read x of undefined");
  assert.ok(out.stack.includes("cannot read x of undefined"), "stack carries the message");
  assert.ok(out.key.length > 0, "key is non-empty");
}

// 2) dedupe key is stable for the SAME error site (so it surfaces once)
{
  const make = () => { try { null.boom(); } catch (e) { return e; } };
  const a = formatFrameError(make());
  const b = formatFrameError(make());
  assert.equal(a.key, b.key, "same throw site -> same dedupe key (no spam)");
}

// 3) distinct errors -> distinct keys (each surfaces once)
{
  const a = formatFrameError(new Error("alpha"));
  const b = formatFrameError(new Error("beta"));
  assert.notEqual(a.key, b.key, "different errors -> different keys");
}

// 4) non-Error throws don't break the formatter
{
  const s = formatFrameError("plain string boom");
  assert.equal(s.message, "plain string boom");
  assert.ok(s.key.length > 0);

  const o = formatFrameError({ message: "obj message" });
  assert.equal(o.message, "obj message");

  const bare = formatFrameError({ code: 7 });
  assert.ok(bare.message.includes("7"), "bare object serialises to something readable");

  const n = formatFrameError(null);
  assert.equal(n.message, "null");
}

console.log("frame-error.test.js: OK (formatFrameError surfaces message+stack, dedupes by site)");
