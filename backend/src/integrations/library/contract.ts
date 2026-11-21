/**
 * Academy Library (Project 9) contract, as Marketing Hub consumes it (PRD 8.2, 11.1). Read-only:
 * newly added public resources for the newsletter "New in the Library" block.
 */
export const LIBRARY_CONTRACT_VERSION = 'v1';

export type LibraryResource = {
  id: string;
  title: string;
  /** Optional translations; the newsletter uses the issue's language when present. */
  titles?: Partial<Record<'hy' | 'en' | 'ru', string>>;
  url: string;
  tags: string[];
  public: boolean;
  addedAt: string; // ISO 8601
};

export interface LibraryClient {
  readonly contractVersion: typeof LIBRARY_CONTRACT_VERSION;
  listResourcesAddedSince(since: Date): Promise<LibraryResource[]>;
}
