import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { readBodyWithinLimit, sha256Hex } from "./http";

export const UNCTAD_SOURCE_ID = "unctad_datahub_lsci";
export const UNCTAD_ADAPTER_KEY = "unctad-lsci-v1";
export const UNCTAD_SOURCE_URL =
  "https://unctadstat-user-api.unctad.org/US.LSCI_M/cur/Facts?culture=en";
export const UNCTAD_LSCI_INDICATOR_ID = "unctad_lsci_monthly";

/** UNCTAD Data Hub Facts API 契约（2026-09-22 live 冻结）：
 *  GET {userApi}/US.LSCI_M/cur/Facts?culture=en&$select=Month,Economy,M4023
 *      &$filter=Month/Code eq '<YYYYMnn>' and Economy/Code eq '140'，headers ClientId / ClientSecret。
 *  单请求窄化为一个经济体-月份（≤10KB），Monthly LSCI per economy 的 China 序列。 */
const LSCI_MEASURE = "M4023";

/** 从 scheduledAt 向前的 count 个已完成月，格式 '2026M06'（UNCTAD Month/Code）。 */
export function monthWindow(scheduledAt: string, count: number): readonly string[] {
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.valueOf())) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "scheduledAt 不是可解析 UTC 时间");
  }
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}M${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const TARGET_ECONOMY = "China";
const TARGET_ECONOMY_CODE = "140";
const MONTH_BACKTRACK = 4;
const MAX_RESPONSE_BYTES = 512_000;

interface FactRow {
  readonly Month?: { readonly Code?: string; readonly Label?: string };
  readonly Economy?: { readonly Code?: string; readonly Label?: string; readonly IsTarget?: boolean };
  readonly M4023?: { readonly Value?: number | string | null };
}

export function createUnctadLsciAdapter(
  credentials?: { clientId?: string; apiKey?: string },
): SourceAdapter {
  return {
    key: UNCTAD_ADAPTER_KEY,

    async collect(context: CollectContext): Promise<CollectResult> {
      if (context.sourceUrl !== UNCTAD_SOURCE_URL) {
        throw new SourceCollectionError("VALIDATION", "UNCTAD 来源地址不在允许列表");
      }
      if (!credentials?.clientId || !credentials?.apiKey) {
        throw new SourceCollectionError("AUTH", "缺少 UNCTAD Data Hub 凭证（fail-closed）");
      }

      const observations: ObservationInput[] = [];
      let lastRawBody: Uint8Array | null = null;
      for (const month of monthWindow(context.scheduledAt, MONTH_BACKTRACK)) {
        const fetched = await fetchFactsMonthRaw(
          context, credentials.clientId, credentials.apiKey, month,
        );
        lastRawBody = fetched.rawBody;
        if (fetched.rows.length === 0) continue; // 该月数据未发布（发布滞后约 2 个月）
        observations.push(...fetched.rows
          .filter((row) => row.Economy?.Label === TARGET_ECONOMY)
          .map((row) => toObservationInput(row, context.fetchedAt)));
        break; // 第一个已发布的月即收口
      }
      if (observations.length === 0) {
        throw new SourceCollectionError("VALIDATION", "UNCTAD 窗口内没有可落库的月度观测");
      }

      if (lastRawBody === null) {
        throw new SourceCollectionError("STORAGE", "UNCTAD 响应正文缺失，无法计算内容哈希");
      }
      // contentHash 必须是**原始正文**的 SHA-256：R2 条件写把它当作校验和比对实际字节，
      // 用派生摘要（观测拼接）会被 R2 拒绝（本地 miniflare 不校验校验和，故只在真实 R2 暴露）。
      const contentHash = await sha256Hex(lastRawBody);

      return {
        sourceId: context.sourceId,
        fetchedAt: context.fetchedAt,
        sourcePublishedAt: null,
        etag: null,
        lastModified: null,
        contentType: "application/json",
        contentHash,
        rawBody: lastRawBody,
        observations,
        warnings: ["SOURCE_PUBLISHED_AT_UNKNOWN", "UNCTAD_MONTHLY_RELEASE_LAG"],
        status: "changed",
      };
    },
  };
}

interface FactsFetch {
  readonly rows: readonly FactRow[];
  readonly rawBody: Uint8Array | null;
}

async function fetchFactsMonthRaw(
  context: CollectContext,
  clientId: string,
  apiKey: string,
  month: string,
): Promise<FactsFetch> {
  const url = new URL(context.sourceUrl);
  url.searchParams.set("$select", "Month,Economy,M4023");
  url.searchParams.set("$filter", `Month/Code eq '${month}'`);
  let response: Response;
  try {
    response = await context.fetch(url, {
      headers: new Headers({
        Accept: "*/*",
        ClientId: clientId,
        ClientSecret: apiKey,
      }),
    });
  } catch {
    throw new SourceCollectionError("NETWORK", "无法连接 UNCTAD Data Hub", { retryable: true });
  }
  if (!response.ok) {
    throw new SourceCollectionError("NETWORK", `UNCTAD 返回 ${response.status}`, {
      retryable: response.status >= 500,
      httpStatus: response.status,
    });
  }
  const rawBody = await readBodyWithinLimit(response, MAX_RESPONSE_BYTES);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as { value?: readonly FactRow[] };
    if (!Array.isArray(parsed.value)) throw new Error("facts 值不是数组");
    return { rows: parsed.value, rawBody };
  } catch (error) {
    if (error instanceof SourceCollectionError) throw error;
    throw new SourceCollectionError("SCHEMA_DRIFT", "UNCTAD Facts 结构漂移");
  }
}

function toObservationInput(
  row: FactRow,
  fetchedAt: string,
): ObservationInput {
  const month = row.Month?.Code as string;
  const value = (row[LSCI_MEASURE] as { Value?: number | null }).Value as number;
  const year = Number(month.slice(0, 4));
  const monthIx = Number(month.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, monthIx, 0));

  return {
    indicatorId: UNCTAD_LSCI_INDICATOR_ID,
    observedAt: monthEnd.toISOString(),
    periodStart: new Date(Date.UTC(year, monthIx - 1, 1)).toISOString(),
    value,
    unit: "index",
    publishedAt: null,
    fetchedAt,
    quality: "provisional",
    citationUrl: "https://unctadstat.unctad.org/datacentre/reportInfo/US.LSCI_M",
    metadata: {
      economy: TARGET_ECONOMY,
      economyCode: TARGET_ECONOMY_CODE,
      measure: LSCI_MEASURE,
      month: month,
      dataset: "Data Hub US.LSCI_M (cur Facts)",
    },
  };
}
