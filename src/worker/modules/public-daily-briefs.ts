import type { DailyBriefPageModel } from "../../domain/page-models";

export class PublicDailyBriefError extends Error {
  constructor() {
    super("每日判定日期无效");
    this.name = "PublicDailyBriefError";
  }
}

export interface PublicDailyBriefRepository {
  findPublished(briefDate: string): Promise<DailyBriefPageModel | null>;
}

/** Public boundary for a frozen daily record; repository rows never reach routes. */
export class PublicDailyBriefModule {
  constructor(private readonly repository: PublicDailyBriefRepository) {}

  async findPublished(briefDate: string): Promise<DailyBriefPageModel | null> {
    if (!isPublicDailyBriefDate(briefDate)) throw new PublicDailyBriefError();
    return this.repository.findPublished(briefDate);
  }
}

export function isPublicDailyBriefDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
