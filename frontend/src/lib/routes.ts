import {
  Bell,
  CalendarBlank,
  ChartLineUp,
  Coins,
  EnvelopeSimple,
  GearSix,
  Heart,
  LinkSimple,
  Newspaper,
  Pulse,
  SquaresFour,
  Stack,
  Tray,
  UserGear,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import type { StringKey } from './i18n';

export type NavItem = { path: string; label: StringKey; icon: Icon; devOnly?: boolean; badge?: 'alerts' };
export type NavGroup = { id: string; label: StringKey; items: NavItem[] };

/** Dev inbox is a development and demo aid only (RESTRUCTURE §3); production builds never show it. */
export const SHOW_DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';

/** Public demo build (VITE_DEMO_MODE=true): every record is synthetic, and the top bar says so. */
export const DEMO_DEPLOY = import.meta.env.VITE_DEMO_MODE === 'true';

/** Left navigation, groups and order from RESTRUCTURE §3. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'measure',
    label: 'group.measure',
    items: [
      { path: '/', label: 'nav.overview', icon: SquaresFour },
      { path: '/cohorts', label: 'nav.cohorts', icon: ChartLineUp },
      { path: '/costs', label: 'nav.costs', icon: Coins },
      { path: '/campaigns-links', label: 'nav.campaignsLinks', icon: LinkSimple },
      { path: '/data-health', label: 'nav.dataHealth', icon: Pulse },
    ],
  },
  {
    id: 'reach',
    label: 'group.reach',
    items: [
      { path: '/contacts', label: 'nav.contacts', icon: UsersThree },
      { path: '/segments', label: 'nav.segments', icon: Stack },
      { path: '/audience-health', label: 'nav.audienceHealth', icon: Heart },
      { path: '/events', label: 'nav.events', icon: CalendarBlank },
    ],
  },
  {
    id: 'send',
    label: 'group.send',
    items: [
      { path: '/newsletter', label: 'nav.newsletter', icon: Newspaper },
      { path: '/campaign-emails', label: 'nav.campaignEmails', icon: EnvelopeSimple },
      { path: '/dev-inbox', label: 'nav.devInbox', icon: Tray, devOnly: true },
    ],
  },
  {
    id: 'settings',
    label: 'group.settings',
    items: [
      { path: '/email-settings', label: 'nav.emailSettings', icon: GearSix },
      { path: '/alerts', label: 'nav.alerts', icon: Bell, badge: 'alerts' },
      { path: '/admin', label: 'nav.admin', icon: UserGear },
    ],
  },
];

/** Pages that belong to a nav item without being listed (detail pages highlight their parent). */
const PARENT: [RegExp, string][] = [
  [/^\/channels\//, '/'],
  [/^\/people\//, '/'],
  [/^\/design-system$/, '/admin'],
];

/** The nav item to highlight for a path. */
export function activeNavPath(path: string): string {
  const parent = PARENT.find(([pattern]) => pattern.test(path));
  if (parent) return parent[1];
  if (path === '/') return '/';
  const items = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.path !== '/');
  return items.find((item) => path === item.path || path.startsWith(`${item.path}/`))?.path ?? path;
}

/**
 * Addresses before the restructure → new ones (RESTRUCTURE §3), so bookmarks, alert links and links in emails
 * keep working. The Analytics page with tabs is gone: each tab is a page; Campaigns are now Campaign emails.
 */
const REDIRECTS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^\/audience\/?$/, () => '/contacts'],
  [/^\/audience\/contacts\/(.+)$/, (m) => `/contacts/${m[1]}`],
  [/^\/audience\/import$/, () => '/contacts/import'],
  [/^\/audience\/duplicates$/, () => '/contacts/duplicates'],
  [/^\/audience\/segments\/?$/, () => '/segments'],
  [/^\/audience\/segments\/(.+)$/, (m) => `/segments/${m[1]}`],
  [/^\/campaigns\/?$/, () => '/campaign-emails'],
  [/^\/campaigns\/(.+)$/, (m) => `/campaign-emails/${m[1]}`],
  [/^\/analytics\/?$/, () => '/campaigns-links'],
  [/^\/analytics\/campaigns\/?$/, () => '/campaigns-links'],
  [/^\/analytics\/campaigns\/(.+)$/, (m) => `/campaigns-links/${m[1]}`],
  [/^\/analytics\/(links|taxonomy)$/, () => '/campaigns-links'],
  [/^\/analytics\/cohorts$/, () => '/cohorts'],
  [/^\/analytics\/costs$/, () => '/costs'],
  [/^\/analytics\/health$/, () => '/data-health'],
  [/^\/analytics\/metrics$/, () => '/audience-health'],
  [/^\/analytics\/channels\/(.+)$/, (m) => `/channels/${m[1]}`],
  [/^\/analytics\/people\/(.+)$/, (m) => `/people/${m[1]}`],
];

export function redirectFor(path: string): string | null {
  for (const [pattern, to] of REDIRECTS) {
    const match = path.match(pattern);
    if (match) return to(match);
  }
  return null;
}
