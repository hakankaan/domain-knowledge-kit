/**
 * `dkk adr audit` — report decision rot.
 *
 * Complements `dkk validate`: validation asks whether the model is
 * internally consistent, this asks whether the decision log is still
 * worth trusting.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import {
  auditAdrs,
  DEFAULT_STALE_PROPOSAL_DAYS,
  type AdrAuditReport,
  type AdrFinding,
} from "../audit.js";

/** Print one titled group of findings, or nothing when it is empty. */
function printGroup(title: string, findings: AdrFinding[]): void {
  if (findings.length === 0) return;
  console.log(`\n${title} (${findings.length})`);
  for (const f of findings) {
    console.log(`  ${f.id}  [${f.status}]  ${f.title}`);
    console.log(`      ${f.detail}`);
  }
}

function printReport(report: AdrAuditReport, staleDays: number): void {
  console.log(`\n📋 ADR Audit — ${report.total} decision(s)`);
  const statuses = Object.entries(report.byStatus).sort();
  if (statuses.length) {
    console.log(`  ${statuses.map(([s, n]) => `${s}: ${n}`).join("   ")}`);
  }

  if (report.clean) {
    console.log("\n✓ No decision rot found.\n");
    return;
  }

  printGroup("Unlinked decisions", report.unlinked);
  printGroup(`Stalled proposals (> ${staleDays} days)`, report.stalledProposals);
  printGroup("Overdue review", report.overdueReview);
  printGroup("Broken supersession chains", report.brokenChains);

  if (report.linkGaps.length > 0) {
    console.log(`\nOne-way links (${report.linkGaps.length})`);
    for (const gap of report.linkGaps) {
      const detail =
        gap.direction === "adr-only"
          ? `${gap.adr} lists ${gap.target}, but ${gap.target} has no adr_refs entry for it`
          : `${gap.target} lists ${gap.adr}, but ${gap.adr} has no domain_refs entry for it`;
      console.log(`  ${detail}`);
    }
    console.log(`\n  Fix all of them with: dkk adr link <adr-id> <item-id>`);
  }

  console.log("");
}

export function registerAdrAudit(program: Cmd): void {
  program
    .command("audit")
    .description("Report ADR rot: unlinked decisions, stalled proposals, one-way links, broken chains")
    .option("-r, --root <path>", "Override repository root")
    .option(
      "--stale-days <n>",
      "Age in days past which a proposed ADR is reported",
      String(DEFAULT_STALE_PROPOSAL_DAYS),
    )
    .option("--strict", "Exit 1 when anything is found (for CI)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action(
      (opts: {
        root?: string;
        staleDays?: string;
        strict?: boolean;
        json?: boolean;
        minify?: boolean;
      }) => {
        const staleDays = parseInt(opts.staleDays ?? String(DEFAULT_STALE_PROPOSAL_DAYS), 10);
        if (Number.isNaN(staleDays) || staleDays < 0) {
          console.error(`Error: --stale-days must be a non-negative integer.`);
          process.exit(1);
        }

        const model = loadDomainModel({ root: opts.root });
        const report = auditAdrs(model, { staleProposalDays: staleDays });

        if (opts.json) {
          console.log(JSON.stringify(report, null, opts.minify ? 0 : 2));
        } else {
          printReport(report, staleDays);
        }

        if (opts.strict && !report.clean) process.exitCode = 1;
      },
    );
}
