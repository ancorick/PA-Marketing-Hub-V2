import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { issueBlocks, issueEdits, issues, type IssueBlockRow } from '../db/schema.js';
import type { Language } from '../integrations/core-engine/contract.js';
import { extractUrls } from '../sends/markup.js';
import type { CollectedItem } from './collectors.js';
import { itemLine, localTitle } from './draft.js';
import { NewsletterError, type NewsletterService } from './service.js';

export type BlockChanges = Partial<Pick<IssueBlockRow, 'title' | 'body' | 'imageUrl' | 'imageAlt' | 'buttonLabel' | 'buttonUrl'>>;

const EDITABLE = ['draft', 'in_review', 'approved'] as const;
const TEXT_FIELDS: (keyof BlockChanges)[] = ['title', 'body', 'imageUrl', 'imageAlt', 'buttonLabel', 'buttonUrl'];

/**
 * The issue block editor (NWS-05): edit text, reorder, remove, swap a source item, add custom blocks and
 * images. Every change is logged with editor, time and before/after text (NWS-17). An edit after approval
 * sends the issue back to "needs approval" (story NWS-S2).
 */
export class IssueEditor {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly newsletter: NewsletterService,
  ) {}

  async updateIssue(issueId: string, changes: { subject?: string; preheader?: string | null }, actorId: string) {
    const issue = await this.editable(issueId);
    const logs = [];
    if (changes.subject !== undefined && changes.subject !== issue.subject) logs.push({ field: 'subject', before: issue.subject, after: changes.subject });
    if (changes.preheader !== undefined && changes.preheader !== issue.preheader) logs.push({ field: 'preheader', before: issue.preheader, after: changes.preheader });
    if (logs.length === 0) return issue;
    await this.db
      .update(issues)
      .set({ ...changes, ...(changes.subject !== undefined && { subjectAiDrafted: false }) })
      .where(eq(issues.id, issueId));
    await this.log(issueId, null, actorId, 'subject', logs);
    return this.afterEdit(issueId);
  }

  async updateBlock(issueId: string, blockId: string, changes: BlockChanges, actorId: string, options: { acceptAi?: boolean } = {}) {
    await this.editable(issueId);
    const block = await this.block(issueId, blockId);
    validateBlock({ ...block, ...changes });
    const logs = TEXT_FIELDS.filter((field) => changes[field] !== undefined && changes[field] !== block[field]).map((field) => ({
      field,
      before: block[field] ?? null,
      after: changes[field] ?? null,
    }));
    if (logs.length === 0 && !options.acceptAi) return block;
    // A person edited or accepted the text: it is no longer machine-drafted (NWS-07).
    const [row] = await this.db.update(issueBlocks).set({ ...changes, aiDrafted: false, editedBy: actorId }).where(eq(issueBlocks.id, blockId)).returning();
    await this.log(issueId, blockId, actorId, logs.length > 0 ? 'edit' : 'accept_ai', logs.length > 0 ? logs : [{ field: 'aiDrafted', before: 'true', after: 'false' }]);
    await this.afterEdit(issueId);
    return row as IssueBlockRow;
  }

  async addBlock(issueId: string, input: Required<Pick<BlockChanges, 'title' | 'body'>> & BlockChanges & { position?: number }, actorId: string) {
    await this.editable(issueId);
    validateBlock(input);
    const blocks = await this.newsletter.blocks(issueId);
    const position = Math.min(Math.max(input.position ?? blocks.length, 0), blocks.length);
    // Keep the call to action last unless the editor places the block after it on purpose.
    await this.db
      .update(issueBlocks)
      .set({ position: sql`${issueBlocks.position} + 1` })
      .where(and(eq(issueBlocks.issueId, issueId), sql`${issueBlocks.position} >= ${position}`));
    const [row] = await this.db
      .insert(issueBlocks)
      .values({ issueId, type: 'custom', position, title: input.title, body: input.body, itemIds: [], imageUrl: input.imageUrl ?? null, imageAlt: input.imageAlt ?? null, buttonLabel: input.buttonLabel ?? null, buttonUrl: input.buttonUrl ?? null, editedBy: actorId })
      .returning();
    await this.log(issueId, (row as IssueBlockRow).id, actorId, 'add', [{ field: 'block', before: null, after: `${input.title}\n\n${input.body}` }]);
    await this.afterEdit(issueId);
    return row as IssueBlockRow;
  }

  async removeBlock(issueId: string, blockId: string, actorId: string) {
    await this.editable(issueId);
    const block = await this.block(issueId, blockId);
    await this.db.delete(issueBlocks).where(eq(issueBlocks.id, blockId));
    await this.renumber(issueId);
    await this.log(issueId, blockId, actorId, 'remove', [{ field: 'block', before: `${block.title}\n\n${block.body}`, after: null }]);
    await this.afterEdit(issueId);
  }

  async reorder(issueId: string, blockIds: string[], actorId: string) {
    await this.editable(issueId);
    const blocks = await this.newsletter.blocks(issueId);
    const current = blocks.map((block) => block.id);
    if (blockIds.length !== current.length || !current.every((id) => blockIds.includes(id))) {
      throw new NewsletterError('invalid_field', 'Send every block of the issue exactly once');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, id] of blockIds.entries()) await tx.update(issueBlocks).set({ position }).where(eq(issueBlocks.id, id));
    });
    const title = (ids: string[]) => ids.map((id) => blocks.find((block) => block.id === id)?.title).join(' → ');
    await this.log(issueId, null, actorId, 'reorder', [{ field: 'order', before: title(current), after: title(blockIds) }]);
    await this.afterEdit(issueId);
  }

  /** Replaces one source item of a block with another collected item; the block text is rebuilt from its items. */
  async swapItem(issueId: string, blockId: string, removeItemId: string, addItemId: string, actorId: string) {
    const issue = await this.editable(issueId);
    const block = await this.block(issueId, blockId);
    if (!block.itemIds.includes(removeItemId)) throw new NewsletterError('invalid_field', 'That item is not in this block');
    const [added] = await this.newsletter.itemsByIds([addItemId]);
    if (!added) throw new NewsletterError('invalid_field', 'Item not found');
    if (!added.publishable) throw new NewsletterError('invalid_field', `This item cannot be published: ${added.skipReason}`);
    const itemIds = block.itemIds.map((id) => (id === removeItemId ? addItemId : id));
    const items = await this.newsletter.itemsByIds(itemIds);
    const ordered = itemIds.map((id) => items.find((item) => item.id === id)).filter((item): item is CollectedItem => Boolean(item));
    const language = issue.language as Language;
    const body = ordered.map((item) => itemLine(item, language)).join('\n\n');
    const title = block.type === 'lead' ? localTitle(added, language) : block.title;
    const [row] = await this.db.update(issueBlocks).set({ itemIds, body, title, aiDrafted: false, editedBy: actorId }).where(eq(issueBlocks.id, blockId)).returning();
    await this.log(issueId, blockId, actorId, 'swap', [{ field: 'body', before: block.body, after: body }]);
    await this.afterEdit(issueId);
    return row as IssueBlockRow;
  }

  async edits(issueId: string) {
    return this.db.select().from(issueEdits).where(eq(issueEdits.issueId, issueId)).orderBy(desc(issueEdits.createdAt));
  }

  private async editable(issueId: string) {
    const issue = await this.newsletter.require(issueId);
    if (!(EDITABLE as readonly string[]).includes(issue.status)) throw new NewsletterError('invalid_state', `A ${issue.status} issue cannot be edited`);
    return issue;
  }

  private async block(issueId: string, blockId: string) {
    const [block] = await this.db.select().from(issueBlocks).where(and(eq(issueBlocks.id, blockId), eq(issueBlocks.issueId, issueId)));
    if (!block) throw new NewsletterError('not_found', 'Block not found');
    return block;
  }

  private async renumber(issueId: string) {
    const blocks = await this.db.select().from(issueBlocks).where(eq(issueBlocks.issueId, issueId)).orderBy(asc(issueBlocks.position));
    for (const [position, block] of blocks.entries()) if (block.position !== position) await this.db.update(issueBlocks).set({ position }).where(eq(issueBlocks.id, block.id));
  }

  /** NWS-S2: any edit after approval returns the issue to "needs approval". */
  private async afterEdit(issueId: string) {
    await this.db.update(issues).set({ status: 'in_review' }).where(and(eq(issues.id, issueId), inArray(issues.status, ['approved'])));
    return this.newsletter.require(issueId);
  }

  private async log(issueId: string, blockId: string | null, actorId: string, action: string, changes: { field: string; before: string | null; after: string | null }[]) {
    if (changes.length === 0) return;
    await this.db.insert(issueEdits).values(changes.map((change) => ({ issueId, blockId, actorId, action, ...change })));
  }
}

/** Links must be https (or http) and images need alt text (8.4); checked again before sending (NWS-09). */
function validateBlock(block: BlockChanges) {
  for (const url of [...extractUrls(block.body ?? '').links, ...(block.buttonUrl ? [block.buttonUrl] : []), ...(block.imageUrl ? [block.imageUrl] : [])]) {
    if (!/^https?:\/\//.test(url)) throw new NewsletterError('invalid_field', `Links must start with https:// (${url})`);
  }
  if (block.imageUrl && !block.imageAlt?.trim()) throw new NewsletterError('invalid_field', 'Describe the image in its alt text');
  if (Boolean(block.buttonLabel) !== Boolean(block.buttonUrl)) throw new NewsletterError('invalid_field', 'A button needs both a label and a link');
}
