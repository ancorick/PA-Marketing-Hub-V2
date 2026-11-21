import { GROUP_LAUNCHPAD_CONTRACT_VERSION, type GroupLaunchpadClient, type LaunchGroup } from './contract.js';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

export class MockGroupLaunchpadClient implements GroupLaunchpadClient {
  readonly contractVersion = GROUP_LAUNCHPAD_CONTRACT_VERSION;

  async listGroupsAnnouncedSince(since: Date): Promise<LaunchGroup[]> {
    const groups: LaunchGroup[] = [
      { id: 'grp-py-2027-01', courseId: 'course-python', courseTitle: 'Python Backend', courseTitles: { hy: 'Python Backend', ru: 'Python Backend' }, startDate: day(40).toISOString().slice(0, 10), openForApplications: true, applyUrl: 'https://academy.example.test/apply/python', seats: 24, announcedAt: day(-6).toISOString() },
      { id: 'grp-ux-2027-01', courseId: 'course-ux', courseTitle: 'UX/UI Design', startDate: day(55).toISOString().slice(0, 10), openForApplications: false, applyUrl: 'https://academy.example.test/apply/ux', seats: 18, announcedAt: day(-4).toISOString() },
    ];
    return groups.filter((group) => new Date(group.announcedAt) >= since);
  }
}
