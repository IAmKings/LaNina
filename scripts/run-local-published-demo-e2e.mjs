import { spawn } from "node:child_process";

// npm does not provide a cross-platform environment-assignment syntax. Start the existing
// Playwright CLI through Node so the config can select the isolated Vite `demo` server on every OS.
const child = spawn(
  process.execPath,
  ["./node_modules/@playwright/test/cli.js", "test", "e2e/local-published-demo.spec.ts"],
  {
    cwd: process.cwd(),
    env: { ...process.env, PLAYWRIGHT_LOCAL_DEMO: "1" },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error("无法启动本地合成演示 E2E：", error);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
