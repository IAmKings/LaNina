import { readFileSync } from "node:fs";

/**
 * Shared axe-core baseline support for the public-page scans in
 * published-read-model.synthetic.spec.ts.
 *
 * Baseline strategy: e2e/axe-baseline.md records every pre-existing violation (rule id, page,
 * node count, explanation). The scans assert "no new violations beyond the baseline" at the
 * (page, rule id) dimension; a rule's node count growing past the recorded baseline also counts
 * as a new violation, and a baseline entry that no longer occurs fails as a stale entry so the
 * file stays an honest snapshot. Critical/serious entries are evaluated in the markdown, never
 * silently waived: they stay in the baseline until actually fixed in production code.
 */

/** Minimal structural view of an axe violation (axe-core `Result` is assignable to this). */
export interface AxeViolationLike {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly unknown[];
}

export interface AxeBaselineEntry {
  readonly nodes: number;
  readonly note: string;
}

export interface AxeBaseline {
  readonly capturedAt: string;
  readonly pages: Readonly<Record<string, Readonly<Record<string, AxeBaselineEntry>>>>;
}

const BASELINE_START = "<!-- axe-baseline:json:start -->";
const BASELINE_END = "<!-- axe-baseline:json:end -->";

/** axe scan opt-in capture: `AXE_CAPTURE_BASELINE=1 npx playwright test --grep axe` prints the block to paste into e2e/axe-baseline.md. */
export function isAxeCaptureMode(): boolean {
  return process.env.AXE_CAPTURE_BASELINE === "1";
}

export function loadAxeBaseline(): AxeBaseline {
  const markdown = readFileSync(new URL("./axe-baseline.md", import.meta.url), "utf8");
  const start = markdown.indexOf(BASELINE_START);
  const end = markdown.indexOf(BASELINE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `e2e/axe-baseline.md 缺少机器可读基线块（${BASELINE_START} … ${BASELINE_END}）。`,
    );
  }

  const fenced = markdown.slice(start + BASELINE_START.length, end).trim();
  const json = fenced.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  const parsed: unknown = JSON.parse(json);
  if (!isAxeBaseline(parsed)) {
    throw new Error("e2e/axe-baseline.md 的机器可读基线结构无效（期待 { capturedAt, pages }）");
  }
  return parsed;
}

/**
 * Fails the test when the scan diverges from the baseline: a rule id not recorded for this page,
 * more nodes than recorded, or a baseline entry that no longer occurs (stale). Improvements that
 * keep a nonzero node count stay green but should be folded into the baseline by the next update.
 */
export function assertNoNewAxeViolations(
  pagePath: string,
  violations: readonly AxeViolationLike[],
  baseline: AxeBaseline,
): void {
  const pageBaseline = baseline.pages[pagePath] ?? {};
  const problems: string[] = [];
  const seenRuleIds = new Set<string>();

  for (const violation of violations) {
    seenRuleIds.add(violation.id);
    const entry: AxeBaselineEntry | undefined = pageBaseline[violation.id];
    const nodeCount = violation.nodes.length;
    if (entry === undefined) {
      problems.push(
        `新违规 ${violation.id}（${impactLabel(violation.impact)}，${nodeCount} 个节点）：${violation.help}。`
          + ` 修复它，或经评估后在 e2e/axe-baseline.md 的 ${pagePath} 页面下登记。`,
      );
    } else if (nodeCount > entry.nodes) {
      problems.push(
        `违规扩大 ${violation.id}：基线记录 ${entry.nodes} 个节点，实际 ${nodeCount} 个`
          + `（新增 ${nodeCount - entry.nodes} 个未评估节点）。修复或更新基线。`,
      );
    }
  }

  for (const [ruleId, entry] of Object.entries(pageBaseline)) {
    if (!seenRuleIds.has(ruleId)) {
      problems.push(
        `基线过期：${pagePath} 的 ${ruleId}（${entry.note}）本次扫描 0 个节点，请从基线移除该条目。`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`页面 ${pagePath} 的 axe 扫描与基线不一致：\n- ${problems.join("\n- ")}`);
  }
}

const capturedViolations = new Map<string, AxeViolationLike[]>();

export function recordAxeViolationsForCapture(
  pagePath: string,
  violations: readonly AxeViolationLike[],
): void {
  capturedViolations.set(
    pagePath,
    violations.map((violation) => ({ ...violation, nodes: [...violation.nodes] })),
  );
}

/** Prints the paste-ready machine block for e2e/axe-baseline.md after a capture-mode run. */
export function printCapturedAxeBaseline(): void {
  const pages: Record<string, Record<string, { nodes: number; note: string }>> = {};
  for (const [pagePath, violations] of capturedViolations) {
    pages[pagePath] = {};
    for (const violation of violations) {
      pages[pagePath][violation.id] = {
        nodes: violation.nodes.length,
        note: `${impactLabel(violation.impact)}：${violation.help}`,
      };
    }
  }
  const block = `${BASELINE_START}\n\`\`\`json\n${JSON.stringify(
    { capturedAt: new Date().toISOString().slice(0, 10), pages },
    null,
    2,
  )}\n\`\`\`\n${BASELINE_END}`;
  console.info(`\n===== axe 基线捕获结果（粘贴进 e2e/axe-baseline.md 并补写说明）=====\n${block}\n`);
}

function isAxeBaseline(value: unknown): value is AxeBaseline {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AxeBaseline>;
  if (typeof candidate.capturedAt !== "string" || candidate.pages === undefined) return false;
  return Object.values(candidate.pages).every((rules) =>
    rules === undefined
      ? false
      : Object.values(rules).every((entry) =>
          typeof entry === "object"
          && entry !== null
          && typeof (entry as AxeBaselineEntry).nodes === "number"
          && typeof (entry as AxeBaselineEntry).note === "string"),
  );
}

function impactLabel(impact: string | null): string {
  switch (impact) {
    case "critical": return "严重（critical）";
    case "serious": return "较重（serious）";
    case "moderate": return "中等（moderate）";
    case "minor": return "轻微（minor）";
    default: return "影响未知（需人工复核）";
  }
}
