import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertInitialClientJavaScriptBudget,
  initialClientJavaScriptBudget,
} from "./initial-client-js-budget.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("initial client JavaScript bundle budget", () => {
  it("counts only the eager Vite entry, not a lazy chart chunk", async () => {
    const clientDirectory = await clientBuild({
      files: {
        "assets/index.js": 250 * 1024,
        "assets/indicator-chart.js": 900 * 1024,
      },
      manifest: {
        "index.html": { file: "assets/index.js", isEntry: true },
        "src/web/indicator-chart.ts": { file: "assets/indicator-chart.js", isDynamicEntry: true },
      },
    });

    await expect(initialClientJavaScriptBudget({ clientDirectory })).resolves.toEqual({
      bytes: 250 * 1024,
      entryFiles: ["assets/index.js"],
      limitBytes: 250 * 1024,
    });
  });

  it("fails clearly when the eager entry exceeds the budget", async () => {
    const clientDirectory = await clientBuild({ files: { "assets/index.js": 250 * 1024 + 1 } });

    await expect(assertInitialClientJavaScriptBudget({ clientDirectory })).rejects.toThrow("超过 250.00 KiB 预算");
  });

  it("fails before measuring when the Vite manifest is missing or inconsistent with index.html", async () => {
    const missingManifestDirectory = await clientBuild({ manifest: null });
    await expect(initialClientJavaScriptBudget({ clientDirectory: missingManifestDirectory })).rejects.toThrow(
      "未找到 Vite 客户端 manifest",
    );

    const mismatchedDirectory = await clientBuild({
      manifest: { "index.html": { file: "assets/other.js", isEntry: true } },
    });
    await expect(initialClientJavaScriptBudget({ clientDirectory: mismatchedDirectory })).rejects.toThrow(
      "isEntry 文件与 index.html 的 module script 不一致",
    );
  });
});

async function clientBuild({
  files = { "assets/index.js": 1 },
  manifest = { "index.html": { file: "assets/index.js", isEntry: true } },
} = {}) {
  const clientDirectory = await mkdtemp(join(tmpdir(), "enso-client-build-"));
  temporaryDirectories.push(clientDirectory);
  await Promise.all(Object.entries(files).map(async ([file, size]) => {
    const path = join(clientDirectory, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array(size));
  }));
  await writeFile(
    join(clientDirectory, "index.html"),
    '<script type="module" crossorigin src="/assets/index.js"></script>',
  );
  if (manifest !== null) {
    await writeFile(join(clientDirectory, "client-manifest.json"), JSON.stringify(manifest));
  }

  return clientDirectory;
}
