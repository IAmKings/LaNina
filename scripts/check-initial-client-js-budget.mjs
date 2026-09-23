import {
  assertInitialClientJavaScriptBudget,
  formatKiB,
} from "../src/build/initial-client-js-budget.mjs";

try {
  const budget = await assertInitialClientJavaScriptBudget();
  console.log(
    `[bundle-budget] 初始客户端 JavaScript：${formatKiB(budget.bytes)} / ${formatKiB(budget.limitBytes)} (${budget.entryFiles.join(", ")})`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "未知错误";
  console.error(`[bundle-budget] 检查失败：${message}`);
  process.exitCode = 1;
}
