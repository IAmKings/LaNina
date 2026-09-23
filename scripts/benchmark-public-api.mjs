import {
  PUBLIC_API_BENCHMARK_USAGE,
  PublicApiBenchmarkFailure,
  assertPublicApiBenchmark,
  parsePublicApiBenchmarkArguments,
} from "../src/build/public-api-benchmark.mjs";

try {
  const options = parsePublicApiBenchmarkArguments(process.argv.slice(2));
  if (options.help) {
    console.log(PUBLIC_API_BENCHMARK_USAGE);
  } else {
    const summary = await assertPublicApiBenchmark(options);
    console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  if (error instanceof PublicApiBenchmarkFailure) {
    console.log(JSON.stringify(error.summary, null, 2));
    console.error(`[public-api-benchmark] ${error.message}`);
  } else {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error(`[public-api-benchmark] 检查失败：${message}`);
  }
  process.exitCode = 1;
}
