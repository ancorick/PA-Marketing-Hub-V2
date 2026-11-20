import { CheckCircle, EnvelopeSimple, LinkBreak } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import logoUrl from '../assets/picsart-academy-logo.webp';
import {
  ApiError,
  getPublicPreferences,
  publicUndoUnsubscribe,
  publicUnsubscribe,
  publicUnsubscribeAll,
  savePublicPreferences,
  type Frequency,
  type Language,
  type Topic,
} from '../lib/api';
import { Alert, Button, SkeletonCard } from '../ui';
import { PUBLIC_LANGUAGES, setPublicLanguage, suggestPublicLanguage, usePublicLanguage } from './i18n';

const TOPICS: Topic[] = ['newsletter', 'courses', 'events', 'alumni'];

/** Layout for pages people reach from an email: logo, language switch, one card, privacy link (NFR-P6). */
function PublicLayout({ children }: { children: ReactNode }) {
  const [language, t] = usePublicLanguage();
  return (
    <div className="public">
      <header className="public__header">
        <span className="brand">
          <img className="brand__logo" src={logoUrl} alt="" width={40} height={37} />
          <span className="brand__text">
            <span className="brand__name">Picsart Academy</span>
          </span>
        </span>
        <div className="segmented" role="group" aria-label={t.languageLabel}>
          {PUBLIC_LANGUAGES.map((option) => (
            <button
              key={option.value}
              type="button"
              lang={option.value}
              className="segmented__btn"
              aria-pressed={language === option.value}
              onClick={() => setPublicLanguage(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>
      <main id="main" className="public__main" lang={language}>
        {children}
      </main>
      <footer className="public__footer">
        <a href="#/p/privacy">{t.privacyLink}</a>
      </footer>
    </div>
  );
}

function errorText(error: unknown, t: ReturnType<typeof usePublicLanguage>[1]): { title: string; text: string } {
  if (error instanceof ApiError) {
    if (error.code === 'link_expired') return { title: t.linkExpiredTitle, text: t.linkExpiredText };
    if (error.code === 'invalid_link' || error.status === 404) return { title: t.linkInvalidTitle, text: t.linkInvalidText };
    if (error.status === 429) return { title: t.genericError, text: t.rateLimited };
  }
  return { title: t.genericError, text: '' };
}

function LinkProblem({ error }: { error: unknown }) {
  const [, t] = usePublicLanguage();
  const { title, text } = errorText(error, t);
  return (
    <section className="card public__card stack">
      <span className="icon-tile icon-tile--brand">
        <LinkBreak size={24} weight="bold" aria-hidden />
      </span>
      <h1 className="public__title">{title}</h1>
      {text && <p>{text}</p>}
    </section>
  );
}

/**
 * Flow E: the footer link lands here and unsubscribes in one click, then offers undo and preferences.
 * The POST runs once per page load (a ref guards React's double effects in development).
 */
function UnsubscribePage({ token }: { token: string }) {
  const [, t] = usePublicLanguage();
  const started = useRef(false);
  const unsubscribe = useMutation({
    mutationFn: () => publicUnsubscribe(token),
    onSuccess: (result) => suggestPublicLanguage(result.language),
  });
  const undo = useMutation({ mutationFn: () => publicUndoUnsubscribe(token) });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    unsubscribe.mutate();
  }, [unsubscribe]);

  if (unsubscribe.isError) return <LinkProblem error={unsubscribe.error} />;
  if (!unsubscribe.isSuccess) {
    return (
      <section className="card public__card" aria-busy>
        <p role="status">{t.unsubWorking}</p>
      </section>
    );
  }
  const preferencesToken = unsubscribe.data.preferencesToken;
  return (
    <section className="card public__card stack" aria-live="polite">
      <span className="icon-tile icon-tile--brand">
        <CheckCircle size={24} weight="bold" aria-hidden />
      </span>
      <h1 className="public__title">{undo.isSuccess ? t.unsubUndoneTitle : t.unsubDoneTitle}</h1>
      <p>{undo.isSuccess ? t.unsubUndoneText : t.unsubDoneText}</p>
      {undo.isError && <Alert tone="danger" title={errorText(undo.error, t).title} />}
      <div className="cluster">
        {!undo.isSuccess && (
          <Button variant="secondary" loading={undo.isPending} onClick={() => undo.mutate()}>
            {t.unsubUndo}
          </Button>
        )}
        {preferencesToken && (
          <a className="btn btn--ghost" href={`#/p/preferences?t=${encodeURIComponent(preferencesToken)}`}>
            {t.unsubToPreferences}
          </a>
        )}
      </div>
    </section>
  );
}

/** AUD-11: topics, language and frequency, or unsubscribe from all, through a signed link. */
function PreferencesPage({ token }: { token: string }) {
  const [, t] = usePublicLanguage();
  const preferences = useQuery({ queryKey: ['public-preferences', token], queryFn: () => getPublicPreferences(token), retry: false });
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [language, setLanguage] = useState<Language | null>(null);
  const [frequency, setFrequency] = useState<Frequency | null>(null);

  useEffect(() => {
    if (preferences.data) suggestPublicLanguage(preferences.data.language);
  }, [preferences.data]);

  const save = useMutation({
    mutationFn: () =>
      savePublicPreferences(token, {
        topics: topics ?? preferences.data!.topics,
        language: language ?? preferences.data!.language,
        frequency: frequency ?? preferences.data!.frequency,
      }),
    onSuccess: () => void preferences.refetch(),
  });
  const unsubscribeAll = useMutation({
    mutationFn: () => publicUnsubscribeAll(token),
    onSuccess: () => {
      setTopics([]);
      void preferences.refetch();
    },
  });

  if (preferences.isPending) return <SkeletonCard />;
  if (preferences.isError) return <LinkProblem error={preferences.error} />;
  const data = preferences.data;
  const selected = topics ?? data.topics;
  const toggle = (topic: Topic) => {
    save.reset();
    setTopics(selected.includes(topic) ? selected.filter((item) => item !== topic) : [...selected, topic]);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <section className="card public__card stack" aria-labelledby="prefs-title">
      <div className="stack stack--xs">
        <h1 id="prefs-title" className="public__title">
          {t.prefsTitle}
        </h1>
        <p className="muted">{t.prefsFor(data.email)}</p>
      </div>
      {data.suppressed && <Alert tone="info" title={t.prefsSuppressed} />}
      <form className="stack stack--lg" onSubmit={submit} noValidate>
        <fieldset className="fieldset">
          <legend className="fieldset__legend">{t.prefsTopics}</legend>
          <div className="stack stack--sm">
            {TOPICS.map((topic) => (
              <label key={topic} className="check">
                <input type="checkbox" checked={selected.includes(topic)} onChange={() => toggle(topic)} />
                <span className="stack stack--xs">
                  <strong>{t.topics[topic].label}</strong>
                  <span className="muted">{t.topics[topic].description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="field__hint">{t.prefsTopicsHint}</p>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset__legend">{t.prefsLanguage}</legend>
          <div className="segmented" role="group" aria-label={t.prefsLanguage}>
            {PUBLIC_LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                lang={option.value}
                className="segmented__btn"
                aria-pressed={(language ?? data.language) === option.value}
                onClick={() => setLanguage(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset__legend">{t.prefsFrequency}</legend>
          <div className="stack stack--sm">
            {(['all', 'monthly'] as const).map((value) => (
              <label key={value} className="check">
                <input type="radio" name="frequency" checked={(frequency ?? data.frequency) === value} onChange={() => setFrequency(value)} />
                <span>{value === 'all' ? t.frequencyAll : t.frequencyMonthly}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div role="status" aria-live="polite">
          {save.isSuccess && <Alert tone="success" title={t.prefsSaved} />}
          {unsubscribeAll.isSuccess && <Alert tone="success" title={t.prefsUnsubscribedAll} />}
          {(save.isError || unsubscribeAll.isError) && <Alert tone="danger" title={errorText(save.error ?? unsubscribeAll.error, t).title} />}
        </div>
        <div className="cluster spread">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t.prefsSave}
          </Button>
          {!data.suppressed && (
            <Button type="button" variant="ghost" loading={unsubscribeAll.isPending} onClick={() => unsubscribeAll.mutate()}>
              {t.prefsUnsubscribeAll}
            </Button>
          )}
        </div>
      </form>
      <p className="muted public__note">{t.prefsDataNote}</p>
    </section>
  );
}

/** NFR-P6: the privacy notice linked from every form and the preferences page. */
function PrivacyPage() {
  const [, t] = usePublicLanguage();
  return (
    <section className="card public__card stack" aria-labelledby="privacy-title">
      <span className="icon-tile icon-tile--brand">
        <EnvelopeSimple size={24} weight="bold" aria-hidden />
      </span>
      <h1 id="privacy-title" className="public__title">
        {t.privacyTitle}
      </h1>
      <Alert tone="info" title={t.privacyDraft} />
      {t.privacySections.map((section) => (
        <div key={section.title} className="stack stack--xs">
          <h2 className="public__subtitle">{section.title}</h2>
          <p>{section.text}</p>
        </div>
      ))}
    </section>
  );
}

/** Routes under "#/p/…": pages for contacts, outside the staff shell and without a staff session. */
export function PublicApp({ path }: { path: string }) {
  const [page, query = ''] = path.split('?');
  const token = new URLSearchParams(query).get('t') ?? '';
  let content: ReactNode;
  if (page === '/p/unsubscribe') content = token ? <UnsubscribePage token={token} /> : <LinkProblem error={new ApiError(400, '', null, 'invalid_link')} />;
  else if (page === '/p/preferences') content = token ? <PreferencesPage token={token} /> : <LinkProblem error={new ApiError(400, '', null, 'invalid_link')} />;
  else content = <PrivacyPage />;
  return <PublicLayout>{content}</PublicLayout>;
}
