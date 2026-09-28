import {
  assertBudgetWithinLimit,
  formatBudgetReport,
  initialClientJavaScriptBudget,
} from "../src/build/initial-client-js-budget.mjs";

try {
  const budget = await initialClientJavaScriptBudget();
  console.log(formatBudgetReport(budget));
  assertBudgetWithinLimit(budget);
} catch (error) {
  const message = error instanceof Error ? error.message : "未知错误";
  console.error(`[bundle-budget] 检查失败：${message}`);
  process.exitCode = 1;
}
