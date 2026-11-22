import { ArrowUpRight, CaretDoubleLeft, CaretDoubleRight, List, SignOut, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import logoUrl from '../assets/picsart-academy-logo.webp';
import { listAlerts } from '../lib/api';
import { setStaffLang, STAFF_LANGS, useStaffLang, useT } from '../lib/i18n';
import { activeNavPath, NAV_GROUPS, SHOW_DEV_TOOLS } from '../lib/routes';
import { setMockRole, STAFF_ROLES, useStaffRole } from '../lib/session';
import { ThemeSwitcher } from './ThemeSwitcher';

const COLLAPSE_KEY = 'mh-sidebar';
const collapseListeners = new Set<() => void>();
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
};
function setCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  collapseListeners.forEach((listener) => listener());
}
/** The sidebar width is remembered between visits (RESTRUCTURE §3). */
function useCollapsed() {
  return useSyncExternalStore(
    (listener) => {
      collapseListeners.add(listener);
      return () => collapseListeners.delete(listener);
    },
    readCollapsed,
    () => false,
  );
}

/** Official Picsart Academy cube (docs/references) + product name. The image is decorative: the text names it. */
function Brand() {
  return (
    <a className="brand" href="#/">
      <img className="brand__logo" src={logoUrl} alt="" width={36} height={33} />
      <span className="brand__text">
        <span className="brand__name">Picsart Academy</span>
        <span className="brand__product">Marketing Hub</span>
      </span>
    </a>
  );
}

/** Unresolved alerts for the badge next to Alerts; refreshed every minute. */
function useOpenAlerts() {
  const role = useStaffRole();
  const alerts = useQuery({ queryKey: ['alerts', role], queryFn: listAlerts, refetchInterval: 60_000, retry: false });
  return alerts.data?.alerts.filter((alert) => !alert.resolvedAt).length ?? 0;
}

function SidebarNav({ currentPath, collapsed, onNavigate }: { currentPath: string; collapsed: boolean; onNavigate?: () => void }) {
  const t = useT();
  const active = activeNavPath(currentPath);
  const openAlerts = useOpenAlerts();
  return (
    <nav className="sidebar__nav" aria-label={t('shell.main')}>
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="sidebar__group">
          <p className="sidebar__group-label" id={`nav-group-${group.id}`}>
            {t(group.label)}
          </p>
          <ul className="sidebar__list" aria-labelledby={`nav-group-${group.id}`}>
            {group.items
              .filter((item) => !item.devOnly || SHOW_DEV_TOOLS)
              .map(({ path, label, icon: ItemIcon, badge, devOnly }) => {
                const count = badge === 'alerts' ? openAlerts : 0;
                const name = t(label);
                return (
                  <li key={path}>
                    <a
                      className="sidebar__link"
                      href={`#${path}`}
                      aria-current={active === path ? 'page' : undefined}
                      title={collapsed ? name : devOnly ? t('shell.devOnly') : undefined}
                      onClick={onNavigate}
                    >
                      <ItemIcon className="sidebar__icon" size={20} weight={active === path ? 'fill' : 'regular'} aria-hidden />
                      <span className="sidebar__label">{name}</span>
                      {count > 0 && (
                        <span className="sidebar__badge num">
                          {count}
                          <span className="visually-hidden"> {t('shell.unread')}</span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Bottom of the sidebar: who is signed in (mock role until Core Engine sign-in), language, theme, sign out. */
function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const lang = useStaffLang();
  const role = useStaffRole();
  return (
    <div className="sidebar__footer">
      <label className="sidebar__field">
        <span className="sidebar__field-label">{t('shell.role')}</span>
        <select className="select select--sm" value={role} onChange={(event) => setMockRole(event.target.value as typeof role)}>
          {STAFF_ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`role.${option.value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="sidebar__field">
        <span className="sidebar__field-label">{t('shell.language')}</span>
        <select className="select select--sm" value={lang} lang={lang} onChange={(event) => setStaffLang(event.target.value as typeof lang)}>
          {STAFF_LANGS.map((option) => (
            <option key={option.value} value={option.value} lang={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="sidebar__row">
        <ThemeSwitcher />
        <button type="button" className="sidebar__signout" disabled title={t('shell.signOutLater')} aria-label={`${t('shell.signOut')}. ${t('shell.signOutLater')}`}>
          <SignOut size={18} aria-hidden />
          {!collapsed && <span>{t('shell.signOut')}</span>}
        </button>
      </div>
    </div>
  );
}

/** Links of the top bar (RESTRUCTURE §3): the public sign-up form and the newsletter archive. */
function TopLinks() {
  const t = useT();
  const signup = import.meta.env.VITE_PUBLIC_SIGNUP_URL;
  return (
    <ul className="topbar__links">
      {signup && (
        <li>
          <a href={signup} target="_blank" rel="noopener noreferrer">
            {t('shell.signupForm')} <ArrowUpRight size={14} aria-hidden />
            <span className="visually-hidden"> ({t('shell.opensNewTab')})</span>
          </a>
        </li>
      )}
      <li>
        <a href="#/p/archive" target="_blank" rel="noopener noreferrer">
          {t('shell.archive')} <ArrowUpRight size={14} aria-hidden />
          <span className="visually-hidden"> ({t('shell.opensNewTab')})</span>
        </a>
      </li>
    </ul>
  );
}

/**
 * Staff layout (RESTRUCTURE §3): a left sidebar with grouped navigation that collapses to icons (remembered)
 * and becomes a slide-in menu on narrow screens, a thin top bar with public links, and a full-width <main>.
 * Focus moves to <main> on route change.
 */
export function AppShell({ currentPath, children }: { currentPath: string; children: ReactNode }) {
  const t = useT();
  const lang = useStaffLang();
  const collapsed = useCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setMenuOpen(false);
    // Scrolling to the top happens in App once the old page has faded out, so it never jumps mid-transition.
    mainRef.current?.focus({ preventScroll: true });
  }, [currentPath]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="shell" data-collapsed={collapsed || undefined}>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        {t('shell.skip')}
      </a>
      <aside className="sidebar" id="sidebar" data-open={menuOpen || undefined}>
        <div className="sidebar__top">
          <Brand />
          <button
            type="button"
            className="sidebar__collapse"
            aria-label={collapsed ? t('shell.expand') : t('shell.collapse')}
            title={collapsed ? t('shell.expand') : t('shell.collapse')}
            aria-pressed={collapsed}
            aria-controls="sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <CaretDoubleRight size={16} weight="bold" aria-hidden /> : <CaretDoubleLeft size={16} weight="bold" aria-hidden />}
          </button>
          <button type="button" className="sidebar__close" aria-label={t('shell.closeMenu')} onClick={() => setMenuOpen(false)}>
            <X size={20} weight="bold" aria-hidden />
          </button>
        </div>
        <SidebarNav currentPath={currentPath} collapsed={collapsed} onNavigate={() => setMenuOpen(false)} />
        <SidebarFooter collapsed={collapsed} />
      </aside>
      {menuOpen && <div className="sidebar-scrim" aria-hidden onClick={() => setMenuOpen(false)} />}
      <div className="shell__body">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="topbar__menu btn btn--secondary btn--icon"
            aria-label={menuOpen ? t('shell.closeMenu') : t('shell.openMenu')}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} weight="bold" aria-hidden /> : <List size={20} weight="bold" aria-hidden />}
          </button>
          <span className="topbar__brand">
            <Brand />
          </span>
          <TopLinks />
        </header>
        <main id="main" className="main" ref={mainRef} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Page title in the concept style; `accent` renders in the brand gradient ("Picsart Academy Գրադարան"). */
export function PageHeader({
  title,
  accent,
  description,
  actions,
}: {
  title: string;
  accent?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header__text">
        <h1>
          {title}
          {accent && (
            <>
              {' '}
              <span className="text-gradient">{accent}</span>
            </>
          )}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="cluster">{actions}</div>}
    </div>
  );
}

/** Section heading with an optional yellow counter ("Գրքեր 4"). */
export function SectionTitle({ id, title, count, icon }: { id?: string; title: string; count?: number; icon?: ReactNode }) {
  return (
    <div className="section-title">
      {icon && <span className="icon-tile icon-tile--sm icon-tile--brand">{icon}</span>}
      <h2 id={id}>{title}</h2>
      {count !== undefined && (
        <span className="badge badge--brand num">
          {count}
          <span className="visually-hidden"> items</span>
        </span>
      )}
    </div>
  );
}
