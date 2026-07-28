/**
 * Tests for `.dkk/artifacts.lock` read/write.
 *
 * The load-bearing invariant is what `writeArtifactLock` *refuses* to record:
 * a file whose on-disk content differs from the template must keep the hash
 * of the version DKK actually wrote. Refreshing it would adopt the user's
 * edit as DKK's own, and the next upgrade would overwrite it silently — the
 * exact failure the lock exists to prevent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARTIFACT_LOCK_VERSION,
  artifactLockPath,
  readArtifactLock,
  sha256,
  writeArtifactLock,
} from "../artifact-lock.js";
import type { ShippedArtifact } from "../dkk-artifacts.js";

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

const roots: string[] = [];

/** Fresh temp repo with a `.dkk/` and a template dir. */
function makeRoot(): { root: string; templateDir: string } {
  const root = mkdtempSync(join(tmpdir(), "dkk-lock-"));
  roots.push(root);
  mkdirSync(join(root, ".dkk"), { recursive: true });
  const templateDir = join(root, "__template");
  mkdirSync(templateDir, { recursive: true });
  return { root, templateDir };
}

/** Register a shipped artifact, writing both template and destination. */
function ship(
  root: string,
  templateDir: string,
  rel: string,
  templateContent: string,
  onDiskContent: string | null,
): ShippedArtifact {
  const src = join(templateDir, rel.replace(/\//g, "_"));
  writeFileSync(src, templateContent, "utf-8");
  const dest = join(root, rel);
  mkdirSync(join(dest, ".."), { recursive: true });
  if (onDiskContent !== null) writeFileSync(dest, onDiskContent, "utf-8");
  return { src, dest, rel };
}

try {
  console.log("\n=== lock: records artifacts that match the template ===");
  {
    const { root, templateDir } = makeRoot();
    const shipped = [ship(root, templateDir, "hook.mjs", "body\n", "body\n")];
    writeArtifactLock(root, shipped);

    const lock = readArtifactLock(root);
    assert("lock round-trips", lock !== null);
    assert("version is current", lock?.version === ARTIFACT_LOCK_VERSION);
    assert("hash is of the matching content", lock?.artifacts["hook.mjs"] === sha256("body\n"));
  }

  console.log("\n=== lock: refuses to adopt a locally-edited file as its own ===");
  {
    const { root, templateDir } = makeRoot();
    // First install: template and disk agree.
    const first = [ship(root, templateDir, "hook.mjs", "v1\n", "v1\n")];
    writeArtifactLock(root, first);
    const original = readArtifactLock(root)!.artifacts["hook.mjs"];

    // User edits the file; a later dkk ships v2.
    writeFileSync(join(root, "hook.mjs"), "v1 + my patch\n", "utf-8");
    const second = [ship(root, templateDir, "hook.mjs", "v2\n", null)];
    writeArtifactLock(root, second);

    const after = readArtifactLock(root)!.artifacts["hook.mjs"];
    assert("edited file keeps the hash dkk wrote", after === original, after);
    assert("edited file is NOT recorded as the user's version", after !== sha256("v1 + my patch\n"));
    assert("edited file is NOT recorded as the new template", after !== sha256("v2\n"));
  }

  console.log("\n=== lock: reverting an edit restores clean-overwrite status ===");
  {
    const { root, templateDir } = makeRoot();
    writeArtifactLock(root, [ship(root, templateDir, "hook.mjs", "v1\n", "v1\n")]);

    // Edit, then revert.
    writeFileSync(join(root, "hook.mjs"), "edited\n", "utf-8");
    writeArtifactLock(root, [ship(root, templateDir, "hook.mjs", "v1\n", null)]);
    writeFileSync(join(root, "hook.mjs"), "v1\n", "utf-8");
    writeArtifactLock(root, [ship(root, templateDir, "hook.mjs", "v1\n", null)]);

    assert(
      "reverted file matches the recorded hash again",
      readArtifactLock(root)!.artifacts["hook.mjs"] === sha256("v1\n"),
    );
  }

  console.log("\n=== lock: drops entries whose file is gone ===");
  {
    const { root, templateDir } = makeRoot();
    writeArtifactLock(root, [
      ship(root, templateDir, "keep.md", "a\n", "a\n"),
      ship(root, templateDir, "retire.md", "b\n", "b\n"),
    ]);
    assert("both recorded initially", Object.keys(readArtifactLock(root)!.artifacts).length === 2);

    rmSync(join(root, "retire.md"), { force: true });
    writeArtifactLock(root, [ship(root, templateDir, "keep.md", "a\n", null)]);

    const lock = readArtifactLock(root)!;
    assert("surviving entry kept", lock.artifacts["keep.md"] === sha256("a\n"));
    assert("entry for a deleted file dropped", !("retire.md" in lock.artifacts));
  }

  console.log("\n=== lock: unreadable or future-versioned locks read as absent ===");
  {
    const { root } = makeRoot();
    assert("missing file → null", readArtifactLock(root) === null);

    writeFileSync(artifactLockPath(root), "{ not json", "utf-8");
    assert("malformed JSON → null", readArtifactLock(root) === null);

    // A lock this build cannot interpret must degrade to "no provenance"
    // rather than being trusted with the wrong schema.
    writeFileSync(
      artifactLockPath(root),
      JSON.stringify({ version: 999, dkk: "9.9.9", artifacts: { "a.md": "deadbeef" } }),
      "utf-8",
    );
    assert("unknown version → null", readArtifactLock(root) === null);
  }

  console.log("\n=== lock: entries are sorted for a reviewable committed diff ===");
  {
    const { root, templateDir } = makeRoot();
    writeArtifactLock(root, [
      ship(root, templateDir, "z.md", "z\n", "z\n"),
      ship(root, templateDir, "a.md", "a\n", "a\n"),
      ship(root, templateDir, "m.md", "m\n", "m\n"),
    ]);
    const keys = Object.keys(readArtifactLock(root)!.artifacts);
    assert("keys are sorted", keys.join() === "a.md,m.md,z.md", keys.join());
  }
} finally {
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
