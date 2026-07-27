/**
 * Storage layer for `.dkk/feedback.yml` — notes about the dkk tool itself.
 *
 * Pure: no printing, no exit codes. The CLI presentation lives in
 * `commands/feedback.ts`; keeping the store separate means the numbering,
 * normalisation, and privacy rules are unit-testable without spawning a
 * subprocess.
 *
 * Design constraints:
 *  - Nothing is transmitted. This file is written locally and shared only
 *    when a human runs `dkk feedback export` and pastes the result.
 *  - Auto-context is counts-only. The file is destined for a public issue
 *    tracker, and a pack's context/item names ARE the user's confidential
 *    business domain. `capturePack` must never record a name — see
 *    ADR-0005 and the privacy assertions in tests/feedback.test.ts.
 *  - Hand-editable. Unparseable YAML is an ERROR (unlike `.dkk/drift.yml`,
 *    which warns and continues): drift state is recomputable, whereas this
 *    file holds the only copy of something a human wrote. Silently ignoring
 *    it would look like the captured feedback evaporated.
 *  - Unknown keys survive a load→save round trip, so a file written by a
 *    newer dkk is not shredded by an older one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { feedbackFile } from "../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../shared/yaml.js";
import { loadDomainModel } from "../../shared/loader.js";
import { forEachItem } from "../../shared/item-visitor.js";
import { pkgVersion } from "../../version.js";

// ── Types ─────────────────────────────────────────────────────────────

/** Triage buckets. `docs` is its own lane: real gap, no code change. */
export const FEEDBACK_KINDS = ["bug", "friction", "idea", "docs"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Non-identifying runtime facts. See the privacy note above. */
export interface FeedbackEnv {
  /** dkk version the friction was hit on. */
  dkk: string;
  /** `process.version` — Node 21 vs 24 divergence is a real bug source. */
  node: string;
  /** `process.platform` — path separators, spawn behaviour, native builds. */
  platform: string;
  /** Best-effort: `claude-code` | `copilot` | `unknown`. */
  agent: string;
}

/**
 * Pack shape — **counts only, never names**. The single strongest
 * reproduction signal ("4 contexts / 63 items" vs "47 / 900 / 6 peers")
 * without disclosing anything about the user's business.
 */
export interface FeedbackPack {
  /** False when the model could not be read (often the very reason for the report). */
  loaded: boolean;
  contexts?: number;
  items?: number;
  adrs?: number;
  actors?: number;
  flows?: number;
  federated?: boolean;
  peers?: number;
}

/** One recorded note. Unknown keys from newer versions are preserved. */
export interface FeedbackEntry {
  id: string;
  kind: FeedbackKind;
  summary: string;
  detail?: string;
  /** The dkk invocation that provoked this, when the caller supplied one. */
  command?: string;
  /** Local `YYYY-MM-DD`. Never a wall-clock time — that discloses working hours. */
  date: string;
  shared: boolean;
  env?: FeedbackEnv;
  pack?: FeedbackPack;
  [key: string]: unknown;
}

export interface FeedbackFile {
  /** Schema version, so a future migration has something to branch on. */
  version: 1;
  entries: FeedbackEntry[];
}

/** Result of a load: the usable file plus how much was unusable. */
export interface LoadResult {
  file: FeedbackFile;
  /** Entries dropped during normalisation. Writers must refuse when > 0. */
  skipped: number;
}

/** Raised when `.dkk/feedback.yml` exists but cannot be parsed as YAML. */
export class FeedbackParseError extends Error {}

// ── Load / save ───────────────────────────────────────────────────────

/**
 * Read `.dkk/feedback.yml`, normalising defensively.
 *
 * A missing file yields an empty log. A malformed *entry* is dropped and
 * counted in `skipped`. Unparseable YAML throws {@link FeedbackParseError}
 * — the caller must surface it rather than pretend the log is empty.
 */
export function loadFeedback(root?: string): LoadResult {
  const path = feedbackFile(root);
  if (!existsSync(path)) return { file: { version: 1, entries: [] }, skipped: 0 };

  let raw: unknown;
  try {
    raw = parseYaml<unknown>(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new FeedbackParseError(err instanceof Error ? err.message : String(err));
  }

  const entries: FeedbackEntry[] = [];
  let skipped = 0;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const list = (raw as Record<string, unknown>).entries;
    if (Array.isArray(list)) {
      for (const candidate of list) {
        const entry = normaliseEntry(candidate);
        if (entry) entries.push(entry);
        else skipped++;
      }
    } else if (list !== undefined) {
      // Wrong-typed `entries:` (e.g. a scalar). Not iterable as records —
      // treat the whole list as unusable rather than iterating a string.
      skipped++;
    }
  } else if (raw !== null && raw !== undefined) {
    skipped++;
  }

  return { file: { version: 1, entries }, skipped };
}

/**
 * Coerce one raw list element into an entry, or `null` if it is unusable.
 * Unknown keys are carried through verbatim (forward compatibility).
 */
function normaliseEntry(candidate: unknown): FeedbackEntry | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const r = candidate as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.summary !== "string" || !r.summary) return null;

  const kind = FEEDBACK_KINDS.includes(r.kind as FeedbackKind)
    ? (r.kind as FeedbackKind)
    : "friction";

  return {
    ...r,
    id: r.id,
    kind,
    summary: r.summary,
    detail: typeof r.detail === "string" ? r.detail : undefined,
    command: typeof r.command === "string" ? r.command : undefined,
    date: typeof r.date === "string" ? r.date : normaliseDate(r.date),
    shared: r.shared === true,
  };
}

/**
 * js-yaml turns an unquoted `date: 2026-07-27` into a `Date`. Same
 * round-trip guard as `adr-parser.ts` / `refactor-helpers.ts`.
 */
function normaliseDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return today();
}

const FILE_HEADER = `# DKK feedback — notes about the dkk tool itself, captured locally.
#
# Nothing leaves this repo. \`dkk feedback export\` prints a report that YOU
# choose to paste somewhere. Safe to hand-edit: redact anything you would
# not want in a public issue, or drop an entry with \`dkk feedback rm <id>\`.
`;

/** Write the log back, with the explanatory header above the YAML. */
export function saveFeedback(file: FeedbackFile, root?: string): void {
  const path = feedbackFile(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, FILE_HEADER + stringifyYaml(file), "utf-8");
}

// ── Ids ───────────────────────────────────────────────────────────────

/**
 * Next `fb-NNNN` id: highest existing number + 1 (not count + 1, so a
 * removed entry never causes a collision). Mirrors `nextAdrNumber`.
 */
export function nextFeedbackId(entries: FeedbackEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = /^fb-(\d{4,})$/.exec(e.id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `fb-${String(max + 1).padStart(4, "0")}`;
}

/** Local `YYYY-MM-DD` (not `toISOString()`, which shifts across timezones). */
export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ── Auto-context capture ──────────────────────────────────────────────

/**
 * Which agent (if any) we appear to be running under. Best-effort from
 * environment variables; wrong answers are harmless, so no probing.
 */
function detectAgent(): string {
  const env = process.env;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude-code";
  if (env.TERM_PROGRAM === "vscode" || env.VSCODE_PID || env.VSCODE_GIT_IPC_HANDLE) {
    return "copilot";
  }
  return "unknown";
}

/**
 * Non-identifying runtime facts. Deliberately excludes cwd, hostname,
 * username, git remote, and install mode (the last would cost a
 * ~10s `npm root -g` shell-out, which a capture command cannot afford).
 */
export function captureEnv(): FeedbackEnv {
  return {
    dkk: pkgVersion,
    node: process.version,
    platform: process.platform,
    agent: detectAgent(),
  };
}

/**
 * Pack size, counts only. Never records a context, item, actor, ADR, or
 * flow NAME — see the privacy constraint at the top of this file. Any
 * loader failure degrades to `{ loaded: false }`: filing feedback
 * *because* the model will not load is the modal case.
 */
export function capturePack(root?: string): FeedbackPack {
  try {
    const model = loadDomainModel({ root });
    let items = 0;
    for (const ctx of model.contexts.values()) {
      forEachItem(ctx, () => {
        items++;
      });
    }
    const pack: FeedbackPack = {
      loaded: true,
      contexts: model.contexts.size,
      items,
      adrs: model.adrs.size,
      actors: model.actors.length,
      flows: model.index.flows?.length ?? 0,
    };
    if (model.service) {
      pack.federated = true;
      pack.peers = model.peers?.size ?? 0;
    }
    return pack;
  } catch {
    return { loaded: false };
  }
}
