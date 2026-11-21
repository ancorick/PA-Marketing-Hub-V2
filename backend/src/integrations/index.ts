import type { AppConfig } from '../config/env.js';
import type { AlumniTrackerClient } from './alumni-tracker/contract.js';
import { MockAlumniTrackerClient } from './alumni-tracker/mock.js';
import type { CoreEngineClient } from './core-engine/contract.js';
import { MockCoreEngineClient } from './core-engine/mock.js';
import type { GroupLaunchpadClient } from './group-launchpad/contract.js';
import { MockGroupLaunchpadClient } from './group-launchpad/mock.js';
import type { LibraryClient } from './library/contract.js';
import { MockLibraryClient } from './library/mock.js';
import type { NavigatorCrmClient } from './navigator-crm/contract.js';
import { MockNavigatorCrmClient } from './navigator-crm/mock.js';

export type Integrations = {
  mode: AppConfig['integrationsMode'];
  coreEngine: CoreEngineClient;
  navigatorCrm: NavigatorCrmClient;
  alumniTracker: AlumniTrackerClient;
  /** Projects 9 and 3: newsletter sources (PRD 8.2). */
  library: LibraryClient;
  groupLaunchpad: GroupLaunchpadClient;
};

/**
 * Builds the clients for Projects 1, 2 and 11. Only "mock" exists today;
 * an "http" mode is added per project once its API is available (manual task 7).
 */
export function createIntegrations(
  mode: AppConfig['integrationsMode'],
  options: { allowMockSignIn?: boolean } = {},
): Integrations {
  switch (mode) {
    case 'mock':
      return {
        mode,
        coreEngine: new MockCoreEngineClient({ acceptStaffTokens: options.allowMockSignIn ?? true }),
        navigatorCrm: new MockNavigatorCrmClient(),
        alumniTracker: new MockAlumniTrackerClient(),
        library: new MockLibraryClient(),
        groupLaunchpad: new MockGroupLaunchpadClient(),
      };
  }
}
