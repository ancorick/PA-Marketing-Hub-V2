/**
 * Group Launchpad (Project 3) contract (PRD 8.2, 11.1): the marketing notification about new groups,
 * read for the newsletter "New groups starting" block.
 */
export const GROUP_LAUNCHPAD_CONTRACT_VERSION = 'v1';

export type LaunchGroup = {
  id: string;
  courseId: string;
  courseTitle: string;
  courseTitles?: Partial<Record<'hy' | 'en' | 'ru', string>>;
  startDate: string; // YYYY-MM-DD
  openForApplications: boolean;
  applyUrl: string;
  seats: number | null;
  announcedAt: string; // ISO 8601
};

export interface GroupLaunchpadClient {
  readonly contractVersion: typeof GROUP_LAUNCHPAD_CONTRACT_VERSION;
  listGroupsAnnouncedSince(since: Date): Promise<LaunchGroup[]>;
}
