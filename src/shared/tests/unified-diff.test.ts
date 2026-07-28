/**
 * Tests for the unified-diff renderer behind `--diff`.
 *
 * The properties that matter for a confirmation prompt: identical input must
 * render nothing (so callers can use emptiness as "no change"), a changed
 * line must show both the old and the new text, hunk headers must count
 * lines correctly, and a distant second change must not be swallowed into
 * the first hunk's context.
 */
import { unifiedDiff } from "../unified-diff.js";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n=== unified-diff: identical input renders nothing ===");
{
  assert("same string → empty", unifiedDiff("a\nb\nc\n", "a\nb\nc\n") === "");
  assert("both empty → empty", unifiedDiff("", "") === "");
  // A trailing newline is not a change: splitLines drops the phantom final
  // empty line, or every template comparison would show a spurious edit.
  assert("trailing-newline-only difference → empty", unifiedDiff("a\nb", "a\nb\n") === "");
}

console.log("\n=== unified-diff: a changed line shows both sides ===");
{
  const out = unifiedDiff("alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\n", {
    fromLabel: "local",
    toLabel: "template",
  });
  assert("carries the from label", out.includes("--- local"));
  assert("carries the to label", out.includes("+++ template"));
  assert("shows the removed line", out.includes("-beta"));
  assert("shows the added line", out.includes("+BETA"));
  assert("keeps surrounding context", out.includes(" alpha") && out.includes(" gamma"));
  assert("emits exactly one hunk", out.split("@@ -").length === 2, out);
}

console.log("\n=== unified-diff: hunk headers count both sides ===");
{
  // 3 context + 1 removed = 4 old lines; 3 context + 2 added = 5 new lines.
  const oldText = "1\n2\n3\nX\n";
  const newText = "1\n2\n3\nA\nB\n";
  const out = unifiedDiff(oldText, newText);
  assert("header reports old range", out.includes("@@ -1,4 +1,5 @@"), out);
}

console.log("\n=== unified-diff: pure insertion and pure deletion ===");
{
  const added = unifiedDiff("", "hello\n");
  assert("insertion into an empty file shows the line", added.includes("+hello"));
  assert("insertion reports a zero-length old side", added.includes("@@ -0,0"), added);

  const removed = unifiedDiff("hello\n", "");
  assert("deletion to an empty file shows the line", removed.includes("-hello"));
  assert("deletion reports a zero-length new side", removed.includes("+0,0"), removed);
}

console.log("\n=== unified-diff: distant changes get separate hunks ===");
{
  const base = Array.from({ length: 40 }, (_, i) => `line${i}`);
  const edited = [...base];
  edited[2] = "CHANGED-EARLY";
  edited[35] = "CHANGED-LATE";
  const out = unifiedDiff(base.join("\n") + "\n", edited.join("\n") + "\n");
  assert("two separate hunks", out.split("@@ -").length === 3, out);
  assert("first change present", out.includes("+CHANGED-EARLY"));
  assert("second change present", out.includes("+CHANGED-LATE"));
  // Between the two changes there are ~30 unchanged lines; they must not all
  // be dumped into the output.
  assert("untouched middle is elided", !out.includes(" line20"), out);
}

console.log("\n=== unified-diff: adjacent changes merge into one hunk ===");
{
  const base = Array.from({ length: 20 }, (_, i) => `line${i}`);
  const edited = [...base];
  edited[5] = "A";
  edited[7] = "B";
  const out = unifiedDiff(base.join("\n") + "\n", edited.join("\n") + "\n");
  assert("changes 2 apart share a hunk", out.split("@@ -").length === 2, out);
}

console.log("\n=== unified-diff: CRLF is normalised, not reported as change ===");
{
  assert("CRLF vs LF → empty", unifiedDiff("a\r\nb\r\n", "a\nb\n") === "");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
