import type { AppConfig } from '../config/env.js';
import type { AlumniTrackerClient } from './alumni-tracker/contract.js';
import { MockAlumniTrackerClient } from './alumni-tracker/mock.js';
import type { CoreEngineClient } from './core-engine/contract.js';
import { MockCoreEngineClient } from './core-engine/mock.js';
import type { NavigatorCrmClient } from './navigator-crm/contract.js';
import { MockNavigatorCrmClient } from './navigator-crm/mock.js';

export type Integrations = {
  mode: AppConfig['integrationsMode'];
  coreEngine: CoreEngineClient;
  navigatorCrm: NavigatorCrmClient;
  alumniTracker: AlumniTrackerClient;
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
      };
  }
}
