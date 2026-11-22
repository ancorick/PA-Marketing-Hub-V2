import { Tray } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, getInboxMessage, listInbox } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, EmptyState, PageHeader, retryServerErrors, SkeletonCard, StatusBadge } from '../../ui';
import { useDateTimeLabel } from '../measure/shared';

type View = 'html' | 'text' | 'headers';
const VIEWS: View[] = ['html', 'text', 'headers'];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Dev inbox (RESTRUCTURE §3, R5): every message the development email adapter kept instead of sending, with a
 * rendered preview, the plain text and the headers. The server only offers it outside production; the nav item
 * is hidden in production builds as well. The message HTML is shown in a sandboxed frame, so it never runs scripts.
 */
export function DevInboxPage() {
  const t = useT();
  const role = useStaffRole();
  const dateTime = useDateTimeLabel();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('html');
  const query = useDebounced(filter.trim(), 250);
  const list = useQuery({ queryKey: ['dev-inbox', role, query], queryFn: () => listInbox(query || undefined), retry: retryServerErrors, refetchInterval: 15_000 });
  const message = useQuery({ queryKey: ['dev-inbox-message', role, selected], queryFn: () => getInboxMessage(selected!), enabled: selected !== null, retry: retryServerErrors });
  const access = accessProblem(list.error);
  const missing = list.error instanceof ApiError && list.error.status === 404;
  const messages = list.data?.messages ?? [];
  const detail = message.data;

  return (
    <>
      <PageHeader title={t('nav.devInbox')} description={t('di.description')} actions={<StatusBadge tone="info">{t('shell.devOnly')}</StatusBadge>} />
      {access ? (
        <AccessNotice problem={access} title={t('di.unavailable')}>
          {t('di.unavailableHint')}
        </AccessNotice>
      ) : missing ? (
        <section className="card">
          <EmptyState title={t('di.unavailable')} icon={<Tray size={28} weight="bold" aria-hidden />}>
            {t('di.unavailableHint')}
          </EmptyState>
        </section>
      ) : (
        <div className="stack stack--lg">
          {list.isError && <Alert tone="danger" title={t('s.notLoaded')}>{list.error.message}</Alert>}
          <div className="inbox">
            <section className="card stack" aria-labelledby="inbox-heading">
              <div className="card__header">
                <h2 id="inbox-heading">{t('di.messages')}</h2>
                <label className="filter">
                  <span className="visually-hidden">{t('di.filter')}</span>
                  <input className="input input--sm" type="search" placeholder={t('di.filter')} value={filter} onChange={(event) => setFilter(event.target.value)} />
                </label>
              </div>
              {list.isPending ? (
                <SkeletonCard />
              ) : messages.length === 0 ? (
                <EmptyState title={query ? t('di.noMatch') : t('di.empty')} icon={<Tray size={28} weight="bold" aria-hidden />} />
              ) : (
                <ul className="inbox__list" aria-label={t('di.messages')}>
                  {messages.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="inbox__item" aria-current={item.id === selected} onClick={() => setSelected(item.id)}>
                        <span className="inbox__subject">{item.subject}</span>
                        <span className="inbox__meta">{item.to}</span>
                        <span className="inbox__meta num">{dateTime(item.receivedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {list.data && <p className="muted text-xs">{t('di.kept', { n: formatNumber(list.data.total) })}</p>}
            </section>
            <section className="card stack" aria-labelledby="message-heading" aria-live="polite">
              <h2 id="message-heading">{detail ? detail.subject : t('di.pick')}</h2>
              {selected === null ? (
                <p className="muted">{t('di.pickHint')}</p>
              ) : message.isPending ? (
                <SkeletonCard />
              ) : message.isError ? (
                <Alert tone="danger" title={t('s.notLoaded')}>{message.error.message}</Alert>
              ) : detail ? (
                <>
                  <dl className="facts facts--compact">
                    <div>
                      <dt>{t('di.from')}</dt>
                      <dd>{detail.from}</dd>
                    </div>
                    <div>
                      <dt>{t('di.to')}</dt>
                      <dd>{detail.to}</dd>
                    </div>
                    <div>
                      <dt>{t('di.stream')}</dt>
                      <dd>{t(`di.stream.${detail.stream}`)}</dd>
                    </div>
                    <div>
                      <dt>{t('di.received')}</dt>
                      <dd className="num">{dateTime(detail.receivedAt)}</dd>
                    </div>
                  </dl>
                  <div className="segmented segmented--compact" role="group" aria-label={t('di.view')}>
                    {VIEWS.map((value) => (
                      <button key={value} type="button" className="segmented__btn" aria-pressed={view === value} onClick={() => setView(value)}>
                        {t(value === 'html' ? 'di.html' : value === 'text' ? 'di.text' : 'di.headers')}
                      </button>
                    ))}
                  </div>
                  {view === 'html' && (
                    <div className="email-preview email-preview--desktop">
                      <iframe title={detail.subject} sandbox="" srcDoc={detail.html} />
                    </div>
                  )}
                  {view === 'text' && <pre className="inbox__text">{detail.text}</pre>}
                  {view === 'headers' &&
                    (Object.keys(detail.headers).length === 0 ? (
                      <p className="muted">{t('di.noHeaders')}</p>
                    ) : (
                      <dl className="facts facts--compact">
                        {Object.entries(detail.headers).map(([name, value]) => (
                          <div key={name}>
                            <dt>{name}</dt>
                            <dd className="text-wrap">
                              <code>{value}</code>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ))}
                </>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
