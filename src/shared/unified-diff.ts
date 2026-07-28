/**
 * Minimal unified-diff renderer.
 *
 * Exists so `dkk update --diff` / `dkk artifacts check --diff` can show what
 * an overwrite would actually change. Listing paths tells a user *that* they
 * are about to lose something; only the content tells them *what*, and a
 * y/N prompt without that is not a decision.
 *
 * Deliberately dependency-free and deliberately small: DKK's artifacts are
 * short text files (hook scripts, Markdown skills, prompt files), so an
 * O(n·m) LCS over the non-common middle is comfortably fast. Anything that
 * would blow that budget renders a one-line "too large" note instead of
 * silently truncating.
 */

/** Line budget for the LCS table after common prefix/suffix are stripped. */
const MAX_LCS_LINES = 2_000;

export interface UnifiedDiffOptions {
  /** Label for the `---` header line. Defaults to `a`. */
  fromLabel?: string;
  /** Label for the `+++` header line. Defaults to `b`. */
  toLabel?: string;
  /** Unchanged lines kept around each change. Defaults to 3. */
  context?: number;
}

type OpKind = "eq" | "del" | "ins";

interface Op {
  kind: OpKind;
  line: string;
}

/**
 * Render a unified diff of `oldText` → `newText`.
 *
 * Returns an empty string when the two are identical, so callers can use the
 * result's emptiness as "no change" without a separate comparison.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  opts: UnifiedDiffOptions = {},
): string {
  if (oldText === newText) return "";

  const context = opts.context ?? 3;
  const fromLabel = opts.fromLabel ?? "a";
  const toLabel = opts.toLabel ?? "b";

  const a = splitLines(oldText);
  const b = splitLines(newText);

  const ops = diffOps(a, b);
  if (ops === null) {
    return [
      `--- ${fromLabel}`,
      `+++ ${toLabel}`,
      `@@ files differ; too large for an inline diff (${a.length} vs ${b.length} lines) @@`,
    ].join("\n");
  }

  const hunks = buildHunks(ops, context);
  if (hunks.length === 0) return "";

  return [`--- ${fromLabel}`, `+++ ${toLabel}`, ...hunks].join("\n");
}

/**
 * Split into lines for diffing. A trailing newline is dropped rather than
 * yielding a phantom empty final line, which would show up as a spurious
 * change whenever only one side ends with `\n`.
 */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence diff, returning `null` when the changed region
 * exceeds {@link MAX_LCS_LINES} on either side.
 *
 * Common prefix and suffix are stripped first: for the usual case (a template
 * bump touching a handful of lines) that collapses the table to almost
 * nothing, so the cap is only ever reached by genuinely unrelated files.
 */
function diffOps(a: string[], b: string[]): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) return null;

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: "eq", line: a[i] });
  ops.push(...lcsOps(midA, midB));
  for (let i = endA; i < a.length; i++) ops.push({ kind: "eq", line: a[i] });
  return ops;
}

/** Classic O(n·m) LCS table, walked back into an edit script. */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: "ins" as const, line }));
  if (m === 0) return a.map((line) => ({ kind: "del" as const, line }));

  // Row-major (n+1)×(m+1) table in one flat array.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", line: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ kind: "del", line: a[i] });
      i++;
    } else {
      ops.push({ kind: "ins", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++] });
  while (j < m) ops.push({ kind: "ins", line: b[j++] });
  return ops;
}

/**
 * Group the edit script into `@@` hunks, each carrying `context` unchanged
 * lines on either side. Adjacent changes whose context windows touch are
 * merged into one hunk rather than emitted separately.
 */
function buildHunks(ops: Op[], context: number): string[] {
  const changed: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind !== "eq") changed.push(i);
  }
  if (changed.length === 0) return [];

  // Merge change indices into ranges separated by more than 2·context
  // unchanged lines — anything closer belongs in the same hunk.
  const ranges: Array<{ from: number; to: number }> = [];
  let from = changed[0];
  let to = changed[0];
  for (const idx of changed.slice(1)) {
    if (idx - to > context * 2) {
      ranges.push({ from, to });
      from = idx;
    }
    to = idx;
  }
  ranges.push({ from, to });

  // Line numbers are 1-based and advance only for the side that has the line.
  const oldNo: number[] = new Array(ops.length);
  const newNo: number[] = new Array(ops.length);
  let o = 1;
  let nw = 1;
  for (let i = 0; i < ops.length; i++) {
    oldNo[i] = o;
    newNo[i] = nw;
    if (ops[i].kind !== "ins") o++;
    if (ops[i].kind !== "del") nw++;
  }

  const out: string[] = [];
  for (const range of ranges) {
    const startIdx = Math.max(0, range.from - context);
    const endIdx = Math.min(ops.length - 1, range.to + context);

    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const op = ops[i];
      if (op.kind === "eq") {
        oldCount++;
        newCount++;
        body.push(` ${op.line}`);
      } else if (op.kind === "del") {
        oldCount++;
        body.push(`-${op.line}`);
      } else {
        newCount++;
        body.push(`+${op.line}`);
      }
    }

    // An empty side is rendered at line 0 per the unified-diff convention.
    const oldStart = oldCount === 0 ? 0 : oldNo[startIdx];
    const newStart = newCount === 0 ? 0 : newNo[startIdx];
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    out.push(...body);
  }
  return out;
}
