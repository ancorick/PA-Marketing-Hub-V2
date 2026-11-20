import { ArrowLeft, FileCsv, UploadSimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import {
  ApiError,
  commitImport,
  IMPORT_FIELDS,
  listChannels,
  previewImport,
  type ColumnMapping,
  type ImportField,
  type ImportOptions,
  type ImportRow,
  type Language,
  type Topic,
} from '../lib/api';
import { LANGUAGE_LABEL, options, TOPIC_LABEL } from '../lib/contacts';
import { formatNumber } from '../lib/format';
import { Alert, Button, ConfirmDialog, DataTable, PageHeader, SelectField, StatTile, StatusBadge, TextField, type Column, type Tone } from '../ui';

const FIELD_LABEL: Record<ImportField, string> = {
  email: 'Email (required)',
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  phone: 'Phone',
  language: 'Language',
  type: 'Type',
  sourceChannel: 'Source channel',
  sourceCampaign: 'Source campaign',
  firstTouchAt: 'First touch date',
  tags: 'Tags',
  consent: 'Consent',
};

const ROW_STATUS: Record<ImportRow['status'], { tone: Tone; label: string }> = {
  new: { tone: 'success', label: 'New' },
  match: { tone: 'info', label: 'Matches a contact' },
  duplicate_in_file: { tone: 'neutral', label: 'Repeated in file' },
  invalid: { tone: 'danger', label: 'Invalid' },
};

const MAX_BYTES = 10 * 1024 * 1024;

const problemColumns: Column<ImportRow>[] = [
  { key: 'line', header: 'Line', numeric: true, render: (row) => <span className="num">{row.line}</span> },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={ROW_STATUS[row.status].tone}>{ROW_STATUS[row.status].label}</StatusBadge> },
  { key: 'email', header: 'Email', render: (row) => row.email ?? <span className="muted">—</span> },
  {
    key: 'problem',
    header: 'What to check',
    render: (row) =>
      row.errors.length > 0
        ? row.errors.join('; ')
        : row.possibleDuplicate
          ? row.possibleDuplicate.line
            ? `Looks like line ${row.possibleDuplicate.line} (${row.possibleDuplicate.reason === 'phone' ? 'same phone' : 'same email apart from dots or +tag'})`
            : `Looks like an existing contact (${row.possibleDuplicate.reason === 'phone' ? 'same phone' : 'same email apart from dots or +tag'}); review it in Duplicates after import`
          : '',
  },
];

/**
 * Audience → Import (PRD 13.6, AUD-03, AUD-04): upload, column mapping, preview of every problem, then commit.
 * Nothing is written until the editor confirms the preview.
 */
export function ImportPage() {
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity });
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | undefined>(undefined);
  const [settings, setSettings] = useState<ImportOptions>({ defaultLanguage: 'hy' });
  const [tags, setTags] = useState('');
  const [confirming, setConfirming] = useState(false);

  const request = () => ({
    fileName: file!.name,
    csv: file!.csv,
    mapping,
    options: {
      ...settings,
      sourceCampaign: settings.sourceCampaign || null,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      ...(settings.defaultSourceChannel ? {} : { defaultSourceChannel: undefined }),
    },
  });
  const preview = useMutation({ mutationFn: () => previewImport(request()), onSuccess: (result) => setMapping(result.mapping) });
  const commit = useMutation({
    mutationFn: () => commitImport(request()),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    setFileError(null);
    preview.reset();
    commit.reset();
    setMapping(undefined);
    if (!chosen) return setFile(null);
    if (chosen.size > MAX_BYTES) return setFileError('The file is larger than 10 MB; split it into smaller files.');
    setFile({ name: chosen.name, csv: await chosen.text() });
  };

  const setMapped = (field: ImportField, value: string) => {
    preview.reset();
    setMapping((current) => {
      const next = { ...current };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
  };
  const setOption = (change: Partial<ImportOptions>) => {
    preview.reset();
    setSettings((current) => ({ ...current, ...change }));
  };

  const apiError = (preview.error ?? commit.error) instanceof ApiError ? ((preview.error ?? commit.error) as ApiError) : null;
  const data = preview.data;
  const writes = data ? data.totals.new + data.totals.match : 0;

  return (
    <>
      <a className="back-link" href="#/audience">
        <ArrowLeft size={16} weight="bold" aria-hidden />
        All contacts
      </a>
      <PageHeader title="Import" accent="contacts" description="Upload a CSV, check the preview, then import. Nothing is saved before you confirm." />
      <div className="stack stack--lg">
        <section className="card stack" aria-labelledby="file-heading">
          <div className="cluster">
            <span className="icon-tile icon-tile--sm icon-tile--brand">
              <FileCsv size={20} weight="bold" aria-hidden />
            </span>
            <h2 id="file-heading">1. File and defaults</h2>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="csv-file">
              CSV file<span className="field__required" aria-hidden>*</span>
            </label>
            <input id="csv-file" className="input" type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} aria-describedby="csv-hint" />
            <span id="csv-hint" className="field__hint">
              UTF-8, comma or semicolon separated, header row first. Up to 20,000 rows and 10 MB.
            </span>
            {fileError && <span className="field__error">{fileError}</span>}
          </div>
          <div className="form-row">
            <SelectField
              label="Language when the file has none"
              options={options(LANGUAGE_LABEL)}
              value={settings.defaultLanguage}
              onChange={(event) => setOption({ defaultLanguage: event.target.value as Language })}
            />
            <SelectField
              label="Source when the file has none"
              options={[{ value: '', label: 'Choose a channel' }, ...(channels.data?.channels.map((c) => ({ value: c.id, label: c.name })) ?? [])]}
              value={settings.defaultSourceChannel ?? ''}
              error={apiError?.details.field === 'defaultSourceChannel' ? apiError.message : undefined}
              onChange={(event) => setOption({ defaultSourceChannel: event.target.value || undefined })}
            />
            <TextField
              label="Source campaign"
              hint="Optional campaign code for every row."
              value={settings.sourceCampaign ?? ''}
              onChange={(event) => setOption({ sourceCampaign: event.target.value })}
            />
            <TextField label="Tags for every row" hint="Comma-separated, e.g. open-day-2025." value={tags} onChange={(event) => setTags(event.target.value)} />
          </div>
        </section>

        {file && (
          <section className="card stack" aria-labelledby="mapping-heading">
            <h2 id="mapping-heading">2. Columns</h2>
            {data ? (
              <div className="form-row">
                {IMPORT_FIELDS.map((field) => (
                  <SelectField
                    key={field}
                    label={FIELD_LABEL[field]}
                    options={[{ value: '', label: 'Not in the file' }, ...data.headers.map((header, index) => ({ value: String(index), label: header || `Column ${index + 1}` }))]}
                    value={mapping?.[field] === undefined ? '' : String(mapping[field])}
                    onChange={(event) => setMapped(field, event.target.value)}
                  />
                ))}
                {mapping?.consent !== undefined && (
                  <SelectField
                    label="Consent column is for"
                    options={[{ value: '', label: 'Choose a topic' }, ...options(TOPIC_LABEL)]}
                    value={settings.consentTopic ?? ''}
                    error={apiError?.details.field === 'consentTopic' ? apiError.message : undefined}
                    onChange={(event) => setOption({ consentTopic: (event.target.value || undefined) as Topic | undefined })}
                  />
                )}
              </div>
            ) : (
              <p className="muted">Columns are suggested from the header row when you check the file.</p>
            )}
            <div className="cluster">
              <Button variant={data ? 'secondary' : 'primary'} icon={<UploadSimple size={18} weight="bold" aria-hidden />} loading={preview.isPending} onClick={() => preview.mutate()}>
                {data ? 'Check again' : 'Check the file'}
              </Button>
            </div>
            {apiError && !['defaultSourceChannel', 'consentTopic'].includes(apiError.details.field ?? '') && (
              <Alert tone="danger" title="The file cannot be imported yet">
                {apiError.message}
              </Alert>
            )}
          </section>
        )}

        {data && (
          <section className="card stack" aria-labelledby="preview-heading">
            <h2 id="preview-heading">3. Preview</h2>
            <div className="tiles">
              <StatTile label="New contacts" value={formatNumber(data.totals.new)} definition="Rows with an email that is not in Audience yet." />
              <StatTile label="Match existing" value={formatNumber(data.totals.match)} definition="Same email as a contact: tags and empty fields are added; source and first touch stay." />
              <StatTile label="Invalid" value={formatNumber(data.totals.invalid)} definition="Rows that are skipped; the table below says why." />
              <StatTile label="Look-alikes" value={formatNumber(data.totals.possibleDuplicates)} definition="Rows that may be someone already in Audience or earlier in the file (AUD-04)." />
            </div>
            {!data.hasConsentColumn && (
              <Alert tone="warning" title="No consent column: imported as unknown consent">
                These contacts get no marketing email until they confirm through a re-permission campaign (PRD 6.3).
              </Alert>
            )}
            {data.totals.duplicate_in_file > 0 && (
              <p className="muted">{formatNumber(data.totals.duplicate_in_file)} rows repeat an email from earlier in the file and are skipped.</p>
            )}
            <DataTable
              caption="Rows to check"
              columns={problemColumns}
              rows={data.problems}
              rowKey={(row) => String(row.line)}
              empty="No invalid rows and no look-alikes."
            />
            <div role="status" aria-live="polite">
              {commit.isSuccess && (
                <Alert
                  tone="success"
                  title={`Imported: ${formatNumber(commit.data.created)} new, ${formatNumber(commit.data.updated)} updated`}
                  action={
                    <a className="btn btn--secondary btn--sm" href="#/audience/duplicates">
                      Review duplicates
                    </a>
                  }
                >
                  {formatNumber(commit.data.invalid)} invalid and {formatNumber(commit.data.skipped)} repeated rows were skipped.
                </Alert>
              )}
            </div>
            {!commit.isSuccess && (
              <div>
                <Button variant="primary" disabled={writes === 0} onClick={() => setConfirming(true)}>
                  Import {formatNumber(writes)} contacts
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Import ${file?.name ?? 'file'}?`}
        confirmLabel="Import contacts"
        tone="primary"
        affected={{ count: writes, noun: 'contacts' }}
        busy={commit.isPending}
        onConfirm={() => commit.mutate()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {data ? `${formatNumber(data.totals.new)} new contacts are created and ${formatNumber(data.totals.match)} existing contacts get the file’s tags and empty fields.` : ''}{' '}
          Unsubscribed and bounced addresses stay suppressed whatever the file says.
        </p>
        {commit.isError && (
          <Alert tone="danger" title="Import failed">
            {commit.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </>
  );
}
