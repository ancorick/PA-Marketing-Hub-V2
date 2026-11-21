import { LIBRARY_CONTRACT_VERSION, type LibraryClient, type LibraryResource } from './contract.js';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Synthetic resources, dated relative to today so collectors always find something. */
export class MockLibraryClient implements LibraryClient {
  readonly contractVersion = LIBRARY_CONTRACT_VERSION;

  async listResourcesAddedSince(since: Date): Promise<LibraryResource[]> {
    const resources: LibraryResource[] = [
      { id: 'lib-001', title: 'Git branching, explained with pictures', titles: { hy: 'Git branch-երը՝ նկարներով', ru: 'Ветки Git в картинках' }, url: 'https://library.example.test/git-branching', tags: ['git'], public: true, addedAt: daysAgo(3) },
      { id: 'lib-002', title: 'Interview prep: 30 JavaScript questions', titles: { hy: 'Հարցազրույցի նախապատրաստում՝ 30 JavaScript հարց' }, url: 'https://library.example.test/js-interview', tags: ['javascript', 'career'], public: true, addedAt: daysAgo(9) },
      { id: 'lib-003', title: 'Internal: grading rubric', url: 'https://library.example.test/rubric', tags: ['staff'], public: false, addedAt: daysAgo(5) },
      { id: 'lib-004', title: 'Python data cleaning notebook', url: 'http://files.example.test/notebook', tags: ['python'], public: true, addedAt: daysAgo(12) },
    ];
    return resources.filter((resource) => new Date(resource.addedAt) >= since);
  }
}
