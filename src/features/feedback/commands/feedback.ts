/**
 * `dkk feedback` — capture friction with dkk itself, share it deliberately.
 *
 * dkk runs inside other people's repos, mostly from inside an AI coding
 * session. When it misbehaves the friction is felt mid-task, and filing an
 * issue means breaking flow — so it never happens and the maintainers never
 * hear about it. This closes that loop without any network egress:
 *
 *   dkk feedback add "<summary>"   record a note while it's fresh
 *   dkk feedback                   list what's been recorded (default)
 *   dkk feedback export            print a paste-ready Markdown report
 *   dkk feedback rm <id…>          drop an entry (redaction escape hatch)
 *
 * Design constraints:
 *  - Nothing is transmitted, ever. `export` writes Markdown to stdout and a
 *    human decides where it goes. dkk makes no HTTP calls anywhere.
 *  - stdout is the artifact. `export` puts ONLY the Markdown on stdout and
 *    every hint on stderr, so `| pbcopy` and `| gh issue create --body-file -`
 *    both work. This is a deliberate deviation from the other commands.
 *  - `export` is read-only by default; `--mark-shared` is opt-in. A command
 *    you pipe must be idempotent, or `| head` silently mutates state.
 *  - Never write on a partially-unreadable log. If normalisation dropped
 *    entries, mutating commands refuse rather than saving the survivors —
 *    normalise-then-save is silent data loss of something a human typed.
 *  - `list` is the default subcommand: a bare invocation must never mutate,
 *    and the empty state is where the onboarding copy belongs.
 */
import type { Command as Cmd } from "commander";
import { feedbackFile } from "../../../shared/paths.js";
import {
  FEEDBACK_KINDS,
  FeedbackParseError,
  captureEnv,
  capturePack,
  loadFeedback,
  nextFeedbackId,
  saveFeedback,
  today,
  type FeedbackEntry,
  type FeedbackKind,
} from "../store.js";

/** Where a report ends up. Printed, never fetched. */
const ISSUES_URL = "https://github.com/hakankaan/domain-knowledge-kit/issues";
const REPO_SLUG = "hakankaan/domain-knowledge-kit";

interface CommonOpts {
  root?: string;
  json?: boolean;
  minify?: boolean;
}

function toJson(payload: unknown, opts: CommonOpts): string {
  return JSON.stringify(payload, null, opts.minify ? 0 : 2);
}

/** Print `Error: …` and exit 1 — the house error path. */
function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * Load, converting the two failure modes into CLI errors. `forWrite`
 * additionally refuses when any entry was unusable, so a mutating command
 * never rewrites the file with someone's note missing.
 */
function loadOrFail(root: string | undefined, forWrite: boolean) {
  let result;
  try {
    result = loadFeedback(root);
  } catch (err) {
    if (err instanceof FeedbackParseError) {
      fail(
        `.dkk/feedback.yml could not be parsed as YAML — ${err.message.split("\n")[0]}\n` +
          "  Fix it by hand (or move it aside) so nothing you captured is lost.",
      );
    }
    throw err;
  }
  if (forWrite && result.skipped > 0) {
    fail(
      `.dkk/feedback.yml contains ${result.skipped} malformed entry(s).\n` +
        "  Refusing to write — fix or remove them first, so nothing you captured is lost.",
    );
  }
  return result;
}

// ── add ───────────────────────────────────────────────────────────────

interface AddOpts extends CommonOpts {
  kind: string;
  detail?: string;
  command?: string;
}

function runAdd(summary: string, opts: AddOpts): void {
  if (!summary.trim()) fail("Summary must not be empty.");

  if (!FEEDBACK_KINDS.includes(opts.kind as FeedbackKind)) {
    fail(`Invalid kind "${opts.kind}". Must be one of: ${FEEDBACK_KINDS.join(", ")}.`);
  }
  const kind = opts.kind as FeedbackKind;

  const { file } = loadOrFail(opts.root, true);
  const entry: FeedbackEntry = {
    id: nextFeedbackId(file.entries),
    kind,
    summary: summary.trim(),
    detail: opts.detail?.trim() || undefined,
    command: opts.command?.trim() || undefined,
    date: today(),
    shared: false,
    env: captureEnv(),
    pack: capturePack(opts.root),
  };
  file.entries.push(entry);
  saveFeedback(file, opts.root);

  const total = file.entries.length;
  const unshared = file.entries.filter((e) => !e.shared).length;

  if (opts.json) {
    console.log(
      toJson(
        {
          id: entry.id,
          path: feedbackFile(opts.root),
          kind: entry.kind,
          summary: entry.summary,
          total,
          unshared,
        },
        opts,
      ),
    );
    return;
  }

  console.log(`✓ Recorded ${entry.id} (${entry.kind}) in .dkk/feedback.yml`);
  console.log(`  "${entry.summary}"`);
  console.log(
    `  ${total} total, ${unshared} unshared — run \`dkk feedback export\` when you're ready to share.`,
  );
}

// ── list ──────────────────────────────────────────────────────────────

interface ListOpts extends CommonOpts {
  kind?: string;
  unshared?: boolean;
}

/**
 * Apply the `--kind` / `--unshared` filters. Pure — no printing,
 * no exit codes.
 */
export function filterEntries(
  entries: FeedbackEntry[],
  filters: { kind?: string; unshared?: boolean },
): FeedbackEntry[] {
  return entries.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (filters.unshared && e.shared) return false;
    return true;
  });
}

function validateKindFilter(kind: string | undefined): void {
  if (kind && !FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
    fail(`Invalid kind "${kind}". Must be one of: ${FEEDBACK_KINDS.join(", ")}.`);
  }
}

function runList(opts: ListOpts): void {
  validateKindFilter(opts.kind);
  const { file, skipped } = loadOrFail(opts.root, false);
  const all = file.entries;
  const shown = filterEntries(all, { kind: opts.kind, unshared: opts.unshared });
  const unshared = all.filter((e) => !e.shared).length;

  if (opts.json) {
    console.log(
      toJson(
        {
          path: feedbackFile(opts.root),
          total: all.length,
          unshared,
          skipped,
          entries: shown,
        },
        opts,
      ),
    );
    return;
  }

  if (skipped > 0) {
    console.log(
      `⚠ Skipped ${skipped} malformed entry(s) in .dkk/feedback.yml — fix them by hand.`,
    );
  }

  // Never adopted: teach instead of reporting an empty table.
  if (all.length === 0) {
    console.log("No feedback recorded yet.\n");
    console.log("Hit a rough edge in dkk — a bug, a confusing error, a missing capability?");
    console.log("Capture it while it's fresh:\n");
    console.log('  dkk feedback add "dkk rename left an ADR ref stale" --kind bug \\');
    console.log('    --command "dkk rename ordering.OrderPlaced ordering.OrderConfirmed"\n');
    console.log(
      "Nothing leaves this repo. `dkk feedback export` prints a report you choose to share.",
    );
    return;
  }

  // Adopted, but this filter matched nothing — a different message.
  if (shown.length === 0) {
    const applied = [
      opts.kind ? `kind: ${opts.kind}` : null,
      opts.unshared ? "unshared only" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `No feedback matches (${applied}). ${all.length} entry(s) recorded in total.`,
    );
    return;
  }

  console.log(`\n📝 DKK feedback (${all.length} total, ${unshared} unshared)\n`);
  const kindWidth = Math.max(...shown.map((e) => e.kind.length));
  for (const e of shown) {
    const state = e.shared ? "shared" : "new   ";
    console.log(
      `  ${e.id}  ${e.kind.padEnd(kindWidth)}  ${e.date}  ${state}  ${e.summary}`,
    );
  }
  if (unshared > 0) {
    console.log(
      `\n  ℹ ${unshared} unshared — \`dkk feedback export\` produces a paste-ready report for`,
    );
    console.log(`    ${ISSUES_URL}\n`);
  } else {
    console.log("");
  }
}

// ── export: rendering (pure — no printing, no exit codes) ─────────────

function envLine(e: FeedbackEntry): string | null {
  if (!e.env) return null;
  return `**Environment:** dkk ${e.env.dkk} · node ${e.env.node} · ${e.env.platform} · agent ${e.env.agent}`;
}

function packLine(e: FeedbackEntry): string | null {
  const p = e.pack;
  if (!p) return null;
  if (!p.loaded) return "**Pack:** could not be loaded";
  const parts = [
    `${p.contexts ?? 0} context(s)`,
    `${p.items ?? 0} item(s)`,
    `${p.adrs ?? 0} ADR(s)`,
    `${p.actors ?? 0} actor(s)`,
    `${p.flows ?? 0} flow(s)`,
  ];
  if (p.federated) parts.push(`federated (${p.peers ?? 0} peer(s))`);
  return `**Pack:** ${parts.join(", ")}`;
}

/**
 * Render the maintainer-facing report.
 *
 * Environment/pack lines are hoisted into the header when every entry
 * agrees, and repeated per-entry only where they differ — so the common
 * report stays scannable while genuine version skew inside one report
 * stays visible.
 */
export function exportMarkdown(entries: FeedbackEntry[]): string {
  if (entries.length === 0) {
    return "## DKK feedback\n\nNothing to report.\n";
  }

  const contexts = entries.map((e) => `${envLine(e) ?? ""}\n${packLine(e) ?? ""}`);
  const uniform = contexts.every((c) => c === contexts[0]) && contexts[0].trim() !== "";

  const out: string[] = [];
  out.push(`## DKK feedback — ${entries.length} item(s)`);
  out.push("");
  out.push(
    "Captured with `dkk feedback` in a consuming project. Nothing was transmitted;",
  );
  out.push("this report was exported and shared by hand.");
  if (uniform) {
    out.push("");
    const env = envLine(entries[0]);
    const pack = packLine(entries[0]);
    if (env) out.push(env);
    if (pack) out.push(pack);
  }

  for (const e of entries) {
    out.push("");
    out.push("---");
    out.push("");
    out.push(`### ${e.id} — ${e.kind} — ${e.date}`);
    out.push("");
    out.push(e.summary);
    if (!uniform) {
      const env = envLine(e);
      const pack = packLine(e);
      if (env || pack) {
        out.push("");
        if (env) out.push(env);
        if (pack) out.push(pack);
      }
    }
    if (e.detail) {
      out.push("");
      out.push("**Detail**");
      out.push("");
      out.push("```");
      out.push(e.detail.trimEnd());
      out.push("```");
    }
    if (e.command) {
      out.push("");
      out.push(`**Command:** \`${e.command}\``);
    }
  }
  out.push("");
  return out.join("\n");
}

/**
 * The URL to open for a new issue.
 *
 * Only the *title* is ever prefilled, and only for a single-entry export:
 * URL-encoding Markdown roughly triples its length, so a prefilled `body`
 * would silently truncate the tail of a multi-entry bug report — the worst
 * available failure mode. Bodies go through copy-paste or `--body-file -`.
 */
export function issueUrl(entries: FeedbackEntry[]): string {
  if (entries.length === 1) {
    const title = encodeURIComponent(`[feedback] ${entries[0].summary}`);
    if (title.length <= 400) return `${ISSUES_URL}/new?title=${title}`;
  }
  return `${ISSUES_URL}/new`;
}

// ── export: CLI presentation ──────────────────────────────────────────

interface ExportOpts extends CommonOpts {
  all?: boolean;
  kind?: string;
  markShared?: boolean;
}

function runExport(opts: ExportOpts): void {
  validateKindFilter(opts.kind);
  // Only a --mark-shared run mutates, so only it demands a clean load.
  const { file } = loadOrFail(opts.root, Boolean(opts.markShared));
  const selected = filterEntries(file.entries, {
    kind: opts.kind,
    unshared: !opts.all,
  });

  const markdown = exportMarkdown(selected);
  const url = issueUrl(selected);

  if (opts.markShared && selected.length > 0) {
    const ids = new Set(selected.map((e) => e.id));
    for (const e of file.entries) if (ids.has(e.id)) e.shared = true;
    saveFeedback(file, opts.root);
  }

  if (opts.json) {
    console.log(
      toJson(
        {
          count: selected.length,
          total: file.entries.length,
          ids: selected.map((e) => e.id),
          markdown,
          issueUrl: url,
          markedShared: Boolean(opts.markShared) && selected.length > 0,
        },
        opts,
      ),
    );
    return;
  }

  if (selected.length === 0) {
    // stdout stays empty so `> report.md` yields an empty file, not noise.
    if (file.entries.length === 0) {
      console.error("Nothing to export — no feedback recorded yet. Try `dkk feedback add`.");
    } else if (!opts.all) {
      console.error(
        `Nothing to export — all ${file.entries.length} entry(s) are already marked shared. Use --all to re-export.`,
      );
    } else {
      console.error(`Nothing to export — no entry matches (kind: ${opts.kind}).`);
    }
    return;
  }

  process.stdout.write(markdown);

  const scope = opts.all ? "all" : "unshared only";
  console.error(
    `\nExported ${selected.length} of ${file.entries.length} entry(s) (${scope}).\n`,
  );
  console.error(
    "Review the report before pasting — it may contain paths or excerpts you typed",
  );
  console.error("into --detail.\n");
  console.error("Open a new issue and paste stdout:");
  console.error(`  ${url}\n`);
  console.error("Or pipe it straight there with the GitHub CLI:");
  console.error("  dkk feedback export --mark-shared | gh issue create \\");
  console.error(`    --repo ${REPO_SLUG} \\`);
  console.error(
    `    --title "DKK feedback (${selected.length} item(s))" --body-file -\n`,
  );
  if (opts.markShared) {
    console.error("Marked as shared — the next export will skip them.");
  } else {
    console.error("Re-run with --mark-shared to keep these out of the next export.");
  }
}

// ── rm ────────────────────────────────────────────────────────────────

function runRm(ids: string[], opts: CommonOpts): void {
  const { file } = loadOrFail(opts.root, true);

  for (const id of ids) {
    const matches = file.entries.filter((e) => e.id === id);
    if (matches.length === 0) fail(`No entry with id "${id}".`);
    if (matches.length > 1) {
      fail(
        `Id "${id}" is ambiguous (${matches.length} entries — likely a merge).\n` +
          "  Edit .dkk/feedback.yml by hand.",
      );
    }
  }

  const removing = new Set(ids);
  file.entries = file.entries.filter((e) => !removing.has(e.id));
  saveFeedback(file, opts.root);

  const total = file.entries.length;
  const unshared = file.entries.filter((e) => !e.shared).length;

  if (opts.json) {
    console.log(toJson({ removed: ids, path: feedbackFile(opts.root), total, unshared }, opts));
    return;
  }
  console.log(`Removed ${ids.join(", ")} from .dkk/feedback.yml.`);
  console.log(`${total} total, ${unshared} unshared.`);
}

// ── Registration ──────────────────────────────────────────────────────

export function registerFeedback(program: Cmd): void {
  const feedback = program
    .command("feedback")
    .description("Record and share feedback about dkk itself (local file, never transmitted)")
    // A stray positional (`dkk feedback "thing broke"`) otherwise produces a
    // bare "too many arguments" with no hint that `add` is what they wanted.
    .showHelpAfterError();

  feedback
    .command("add <summary>")
    .description("Record a note about dkk itself while it's fresh")
    .option(
      "-k, --kind <kind>",
      `Triage bucket: ${FEEDBACK_KINDS.join(" | ")}`,
      "friction",
    )
    .option("-d, --detail <text>", "What happened, in full (repro steps, error output)")
    .option("--command <cmd>", "The dkk invocation that provoked this")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((summary: string, opts: AddOpts) => {
      runAdd(summary, opts);
    });

  feedback
    .command("list", { isDefault: true })
    .description("List recorded feedback")
    .option("-k, --kind <kind>", `Filter by kind: ${FEEDBACK_KINDS.join(" | ")}`)
    .option("--unshared", "Only entries not yet marked shared")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: ListOpts) => {
      runList(opts);
    });

  feedback
    .command("export")
    .description("Print a paste-ready Markdown report (stdout) for the dkk maintainers")
    .option("--all", "Include entries already marked shared")
    .option("-k, --kind <kind>", `Only this kind: ${FEEDBACK_KINDS.join(" | ")}`)
    .option("--mark-shared", "Mark the exported entries as shared (mutates the file)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: ExportOpts) => {
      runExport(opts);
    });

  feedback
    .command("rm <ids...>")
    .description("Remove entries (use this to redact something you'd rather not share)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((ids: string[], opts: CommonOpts) => {
      runRm(ids, opts);
    });
}
