import { INITIAL_THESIS_SEEDS } from "../domain/initial-thesis-seeds";
import type {
  AdminDailyExemptionTargetModel,
  AdminDailyReviewObligationModel,
  AdminDailyTargetModel,
  AdminDraftPageModel,
  AdminRole,
  AdminRunsPageModel,
  CategoryPageModel,
  ChangesPageModel,
  DataHealthPageModel,
  DailyBriefPageModel,
  IndicatorSeriesModel,
  MethodologyPageModel,
  OverviewPageModel,
  PublicMarketCategory,
  PublicThesisCategory,
  ThesisCardModel,
  ThesisPageModel,
} from "../domain/page-models";
import type { ThesisPublicationAction, ThesisPublicationCommand, ThesisPublicationTransition } from "../domain/thesis-publication";
import type { DailyBriefFreezeCommand, DailyBriefResult } from "../domain/daily-brief";
import { createSourceAdapterRegistry } from "./adapters/sources/registry";
import { D1DailyScheduleRepository } from "./adapters/storage/cloudflare-daily-schedule";
import { D1DailyBriefRepository } from "./adapters/storage/cloudflare-daily-briefs";
import { D1DailyPublicationTargetRepository } from "./adapters/storage/cloudflare-daily-publication";
import { D1IngestionRepository, R2RawSnapshotStore } from "./adapters/storage/cloudflare-ingestion";
import { D1ManualSourceRunRepository } from "./adapters/storage/cloudflare-manual-source-runs";
import { D1AdminReadModelRepository } from "./adapters/storage/cloudflare-admin-read-models";
import {
  D1AtomFeedRepository,
  D1PublicDailyBriefRepository,
  D1PublicReadModelRepository,
} from "./adapters/storage/cloudflare-read-models";
import { D1ThesisChangeReviewRepository } from "./adapters/storage/cloudflare-thesis-change-reviews";
import { D1ThesisDraftRepository } from "./adapters/storage/cloudflare-thesis-drafts";
import { D1ThesisPublicationRepository } from "./adapters/storage/cloudflare-thesis-publications";
import { runSourceIngestion } from "./ingestion/run-source";
import { codeOwnedSourceTarget } from "./ingestion/live-smoke-targets";
import {
  AccessJwtConfiguration,
  AccessJwtError,
  accessJwtConfigurationFromEnvironment,
  type AccessActor,
} from "./modules/access-auth";
import { AtomFeedModule } from "./modules/atom-feed";
import { DailyBriefModule } from "./modules/daily-briefs";
import { DailyPublicationTargetModule, type DailyPublicationTargetResolution } from "./modules/daily-publication";
import { ManualSourceRunModule, type ManualSourceRunInput, type ManualSourceRunResult } from "./modules/manual-source-runs";
import { AdminReadModelModule, type AdminRunsCursor } from "./modules/admin-read-models";
import { PublicDailyBriefModule } from "./modules/public-daily-briefs";
import {
  PublicReadModelModule,
  type ChangesCursor,
  type PublicChangesQuery,
  type PublicIndicatorSeriesQuery,
} from "./modules/read-models";
import { ThesisChangeReviewModule, type ThesisChangeReviewCommand, type ThesisChangeReviewRecord } from "./modules/thesis-change-reviews";
import { ThesisDraftModule, type AdministrativeDraftEditCommand, type AdministrativeDraftEditResult } from "./modules/thesis-drafts";
import { ThesisEvaluationModule, type ThesisEvaluationCommand, type ThesisEvaluationResult } from "./modules/thesis-evaluation";
import { ThesisPublicationModule } from "./modules/thesis-publications";
import type { Env } from "./index";

/**
 * Request-handler dependency surface. Every entry may be overridden by tests; the production
 * defaults live beside the routes that call them and compose modules from AppContext.
 */
export type OverviewFromBindings = (generatedAt: string, env: Env) => Promise<OverviewPageModel>;
export type IndicatorSeriesFromBindings = (query: PublicIndicatorSeriesQuery, env: Env) => Promise<IndicatorSeriesModel | null>;
export type ThesesFromBindings = (
  category: PublicThesisCategory | null,
  generatedAt: string,
  env: Env,
) => Promise<readonly ThesisCardModel[]>;
export type ThesisFromBindings = (slug: string, generatedAt: string, env: Env) => Promise<ThesisPageModel | null>;
export type CategoryFromBindings = (
  category: PublicMarketCategory,
  generatedAt: string,
  env: Env,
) => Promise<CategoryPageModel | null>;
export type ChangesFromBindings = (
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
  generatedAt: string,
  env: Env,
) => Promise<ChangesPageModel>;
export type DataHealthFromBindings = (generatedAt: string, env: Env) => Promise<DataHealthPageModel>;
export type MethodologyFromBindings = (generatedAt: string, env: Env) => Promise<MethodologyPageModel>;
export type DailyBriefFromBindings = (briefDate: string, env: Env) => Promise<DailyBriefPageModel | null>;
export type AtomFeedFromBindings = (generatedAt: string, origin: string, env: Env) => Promise<string>;
export type AdminRunsFromBindings = (
  actor: AdminRunsPageModel["actor"],
  cursor: AdminRunsCursor | null,
  env: Env,
) => Promise<AdminRunsPageModel>;
export type AdminDraftFromBindings = (
  actor: AdminDraftPageModel["actor"],
  thesisId: string,
  env: Env,
) => Promise<AdminDraftPageModel | null>;
export type AuthorizeAdminFromBindings = (request: Request, minimumRole: AdminRole, env: Env) => Promise<AccessActor>;
export type ManualSourceRunFromBindings = (input: ManualSourceRunInput, env: Env) => Promise<ManualSourceRunResult>;
export type AdministrativeDraftEditFromBindings = (
  input: AdministrativeDraftEditCommand,
  env: Env,
) => Promise<AdministrativeDraftEditResult>;
export type ThesisPublicationFromBindings = (
  action: ThesisPublicationAction,
  input: ThesisPublicationCommand,
  env: Env,
) => Promise<ThesisPublicationTransition>;
export type ThesisChangeReviewFromBindings = (
  input: ThesisChangeReviewCommand,
  env: Env,
) => Promise<ThesisChangeReviewRecord>;
export type ThesisEvaluationFromBindings = (
  input: ThesisEvaluationCommand,
  env: Env,
) => Promise<ThesisEvaluationResult>;
export type DailyPublicationTargetsFromBindings = (
  cutoff: string,
  env: Env,
) => Promise<DailyPublicationTargetResolution>;
export type DailyBriefFreezeFromBindings = (
  command: DailyBriefFreezeCommand,
  env: Env,
) => Promise<DailyBriefResult>;
export interface AdminDailyBriefRead {
  readonly briefDate: string;
  readonly cutoff: string;
  readonly published: boolean;
  readonly publishedAt: string | null;
  readonly currentFreezeKey: string | null;
  readonly targets: readonly AdminDailyTargetModel[];
  readonly blockers: readonly string[];
  readonly exemptibleTargets: readonly AdminDailyExemptionTargetModel[];
  readonly pendingReviews: readonly AdminDailyReviewObligationModel[];
}
export type AdminDailyBriefReadFromBindings = (
  briefDate: string,
  env: Env,
) => Promise<AdminDailyBriefRead>;

/**
 * Structural subset of the Cloudflare Cache API (`caches.default`) used by the public GET edge
 * cache. Production resolves to the runtime's `caches.default`; tests substitute a fake through
 * `RequestHandlerDependencies.edgeCache`.
 */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface RequestHandlerDependencies {
  /** Edge cache backing the public GET cache seam; defaults to `caches.default` when available. */
  edgeCache?: EdgeCache;
  overview?: OverviewFromBindings;
  indicatorSeries?: IndicatorSeriesFromBindings;
  theses?: ThesesFromBindings;
  thesis?: ThesisFromBindings;
  category?: CategoryFromBindings;
  changes?: ChangesFromBindings;
  dataHealth?: DataHealthFromBindings;
  methodology?: MethodologyFromBindings;
  dailyBrief?: DailyBriefFromBindings;
  atomFeed?: AtomFeedFromBindings;
  adminRuns?: AdminRunsFromBindings;
  adminDraft?: AdminDraftFromBindings;
  authorizeAdmin?: AuthorizeAdminFromBindings;
  manualSourceRun?: ManualSourceRunFromBindings;
  administrativeDraftEdit?: AdministrativeDraftEditFromBindings;
  thesisPublication?: ThesisPublicationFromBindings;
  thesisChangeReview?: ThesisChangeReviewFromBindings;
  thesisEvaluation?: ThesisEvaluationFromBindings;
  dailyPublicationTargets?: DailyPublicationTargetsFromBindings;
  dailyBriefFreeze?: DailyBriefFreezeFromBindings;
  adminDailyBrief?: AdminDailyBriefReadFromBindings;
  now?: () => Date;
  createId?: () => string;
}

/** Lazily compute once; every accessor shares one instance for the lifetime of this context. */
function memo<T>(compute: () => T): () => T {
  let value: T | undefined;
  let resolved = false;
  return () => {
    if (!resolved) {
      value = compute();
      resolved = true;
    }
    return value as T;
  };
}

/**
 * Per-isolate application context: lazily constructs the storage adapters and read-side modules
 * once per env instead of once per request (previously every public GET re-built
 * `new PublicReadModelModule(new D1…)`), and parses the Access role-map configuration once
 * instead of on every admin authorization. The JWKS cache stays module-level in access-auth;
 * this context only memoizes configuration parsing.
 *
 * Instances are cached in a module-level WeakMap keyed by the env object, so repeated
 * `AppContext.from(env)` calls within an isolate reuse the same repositories.
 */
export class AppContext {
  readonly env: Env;

  private accessConfigurationMemo: AccessJwtConfiguration | AccessJwtError | null = null;

  private constructor(env: Env) {
    this.env = env;
  }

  private static readonly instances = new WeakMap<Env, AppContext>();

  static from(env: Env): AppContext {
    const existing = AppContext.instances.get(env);
    if (existing !== undefined) return existing;
    const created = new AppContext(env);
    AppContext.instances.set(env, created);
    return created;
  }

  readonly publicReadModel = memo(() => new PublicReadModelModule(new D1PublicReadModelRepository(this.env.DB)));
  readonly publicDailyBriefs = memo(() => new PublicDailyBriefModule(new D1PublicDailyBriefRepository(this.env.DB)));
  readonly atomFeed = memo(() => new AtomFeedModule(new D1AtomFeedRepository(this.env.DB)));
  readonly adminReadModel = memo(() => new AdminReadModelModule(new D1AdminReadModelRepository(this.env.DB)));
  readonly dailyBriefRepository = memo(() => new D1DailyBriefRepository(this.env.DB));
  readonly dailyBriefs = memo(() => new DailyBriefModule(this.dailyBriefRepository()));
  readonly thesisDrafts = memo(() => new ThesisDraftModule(new D1ThesisDraftRepository(this.env.DB)));
  readonly thesisPublications = memo(() => new ThesisPublicationModule(
    new D1ThesisPublicationRepository(this.env.DB),
    (thesisId) => INITIAL_THESIS_SEEDS.find((seed) => seed.id === thesisId) ?? null,
  ));
  readonly thesisChangeReviews = memo(() => new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(this.env.DB)));
  readonly dailyScheduleRepository = memo(() => new D1DailyScheduleRepository(this.env.DB));
  readonly thesisEvaluations = memo(() => new ThesisEvaluationModule(
    this.dailyScheduleRepository(),
    {
      create: (candidate) => this.thesisDrafts().create(candidate),
    },
  ));
  readonly dailyPublicationTargets = memo(() => new DailyPublicationTargetModule(new D1DailyPublicationTargetRepository(this.env.DB)));
  readonly ingestionRepository = memo(() => new D1IngestionRepository(this.env.DB));
  readonly snapshotStore = memo(() => new R2RawSnapshotStore(this.env.RAW));
  readonly adapterRegistry = memo(() => createSourceAdapterRegistry({
    usdaFasApiKey: this.env.USDA_FAS_API_KEY,
    eiaApiKey: this.env.EIA_API_KEY,
    censusApiKey: this.env.CENSUS_API_KEY,
    unctadClientId: this.env.UNCTAD_CLIENT_ID,
    unctadApiKey: this.env.UNCTAD_API_KEY,
  }));
  readonly manualSourceRuns = memo(() => new ManualSourceRunModule(
    new D1ManualSourceRunRepository(this.env.DB),
    codeOwnedSourceTarget,
    this.adapterRegistry(),
    (request, adapter) => runSourceIngestion(request, {
      adapter,
      repository: this.ingestionRepository(),
      snapshots: this.snapshotStore(),
      // `fetch` 必须绑定 globalThis：未绑定调用在 workerd 里会抛 Illegal invocation，
      // 被采集管线归类成 NETWORK「来源网络请求失败」（http_status 始终为 null）。
      fetch: globalThis.fetch.bind(globalThis),
    }),
  ));

  /**
   * Deployment configuration for Cloudflare Access, parsed once. A malformed configuration throws
   * the same fail-closed AccessJwtError on every use; the error itself is memoized so the parse
   * cost and the failure shape stay identical across requests.
   */
  accessConfiguration(): AccessJwtConfiguration {
    if (this.accessConfigurationMemo === null) {
      try {
        this.accessConfigurationMemo = accessJwtConfigurationFromEnvironment(this.env);
      } catch (error) {
        this.accessConfigurationMemo = error instanceof AccessJwtError
          ? error
          : new AccessJwtError("AUTH_CONFIGURATION");
      }
    }
    if (this.accessConfigurationMemo instanceof AccessJwtError) throw this.accessConfigurationMemo;
    return this.accessConfigurationMemo;
  }
}
