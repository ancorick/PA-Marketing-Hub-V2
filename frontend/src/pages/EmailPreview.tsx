import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RenderedEmail } from '../lib/api';
import { Alert, SkeletonCard } from '../ui';

/**
 * EML-13 / NWS-08: the rendered email as a desktop client, a 375px phone and a (simulated) dark-mode client
 * show it. Sandboxed iframe: the email's HTML never runs scripts in the app.
 */
export function EmailPreview({ queryKey, load }: { queryKey: unknown[]; load: () => Promise<RenderedEmail> }) {
  const [device, setDevice] = useState<'desktop' | 'mobile' | 'dark'>('desktop');
  const preview = useQuery({ queryKey, queryFn: load });
  return (
    <section className="card stack" aria-labelledby="preview-heading">
      <div className="card__header">
        <h2 id="preview-heading">Preview</h2>
        <div className="segmented" role="group" aria-label="Preview as">
          {(['desktop', 'mobile', 'dark'] as const).map((value) => (
            <button key={value} type="button" className="segmented__btn" aria-pressed={device === value} onClick={() => setDevice(value)}>
              {value === 'desktop' ? 'Desktop' : value === 'mobile' ? 'Phone' : 'Dark mode'}
            </button>
          ))}
        </div>
      </div>
      {preview.data ? (
        <>
          <dl className="facts facts--compact">
            <div>
              <dt>From</dt>
              <dd>{preview.data.from}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{preview.data.subject}</dd>
            </div>
          </dl>
          <div className={`email-preview email-preview--${device}`}>
            <iframe title={`Email preview, ${device}`} sandbox="" srcDoc={preview.data.html} />
          </div>
          {device === 'dark' && <p className="muted">Dark mode is simulated; clients differ. Send a test to the seed list to see real ones.</p>}
        </>
      ) : preview.isError ? (
        <Alert tone="danger" title="Preview failed">
          {preview.error.message}
        </Alert>
      ) : (
        <SkeletonCard />
      )}
    </section>
  );
}
