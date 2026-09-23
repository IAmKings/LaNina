import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INITIAL_CLIENT_JAVASCRIPT_BUDGET_BYTES = 250 * 1024;

const DEFAULT_CLIENT_DIRECTORY = fileURLToPath(new URL("../../dist/client/", import.meta.url));

export async function assertInitialClientJavaScriptBudget(options = {}) {
  const budget = await initialClientJavaScriptBudget(options);

  if (budget.bytes > budget.limitBytes) {
    throw new Error(
      `初始客户端 JavaScript 为 ${formatKiB(budget.bytes)}，超过 ${formatKiB(budget.limitBytes)} 预算；将图表等非首屏代码改为动态导入。`,
    );
  }

  return budget;
}

export async function initialClientJavaScriptBudget({
  clientDirectory = DEFAULT_CLIENT_DIRECTORY,
  limitBytes = INITIAL_CLIENT_JAVASCRIPT_BUDGET_BYTES,
} = {}) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new Error("初始客户端 JavaScript 预算必须是非负整数。");
  }

  const manifestPath = resolve(clientDirectory, "client-manifest.json");
  const indexPath = resolve(clientDirectory, "index.html");
  const [manifestText, indexHtml] = await Promise.all([
    readBuildArtifact(manifestPath, "Vite 客户端 manifest"),
    readBuildArtifact(indexPath, "Vite 客户端 index.html"),
  ]);
  const entryFiles = clientEntryFiles(manifestText);
  const eagerFiles = eagerModuleScriptFiles(indexHtml);

  assertEagerEntriesMatchManifest(entryFiles, eagerFiles);

  const sizes = await Promise.all(entryFiles.map((entryFile) => clientFileSize(clientDirectory, entryFile)));

  return {
    bytes: sizes.reduce((total, size) => total + size, 0),
    entryFiles,
    limitBytes,
  };
}

export function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function clientEntryFiles(manifestText) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("Vite 客户端 manifest 不是有效 JSON；请重新运行 npm run build。");
  }

  if (!isRecord(manifest)) {
    throw new Error("Vite 客户端 manifest 必须是对象；请重新运行 npm run build。");
  }

  const entryFiles = Object.values(manifest)
    .filter((entry) => isRecord(entry) && entry.isEntry === true)
    .map((entry) => entry.file);

  if (entryFiles.length === 0) {
    throw new Error("Vite 客户端 manifest 未声明 isEntry 客户端 JavaScript；请重新运行 npm run build。");
  }
  if (!entryFiles.every((file) => typeof file === "string" && file.endsWith(".js"))) {
    throw new Error("Vite 客户端 manifest 的 isEntry 文件必须是 JavaScript；请检查构建配置。");
  }
  if (new Set(entryFiles).size !== entryFiles.length) {
    throw new Error("Vite 客户端 manifest 包含重复的 isEntry 文件；请重新运行 npm run build。");
  }

  return entryFiles;
}

function eagerModuleScriptFiles(indexHtml) {
  const scriptTags = indexHtml.match(/<script\b[^>]*>/gi) ?? [];
  const files = scriptTags.flatMap((tag) => {
    const type = attribute(tag, "type");
    if (type?.toLowerCase() !== "module") return [];

    const src = attribute(tag, "src");
    if (src === undefined) {
      throw new Error("Vite 客户端 index.html 包含没有 src 的 module script；无法确定初始 JavaScript。");
    }
    if (!src.startsWith("/")) {
      throw new Error("Vite 客户端 index.html 的 module script 必须使用根路径 src；请检查 Vite base 配置。");
    }

    return [src.slice(1)];
  });

  if (files.length === 0) {
    throw new Error("Vite 客户端 index.html 未引用 module script；请重新运行 npm run build。");
  }
  if (new Set(files).size !== files.length) {
    throw new Error("Vite 客户端 index.html 包含重复的 module script；请重新运行 npm run build。");
  }

  return files;
}

function assertEagerEntriesMatchManifest(entryFiles, eagerFiles) {
  if (entryFiles.length !== eagerFiles.length || entryFiles.some((file) => !eagerFiles.includes(file))) {
    throw new Error("Vite 客户端 manifest 的 isEntry 文件与 index.html 的 module script 不一致；请重新运行 npm run build。");
  }
}

async function clientFileSize(clientDirectory, entryFile) {
  const filePath = safeClientFilePath(clientDirectory, entryFile);
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`Vite 客户端入口文件不存在：${entryFile}；请重新运行 npm run build。`, { cause: error });
    }
    throw new Error(`无法读取 Vite 客户端入口文件 ${entryFile}：${errorMessage(error)}`, { cause: error });
  }

  if (!stats.isFile()) {
    throw new Error(`Vite 客户端入口路径不是文件：${entryFile}；请重新运行 npm run build。`);
  }

  return stats.size;
}

function safeClientFilePath(clientDirectory, entryFile) {
  if (isAbsolute(entryFile)) {
    throw new Error("Vite 客户端 manifest 的入口文件必须是相对路径；请重新运行 npm run build。");
  }

  const clientRoot = resolve(clientDirectory);
  const filePath = resolve(clientRoot, entryFile);
  const pathFromRoot = relative(clientRoot, filePath);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Vite 客户端 manifest 的入口文件超出客户端构建目录；请重新运行 npm run build。");
  }

  return filePath;
}

async function readBuildArtifact(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`未找到 ${label}：${path}；请先运行 npm run build。`, { cause: error });
    }
    throw new Error(`无法读取${label}：${errorMessage(error)}`, { cause: error });
  }
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "未知错误";
}
