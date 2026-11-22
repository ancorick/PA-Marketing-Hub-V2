import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem<Id extends string> = { id: Id; label: string; count?: number };

/**
 * Tab strip for pages that split one subject into views (Campaign emails, Admin). Real tabs: arrow keys, Home
 * and End move between them, only the selected one is in the tab order. The strip never shows scroll arrows;
 * on a narrow screen it scrolls sideways with the finger. The page passes the same `idBase` (from useId) to the
 * strip and to each `TabPanel`, so the two reference each other.
 */
export function Tabs<Id extends string>({ idBase, label, tabs, value, onChange }: { idBase: string; label: string; tabs: TabItem<Id>[]; value: Id; onChange: (id: Id) => void }) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());
  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            if (node) refs.current.set(tab.id, node);
            else refs.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className="tabs__tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tabs__count num">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idBase, id, children }: { idBase: string; id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} className="tabs__panel">
      {children}
    </div>
  );
}
