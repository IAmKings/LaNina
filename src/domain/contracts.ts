export const THESIS_STAGES = [
  "watch",
  "weather_realized",
  "physical_pressure",
  "balance_tightening",
  "market_confirmed",
  "easing",
] as const;

export const THESIS_DIRECTIONS = ["bullish", "bearish", "neutral", "mixed"] as const;

export type ThesisStage = (typeof THESIS_STAGES)[number];
export type ThesisDirection = (typeof THESIS_DIRECTIONS)[number];
export type AppEnvironment = "local" | "staging" | "production";

export interface ApiMeta {
  generatedAt: string;
  dataCutoff: string;
  methodologyVersion: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    /**
     * Stable, non-prose diagnostic payload for operator-facing failures. It carries enum codes only
     * (for example the failed daily-brief gates and their reason codes), never raw SQL or storage
     * internals, so the browser can explain a failure without rendering a server message verbatim.
     */
    details?: unknown;
  };
}

export interface HealthStatus {
  status: "ok";
  version: string;
  environment: AppEnvironment;
}
