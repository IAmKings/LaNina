/**
 * `deploy:production` 的前置断言（在 `wrangler deploy` 之前运行）。
 *
 * 部署机制：本项目用 @cloudflare/vite-plugin 构建，`vite build` 会生成
 * `.wrangler/deploy/config.json` 重定向，使 `wrangler deploy` 使用
 * `dist/enso_monitor/wrangler.json`（烘焙产物）而非 wrangler.jsonc——
 * 因此 `-e production` 标志被忽略，环境选择必须在构建期用
 * `CLOUDFLARE_ENV=production` 完成（见 package.json 的 deploy:production）。
 *
 * 本脚本验证两层：
 * 1. 源配置 wrangler.jsonc 的 env.production 必须有真实（非全零占位）D1 database_id；
 * 2. 烘焙产物 dist/enso_monitor/wrangler.json 必须存在且已按 production 烘焙
 *   （APP_ENV=production、DB 指向 enso-monitor-prod、ID 与源配置一致）——
 *   防止「忘了设 CLOUDFLARE_ENV 就构建并部署」把 local 配置推到生产脚本。
 *
 * 只读本地文件，不访问 Cloudflare API。
 */
import { readFileSync } from "node:fs";

const CONFIG_PATH = new URL("../wrangler.jsonc", import.meta.url);
const REDIRECT_PATH = new URL("../.wrangler/deploy/config.json", import.meta.url);
const PRODUCTION_D1_NAME = "enso-monitor-prod";

/**
 * 解析 vite 插件写入的部署重定向（.wrangler/deploy/config.json → configPath），
 * 得到 `wrangler deploy` 实际会使用的烘焙产物路径。每次构建都会刷新该重定向。
 */
function resolveBakedConfigPath() {
  const redirect = JSON.parse(readFileSync(REDIRECT_PATH, "utf8"));
  if (typeof redirect?.configPath !== "string") {
    throw new Error("重定向缺少 configPath 字段");
  }
  return new URL(redirect.configPath, REDIRECT_PATH);
}

/**
 * 状态机剥离 JSONC 注释：逐字符扫描，字符串字面量（含转义）原样复制，`//` 到行尾与
 * `/* ... *\/` 块注释替换为单个空格，避免相邻 token 被意外拼接。
 */
function stripJsoncComments(source) {
  let result = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      result += char;
      index += 1;
      while (index < source.length) {
        const inner = source[index];
        result += inner;
        index += 1;
        if (inner === "\\") {
          result += source[index] ?? "";
          index += 1;
          continue;
        }
        if (inner === '"') break;
      }
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      result += " ";
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      result += " ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function fail(message) {
  console.error(`[production-config] 部署中止：${message}`);
  process.exitCode = 1;
}

function main() {
  let config;
  try {
    config = JSON.parse(stripJsoncComments(readFileSync(CONFIG_PATH, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`wrangler.jsonc 解析失败（${message}）；无法验证 production 配置，按占位处理。`);
    return;
  }

  const production = config?.env?.production;
  if (!production) {
    fail("wrangler.jsonc 缺少 env.production 配置块。");
    return;
  }

  const databaseId = (production.d1_databases ?? [])
    .find((binding) => binding?.binding === "DB")?.database_id;
  if (typeof databaseId !== "string" || databaseId.length === 0) {
    fail('env.production.d1_databases 缺少 binding 为 "DB" 的 database_id。');
    return;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
    fail(
      `env.production 的 D1 database_id "${databaseId}" 不是 UUID 格式；`
      + "请先创建 production D1 资源并把真实 database_id 写入 wrangler.jsonc。",
    );
    return;
  }

  // 占位判定：去掉连字符后 32 位十六进制里非零字符不超过 2 位即视为全零占位家族
  //（覆盖 00000000-0000-0000-0000-000000000000 与 …000000000002 这类变体；
  // 真实 UUIDv4 平均有约 30 个非零位，不会误伤）。
  const nonZeroDigits = databaseId.replaceAll("-", "").split("")
    .filter((digit) => digit !== "0").length;
  if (nonZeroDigits <= 2) {
    fail(
      `env.production 的 D1 database_id "${databaseId}" 仍是全零占位值，不允许部署 production。`
      + "请先创建 enso-monitor-prod D1 资源，把真实 database_id 替换进 wrangler.jsonc 的"
      + " env.production.d1_databases，再运行 npm run deploy:production。",
    );
    return;
  }

  const enableCron = production.vars?.ENABLE_CRON;
  const enableAutoPublication = production.vars?.ENABLE_AUTO_PUBLICATION;
  console.log(
    `[production-config] ENABLE_CRON=${enableCron}，ENABLE_AUTO_PUBLICATION=${enableAutoPublication}。`
    + " 生产配置当前不含 crons（免费版账户 cron 上限 5 条、staging 已占 4 条）：上线切"
    + " ENABLE_CRON=\"true\" 时需同时把 crons 加回 env.production（见 wrangler.jsonc 注释）；"
    + "自动发布另需 ENABLE_AUTO_PUBLICATION 精确为 \"true\"。",
  );
  console.log(
    `[production-config] 源配置 production D1 database_id 为真实值（${databaseId}）。`,
  );

  let baked;
  const bakedPath = resolveBakedConfigPath();
  try {
    baked = JSON.parse(readFileSync(bakedPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `烘焙产物读取失败（${message}）。请先用 CLOUDFLARE_ENV=production npm run build`
      + " 重新构建（deploy:production 已内置）。",
    );
    return;
  }

  if (baked?.vars?.APP_ENV !== "production") {
    fail(
      `烘焙产物的 APP_ENV 是 "${baked?.vars?.APP_ENV ?? "缺失"}" 而非 "production"——`
      + " 构建时没有设 CLOUDFLARE_ENV=production，当前产物是别的环境（很可能是 local）。"
      + " 直接部署会把错误的绑定推到生产脚本，已中止。",
    );
    return;
  }

  const bakedDatabaseId = (baked.d1_databases ?? [])
    .find((binding) => binding?.binding === "DB")?.database_id;
  if (bakedDatabaseId !== databaseId
    || baked.d1_databases?.find((binding) => binding?.binding === "DB")?.database_name
      !== PRODUCTION_D1_NAME) {
    fail(
      `烘焙产物的 D1 绑定（${bakedDatabaseId ?? "缺失"}）与源配置 production（${databaseId}）`
      + ` / ${PRODUCTION_D1_NAME} 不一致；请用 CLOUDFLARE_ENV=production npm run build 重新构建。`,
    );
    return;
  }

  console.log(
    "[production-config] 烘焙产物已按 production 烘焙（APP_ENV、"
    + `${PRODUCTION_D1_NAME} 绑定一致），可以执行 wrangler deploy。`,
  );
}

main();
