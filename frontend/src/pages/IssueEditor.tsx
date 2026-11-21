import { ArrowDown, ArrowUp, PencilSimple, Plus, Swap, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import {
  addBlock,
  issueEdits,
  removeBlock,
  reorderBlocks,
  swapBlockItem,
  updateBlock,
  updateIssue,
  uploadImage,
  type BlockInput,
  type CollectedItem,
  type IssueBlock,
  type IssueDetail,
} from '../lib/api';
import { formatDate } from '../lib/format';
import { Disclosure } from '../motion';
import { Alert, Button, ConfirmDialog, SelectField, StatusBadge, Tag, TextField } from '../ui';

const ITEM_BLOCK: Record<string, CollectedItem['type'][]> = {
  lead: ['graduation', 'hire', 'upcoming_event', 'recent_event', 'new_group', 'library'],
  upcoming_events: ['upcoming_event'],
  recent_events: ['recent_event'],
  library: ['library'],
  graduations: ['graduation'],
  hires: ['hire'],
  new_groups: ['new_group'],
};

function useRefresh(issueId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    void queryClient.invalidateQueries({ queryKey: ['issue-edits', issueId] });
    void queryClient.invalidateQueries({ queryKey: ['issues'] });
  };
}

/** Title, body, image and button of a block; images upload straight to the API (NWS-05). */
function BlockForm({ initial, submitLabel, busy, error, onSubmit, onCancel }: { initial: BlockInput; submitLabel: string; busy: boolean; error: Error | null; onSubmit: (input: BlockInput) => void; onCancel?: () => void }) {
  const [form, setForm] = useState<BlockInput>(initial);
  const upload = useMutation({ mutationFn: uploadImage, onSuccess: (result) => setForm((current) => ({ ...current, imageUrl: result.url })) });
  const set = (key: keyof BlockInput, value: string) => setForm((current) => ({ ...current, [key]: value || null }));
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) upload.mutate(file);
  };
  return (
    <div className="stack">
      <TextField label="Title" required value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <div className="field">
        <label className="field__label" htmlFor={`body-${submitLabel}`}>
          Text
        </label>
        <textarea id={`body-${submitLabel}`} className="input textarea" rows={6} value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-describedby={`body-hint-${submitLabel}`} />
        <span id={`body-hint-${submitLabel}`} className="field__hint">
          Blank line = new paragraph. **bold**, [link](https://…). Links get newsletter tags automatically.
        </span>
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field__label" htmlFor={`image-${submitLabel}`}>
            Image
          </label>
          <input id={`image-${submitLabel}`} className="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onFile} />
          <span className="field__hint">{upload.isPending ? 'Uploading…' : upload.isError ? upload.error.message : form.imageUrl ? 'Image attached.' : 'Up to 1 MB. Never put essential text in images (8.4).'}</span>
        </div>
        <TextField label="Image description (alt text)" required={Boolean(form.imageUrl)} value={form.imageAlt ?? ''} onChange={(e) => set('imageAlt', e.target.value)} />
        <TextField label="Button text" value={form.buttonLabel ?? ''} onChange={(e) => set('buttonLabel', e.target.value)} />
        <TextField label="Button link" placeholder="https://…" value={form.buttonUrl ?? ''} onChange={(e) => set('buttonUrl', e.target.value)} />
      </div>
      {error && <Alert tone="danger" title="Not saved">{error.message}</Alert>}
      <div className="cluster">
        <Button variant="primary" loading={busy} disabled={!form.title?.trim()} onClick={() => onSubmit(form)}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function BlockCard({ issueId, block, index, count, items, readOnly, onMove }: { issueId: string; block: IssueBlock; index: number; count: number; items: CollectedItem[]; readOnly: boolean; onMove: (from: number, to: number) => void }) {
  const refresh = useRefresh(issueId);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const save = useMutation({ mutationFn: (input: BlockInput & { acceptAi?: boolean }) => updateBlock(issueId, block.id, input), onSuccess: () => { setEditing(false); refresh(); } });
  const remove = useMutation({ mutationFn: () => removeBlock(issueId, block.id), onSuccess: () => { setRemoving(false); refresh(); } });
  const swap = useMutation({ mutationFn: () => swapBlockItem(issueId, block.id, swapFrom, swapTo), onSuccess: () => { setSwapFrom(''); setSwapTo(''); refresh(); } });
  const sources = items.filter((item) => block.itemIds.includes(item.id));
  const spares = items.filter((item) => !item.used && item.publishable && (ITEM_BLOCK[block.type] ?? []).includes(item.type));

  return (
    <section className="card stack" aria-label={`Block ${index + 1}: ${block.title}`}>
      <div className="card__header">
        <h2>{block.title}</h2>
        <div className="cluster">
          <Tag>{block.type}</Tag>
          {block.aiDrafted && <StatusBadge tone="warning">AI-drafted</StatusBadge>}
          {!readOnly && (
            <>
              <Button size="sm" variant="ghost" iconOnly aria-label={`Move ${block.title} up`} icon={<ArrowUp size={16} weight="bold" aria-hidden />} disabled={index === 0} onClick={() => onMove(index, index - 1)} />
              <Button size="sm" variant="ghost" iconOnly aria-label={`Move ${block.title} down`} icon={<ArrowDown size={16} weight="bold" aria-hidden />} disabled={index === count - 1} onClick={() => onMove(index, index + 1)} />
              <Button size="sm" variant="secondary" icon={<PencilSimple size={16} weight="bold" aria-hidden />} onClick={() => setEditing((v) => !v)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${block.title}`} icon={<Trash size={16} weight="bold" aria-hidden />} onClick={() => setRemoving(true)} />
            </>
          )}
        </div>
      </div>
      {editing ? (
        <BlockForm initial={block} submitLabel="Save block" busy={save.isPending} error={save.error} onSubmit={(input) => save.mutate(input)} onCancel={() => setEditing(false)} />
      ) : (
        <>
          {block.imageUrl && <img className="block-image" src={block.imageUrl} alt={block.imageAlt ?? ''} />}
          <p className="block-body">{block.body}</p>
          {block.buttonLabel && <p className="muted">Button: {block.buttonLabel} → {block.buttonUrl}</p>}
          {block.aiDrafted && !readOnly && (
            <div>
              <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate({ acceptAi: true })}>
                Accept AI text
              </Button>
            </div>
          )}
        </>
      )}
      {sources.length > 0 && (
        <p className="muted">
          Sources: {sources.map((item) => `${item.title} (${item.sourceSystem} ${item.sourceRef})`).join('; ')}
        </p>
      )}
      {!readOnly && sources.length > 0 && spares.length > 0 && (
        <Disclosure title="Swap an item">
          <div className="form-row">
            <SelectField label="Replace" options={[{ value: '', label: 'Choose' }, ...sources.map((item) => ({ value: item.id, label: item.title }))]} value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)} />
            <SelectField label="With" options={[{ value: '', label: 'Choose' }, ...spares.map((item) => ({ value: item.id, label: item.title }))]} value={swapTo} onChange={(e) => setSwapTo(e.target.value)} />
          </div>
          <p className="muted">The block text is rebuilt from its items; your edits to this block are replaced.</p>
          <Button size="sm" variant="secondary" icon={<Swap size={16} weight="bold" aria-hidden />} disabled={!swapFrom || !swapTo} loading={swap.isPending} onClick={() => swap.mutate()}>
            Swap
          </Button>
          {swap.isError && <Alert tone="danger" title="Not swapped">{swap.error.message}</Alert>}
        </Disclosure>
      )}
      <ConfirmDialog open={removing} title={`Remove “${block.title}”?`} confirmLabel="Remove block" busy={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setRemoving(false)}>
        <p>The block and its text leave this issue. Its source items stay available to swap back in.</p>
      </ConfirmDialog>
    </section>
  );
}

/** NWS-05 and NWS-17 for one issue: subject, blocks, custom blocks and the edit log. */
export function IssueEditor({ data }: { data: IssueDetail }) {
  const { issue, blocks, items } = data;
  const refresh = useRefresh(issue.id);
  const readOnly = !['draft', 'in_review', 'approved'].includes(issue.status);
  const [subject, setSubject] = useState(issue.subject ?? '');
  const [preheader, setPreheader] = useState(issue.preheader ?? '');
  const [adding, setAdding] = useState(false);
  const saveIssue = useMutation({ mutationFn: () => updateIssue(issue.id, { subject, preheader: preheader || null }), onSuccess: refresh });
  const add = useMutation({ mutationFn: (input: BlockInput) => addBlock(issue.id, { title: input.title ?? '', body: input.body ?? '', ...input, position: Math.max(blocks.length - 1, 0) }), onSuccess: () => { setAdding(false); refresh(); } });
  const reorder = useMutation({ mutationFn: (ids: string[]) => reorderBlocks(issue.id, ids), onSuccess: refresh });
  const edits = useQuery({ queryKey: ['issue-edits', issue.id], queryFn: () => issueEdits(issue.id) });
  const move = (from: number, to: number) => {
    const ids = blocks.map((block) => block.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    reorder.mutate(ids);
  };

  return (
    <div className="stack stack--lg">
      {issue.status === 'approved' && <Alert tone="info" title="Approved">Any change sends it back to “needs approval”.</Alert>}
      <section className="card stack" aria-labelledby="subject-heading">
        <h2 id="subject-heading">Subject</h2>
        <div className="form-row">
          <TextField label="Subject line" required disabled={readOnly} hint={`${subject.length} characters (keep under 70, NWS-09).`} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField label="Preview text" disabled={readOnly} value={preheader} onChange={(e) => setPreheader(e.target.value)} />
        </div>
        {issue.subjectAiDrafted && <StatusBadge tone="warning">AI-drafted subject</StatusBadge>}
        {!readOnly && (
          <div>
            <Button variant="secondary" loading={saveIssue.isPending} disabled={subject === (issue.subject ?? '') && preheader === (issue.preheader ?? '')} onClick={() => saveIssue.mutate()}>
              Save subject
            </Button>
          </div>
        )}
      </section>
      {reorder.isError && <Alert tone="danger" title="Order not saved">{reorder.error.message}</Alert>}
      {blocks.map((block, index) => (
        <BlockCard key={block.id} issueId={issue.id} block={block} index={index} count={blocks.length} items={items} readOnly={readOnly} onMove={move} />
      ))}
      {!readOnly && (
        <section className="card stack" aria-labelledby="add-block-heading">
          <h2 id="add-block-heading">Custom block</h2>
          {adding ? (
            <BlockForm initial={{ title: '', body: '' }} submitLabel="Add block" busy={add.isPending} error={add.error} onSubmit={(input) => add.mutate(input)} onCancel={() => setAdding(false)} />
          ) : (
            <div>
              <Button variant="secondary" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setAdding(true)}>
                Add a block
              </Button>
            </div>
          )}
        </section>
      )}
      <section className="card stack" aria-labelledby="edits-heading">
        <h2 id="edits-heading">Edit log</h2>
        <Disclosure title={`${edits.data?.edits.length ?? 0} changes (NWS-17)`}>
          <ol className="list-reset history">
            {(edits.data?.edits ?? []).map((edit) => (
              <li key={edit.id} className="history__item">
                <span className="history__time num">{formatDate(edit.createdAt, undefined, { timeStyle: 'short' })}</span>
                <span className="stack stack--xs">
                  <span>
                    <strong>{edit.action}</strong> {edit.field && `· ${edit.field}`} · {edit.actorId}
                  </span>
                  {edit.before !== null && <span className="edit-before">{edit.before}</span>}
                  {edit.after !== null && <span className="edit-after">{edit.after}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Disclosure>
      </section>
    </div>
  );
}
