import {
  CalendarBlank,
  ChartLine,
  EnvelopeSimple,
  List,
  Newspaper,
  PaperPlaneTilt,
  ShieldCheck,
  SquaresFour,
  UsersThree,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import logoUrl from '../assets/picsart-academy-logo.webp';
import { Button } from './Button';

export type NavItem = { path: string; label: string; icon: Icon };

/** Navigation order from PRD 9.6. */
export const PRIMARY_NAV: NavItem[] = [
  { path: '/', label: 'Overview', icon: SquaresFour },
  { path: '/audience', label: 'Audience', icon: UsersThree },
  { path: '/campaigns', label: 'Campaigns', icon: PaperPlaneTilt },
  { path: '/newsletter', label: 'Newsletter', icon: Newspaper },
  { path: '/events', label: 'Events', icon: CalendarBlank },
  { path: '/analytics', label: 'Analytics', icon: ChartLine },
  { path: '/email-settings', label: 'Email settings', icon: EnvelopeSimple },
];

/** Admin (PRD 4.3), separated from the main modules. The design-system preview is linked from Admin. */
export const SECONDARY_NAV: NavItem[] = [{ path: '/admin', label: 'Admin', icon: ShieldCheck }];

/** Official Picsart Academy cube (docs/references) + product name. The image is decorative: the text names it. */
function Brand() {
  return (
    <a className="brand" href="#/">
      <img className="brand__logo" src={logoUrl} alt="" width={40} height={37} />
      <span className="brand__text">
        <span className="brand__name">Picsart Academy</span>
        <span className="brand__product">Marketing Hub</span>
      </span>
    </a>
  );
}

/**
 * Staff layout from the brand concept: sticky header with the logo, a pill navigation
 * (≥1280px) or a menu button with a drawer, and <main>. Focus moves to <main> on route change.
 */
export function AppShell({
  currentPath,
  headerEnd,
  children,
}: {
  currentPath: string;
  headerEnd?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Scrolling to the top happens in App once the old page has faded out, so it never jumps mid-transition.
    mainRef.current?.focus({ preventScroll: true });
  }, [currentPath]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // A section stays highlighted on its sub-pages ("/audience/contacts/…" → Audience).
  const current = (path: string) => (currentPath === path || currentPath.startsWith(`${path}/`) ? 'page' : undefined);
  const close = () => setMenuOpen(false);

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="header">
        <div className="header__inner">
          <Brand />
          <nav aria-label="Main">
            <ul className="pillnav">
              {PRIMARY_NAV.map(({ path, label }) => (
                <li key={path}>
                  <a className="pillnav__link" href={`#${path}`} aria-current={current(path)}>
                    {label}
                  </a>
                </li>
              ))}
              <li className="pillnav__divider" aria-hidden />
              {SECONDARY_NAV.map(({ path, label }) => (
                <li key={path}>
                  <a className="pillnav__link" href={`#${path}`} aria-current={current(path)}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="header__end">
            {headerEnd}
            <span className="menu-btn">
              <Button
                variant="secondary"
                iconOnly
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                aria-controls="nav-drawer"
                icon={menuOpen ? <X size={20} weight="bold" aria-hidden /> : <List size={20} weight="bold" aria-hidden />}
                onClick={() => setMenuOpen((open) => !open)}
              />
            </span>
          </div>
        </div>
      </header>
      {menuOpen && (
        <nav className="drawer" id="nav-drawer" aria-label="Main">
          <ul className="drawer__list">
            {PRIMARY_NAV.map(({ path, label, icon: ItemIcon }) => (
              <li key={path}>
                <a className="drawer__link" href={`#${path}`} aria-current={current(path)} onClick={close}>
                  <ItemIcon size={20} aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="eyebrow drawer__label" aria-hidden>
            Admin
          </p>
          <ul className="drawer__list">
            {SECONDARY_NAV.map(({ path, label, icon: ItemIcon }) => (
              <li key={path}>
                <a className="drawer__link" href={`#${path}`} aria-current={current(path)} onClick={close}>
                  <ItemIcon size={20} aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main id="main" className="main" ref={mainRef} tabIndex={-1}>
        {children}
      </main>
    </>
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
