import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ROOT = new globalThis.URL("../../", import.meta.url);
const SCRIPT = readFileSync(new globalThis.URL("scripts/cloudflare-staging-preflight.sh", ROOT), "utf8");
const STAGES_MARKER = "# STAGES — author this section. One stage() per step the human takes.";

describe("Cloudflare staging preflight wizard", () => {
  it("keeps the executable stages read-only despite generic template helpers", () => {
    const stageStart = SCRIPT.lastIndexOf(STAGES_MARKER);
    expect(stageStart).toBeGreaterThanOrEqual(0);

    const stages = SCRIPT.slice(stageStart);
    expect(stages).not.toContain("ENV_FILE");
    for (const forbiddenCommand of ["write_env", "set_secret", "set_var", "wrangler", "curl", "wget", "gh"]) {
      expect(stages).not.toMatch(new RegExp(`^\\s*${forbiddenCommand}\\b`, "m"));
    }
    expect(stages).toContain('EVIDENCE_DIR="$REPO_ROOT/.local-evidence"');
    expect(stages).toContain("finish_preflight");
    expect(stages).not.toContain("finish\n");
  });

  it("does not let its local evidence escape version control protection", () => {
    const ignoreRules = readFileSync(new globalThis.URL(".gitignore", ROOT), "utf8");

    expect(ignoreRules).toContain(".local-evidence/");
  });
});
