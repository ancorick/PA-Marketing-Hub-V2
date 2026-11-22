import { eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import type { ItemType } from './collectors.js';
import { DEFAULT_RANKING, type RankingSettings } from './draft.js';

const KEY = 'newsletter_ranking';

export const ITEM_TYPES: ItemType[] = ['upcoming_event', 'recent_event', 'library', 'graduation', 'hire', 'new_group'];

export class RankingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingError';
  }
}

/**
 * Newsletter ranking (8.1 step 2, RESTRUCTURE R5): the weight of each item type and the half-life of older
 * items. Saved in app_settings; without a saved value the defaults of the draft builder apply, so existing
 * behaviour does not change.
 */
export class NewsletterRanking {
  constructor(private readonly db: AppPgDatabase) {}

  async get(): Promise<RankingSettings> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const saved = row?.value as Partial<RankingSettings> | undefined;
    return {
      weights: { ...DEFAULT_RANKING.weights, ...(saved?.weights ?? {}) },
      halfLifeDays: typeof saved?.halfLifeDays === 'number' ? saved.halfLifeDays : DEFAULT_RANKING.halfLifeDays,
    };
  }

  async save(input: RankingSettings, actor: string): Promise<RankingSettings> {
    for (const type of ITEM_TYPES) {
      const weight = input.weights[type];
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new RankingError(`The weight of ${type} must be between 0 and 1`);
    }
    if (!Number.isFinite(input.halfLifeDays) || input.halfLifeDays < 1 || input.halfLifeDays > 120) throw new RankingError('Half-life must be 1 to 120 days');
    const value = { weights: input.weights, halfLifeDays: input.halfLifeDays } as unknown as Record<string, unknown>;
    await this.db
      .insert(appSettings)
      .values({ key: KEY, value, updatedBy: actor })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor, updatedAt: new Date() } });
    return this.get();
  }
}
