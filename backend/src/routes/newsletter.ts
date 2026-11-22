import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/staff.js';
import { LANGUAGES } from '../contacts/fields.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { AssistUnavailableError } from '../ai/writing-assistant.js';
import type { IssueEditor } from '../newsletter/editor.js';
import type { NewsletterPublishing } from '../newsletter/publishing.js';
import { ITEM_TYPES, NewsletterRanking, RankingError } from '../newsletter/ranking.js';
import { NewsletterError, type NewsletterService } from '../newsletter/service.js';
import { UploadError, type UploadService } from '../uploads/service.js';

const idParams = z.object({ id: z.uuid() });
const blockParams = z.object({ id: z.uuid(), blockId: z.uuid() });
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const blockBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
    imageUrl: optionalText(2000),
    imageAlt: optionalText(300),
    buttonLabel: optionalText(60),
    buttonUrl: optionalText(2000),
    acceptAi: z.boolean().optional(),
  })
  .strict();
const addBody = z
  .object({ title: z.string().trim().min(1).max(200), body: z.string().max(20_000), imageUrl: optionalText(2000), imageAlt: optionalText(300), buttonLabel: optionalText(60), buttonUrl: optionalText(2000), position: z.number().int().min(0).optional() })
  .strict();
const issueBody = z
  .object({
    subject: z.string().trim().min(1).max(200).optional(),
    preheader: optionalText(200),
    subjectFromAi: z.boolean().optional(),
    // NWS-16: subject B, sample share (10-50%) and hours before picking the winner (1-48).
    subjectB: z.string().trim().max(200).nullable().optional().transform((value) => (value === '' ? null : value)),
    abSamplePercent: z.number().int().min(10).max(50).optional(),
    abWaitHours: z.number().int().min(1).max(48).optional(),
  })
  .strict();
const orderBody = z.object({ blockIds: z.array(z.uuid()).min(1).max(50) }).strict();
const swapBody = z.object({ removeItemId: z.uuid(), addItemId: z.uuid() }).strict();
const cadenceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    sendDay: z.number().int().min(1).max(28),
    sendHour: z.number().int().min(0).max(23),
    collectWorkingDays: z.number().int().min(1).max(15),
    languages: z.array(z.enum(LANGUAGES)).min(1).max(3),
    segments: z.partialRecord(z.enum(LANGUAGES), z.uuid()),
    templateId: z.uuid().nullable().optional(),
    active: z.boolean(),
  })
  .strict();

export function newsletterError(reply: FastifyReply, error: unknown) {
  if (error instanceof NewsletterError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid_field' ? 400 : 409;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

/** Newsletter schedule and issues (NWS-01 to NWS-03, NWS-06). Editors work on drafts; managers own the schedule. */
type NewsletterRoutesOptions = {
  newsletter: NewsletterService;
  editor: IssueEditor;
  publishing: NewsletterPublishing;
  ranking: NewsletterRanking;
  uploads: UploadService;
  seedList: string[];
  coreEngine: Pick<CoreEngineClient, 'verifyStaffToken'>;
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #FFDC00');
const templateBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    accentColor: hex,
    buttonTextColor: hex,
    backgroundColor: hex,
    textColor: hex,
    fontFamily: z.string().trim().min(1).max(200),
    logoUrl: z.string().max(2000).nullable(),
    headerText: z.string().trim().min(1).max(100),
    footerNote: z.string().max(500).nullable(),
  })
  .strict();
const rankingBody = z
  .object({
    weights: z.object({
      upcoming_event: z.number().min(0).max(1),
      recent_event: z.number().min(0).max(1),
      library: z.number().min(0).max(1),
      graduation: z.number().min(0).max(1),
      hire: z.number().min(0).max(1),
      new_group: z.number().min(0).max(1),
    }),
    halfLifeDays: z.number().min(1).max(120),
  })
  .strict();
const commentBody = z.object({ comment: z.string().trim().min(1).max(2000) }).strict();
const optionalCommentBody = z.object({ comment: z.string().trim().max(2000).nullable().optional() }).strict();
const approveBody = z.object({ comment: z.string().trim().max(2000).nullable().optional(), scheduledAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict();
const testBody = z.object({ emails: z.array(z.email()).max(20).optional() }).strict();

export async function newsletterRoutes(app: FastifyInstance, { newsletter, editor, publishing, ranking, uploads, seedList, coreEngine }: NewsletterRoutesOptions) {
  const canEdit = requireRole(coreEngine, ['editor', 'marketing_manager', 'admin']);
  const managers = requireRole(coreEngine, ['marketing_manager', 'admin']);
  const withId = (handler: (id: string, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    try {
      return await handler(params.data.id, request, reply);
    } catch (error) {
      return newsletterError(reply, error);
    }
  };

  app.get('/api/newsletter/cadences', { preHandler: canEdit }, async () => ({ cadences: await newsletter.cadences() }));
  app.post('/api/newsletter/cadences', { preHandler: managers }, async (request, reply) => {
    const body = cadenceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      const cadence = await newsletter.saveCadence(body.data);
      await newsletter.schedule();
      return reply.code(201).send(cadence);
    } catch (error) {
      return newsletterError(reply, error);
    }
  });
  app.put('/api/newsletter/cadences/:id', { preHandler: managers }, withId(async (id, request, reply) => {
    const body = cadenceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    const cadence = await newsletter.saveCadence(body.data, id);
    await newsletter.schedule();
    return cadence;
  }));

  app.get('/api/newsletter/issues', { preHandler: canEdit }, async () => ({ issues: await newsletter.list() }));
  // Blocks, AI text to review and skipped items per issue, for the Issues table (RESTRUCTURE R5).
  app.get('/api/newsletter/issues/overview', { preHandler: canEdit }, async () => ({ overview: await newsletter.overview() }));

  // Ranking of collected items (weight per type, half-life): editors see it, managers change it.
  app.get('/api/newsletter/ranking', { preHandler: canEdit }, async () => ({ ranking: await ranking.get(), types: ITEM_TYPES }));
  app.put('/api/newsletter/ranking', { preHandler: managers }, async (request, reply) => {
    const body = rankingBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message ?? 'Invalid request' });
    try {
      return { ranking: await ranking.save(body.data, request.staff!.userId), types: ITEM_TYPES };
    } catch (error) {
      if (error instanceof RankingError) return reply.code(400).send({ error: 'invalid_request', message: error.message });
      throw error;
    }
  });
  app.get('/api/newsletter/issues/:id', { preHandler: canEdit }, withId(async (id) => {
    const issue = await newsletter.require(id);
    const [blocks, items] = await Promise.all([newsletter.blocks(id), newsletter.items(issue)]);
    const used = new Set(blocks.flatMap((block) => block.itemIds));
    return { issue, blocks, items: items.map((item) => ({ ...item, used: used.has(item.id) })) };
  }));
  // Collect now instead of waiting for the scheduled moment, or redraft after sources changed.
  app.post('/api/newsletter/issues/:id/collect', { preHandler: canEdit }, withId(async (id) => newsletter.collectAndDraft(id)));

  const withBlock = (handler: (id: string, blockId: string, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const params = blockParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    try {
      return await handler(params.data.id, params.data.blockId, request, reply);
    } catch (error) {
      return newsletterError(reply, error);
    }
  };
  const invalid = (reply: FastifyReply, error: z.ZodError) => reply.code(400).send({ error: 'invalid_request', message: error.issues[0]?.message ?? 'Invalid request' });

  // Block editor (NWS-05) with the edit log (NWS-17).
  app.patch('/api/newsletter/issues/:id', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = issueBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const { subjectFromAi, ...changes } = body.data;
    return editor.updateIssue(id, changes, request.staff!.userId, { subjectFromAi });
  }));
  app.patch('/api/newsletter/issues/:id/blocks/:blockId', { preHandler: canEdit }, withBlock(async (id, blockId, request, reply) => {
    const body = blockBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const { acceptAi, ...changes } = body.data;
    return editor.updateBlock(id, blockId, changes, request.staff!.userId, { acceptAi });
  }));
  app.post('/api/newsletter/issues/:id/blocks', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = addBody.safeParse(request.body);
    return body.success ? reply.code(201).send(await editor.addBlock(id, body.data, request.staff!.userId)) : invalid(reply, body.error);
  }));
  app.delete('/api/newsletter/issues/:id/blocks/:blockId', { preHandler: canEdit }, withBlock(async (id, blockId, request, reply) => {
    await editor.removeBlock(id, blockId, request.staff!.userId);
    return reply.code(204).send();
  }));
  app.put('/api/newsletter/issues/:id/order', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = orderBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    await editor.reorder(id, body.data.blockIds, request.staff!.userId);
    return { ok: true };
  }));
  app.post('/api/newsletter/issues/:id/blocks/:blockId/swap', { preHandler: canEdit }, withBlock(async (id, blockId, request, reply) => {
    const body = swapBody.safeParse(request.body);
    return body.success ? editor.swapItem(id, blockId, body.data.removeItemId, body.data.addItemId, request.staff!.userId) : invalid(reply, body.error);
  }));
  // Templates (NWS-15): managers own the brand look.
  app.get('/api/newsletter/templates', { preHandler: canEdit }, async () => ({ templates: await publishing.templates() }));
  app.post('/api/newsletter/templates', { preHandler: managers }, async (request, reply) => {
    const body = templateBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    try {
      return reply.code(201).send(await publishing.saveTemplate(body.data, request.staff!.userId));
    } catch (error) {
      return newsletterError(reply, error);
    }
  });
  app.put('/api/newsletter/templates/:id', { preHandler: managers }, withId(async (id, request, reply) => {
    const body = templateBody.safeParse(request.body);
    return body.success ? publishing.saveTemplate(body.data, request.staff!.userId, id) : invalid(reply, body.error);
  }));

  // Preview, test send and pre-send checks (NWS-08, NWS-09).
  app.get('/api/newsletter/issues/:id/preview', { preHandler: canEdit }, withId(async (id) => publishing.preview(id)));
  app.get('/api/newsletter/issues/:id/checks', { preHandler: canEdit }, withId(async (id) => ({ checks: await publishing.checks(id) })));
  app.post('/api/newsletter/issues/:id/test', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = testBody.safeParse(request.body ?? {});
    const recipients = (body.success && body.data.emails?.length ? body.data.emails : null) ?? seedList;
    if (recipients.length === 0) return reply.code(400).send({ error: 'invalid_request', message: 'No seed list: set SEED_LIST or enter test addresses' });
    return publishing.testSend(id, recipients);
  }));

  // Review and approval with comments (NWS-10); approval schedules the send (NWS-11).
  app.get('/api/newsletter/issues/:id/comments', { preHandler: canEdit }, withId(async (id) => ({ comments: await publishing.comments(id) })));
  app.post('/api/newsletter/issues/:id/comments', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = commentBody.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    await publishing.comment(id, request.staff!.userId, body.data.comment);
    return reply.code(201).send({ ok: true });
  }));
  app.post('/api/newsletter/issues/:id/submit', { preHandler: canEdit }, withId(async (id, request, reply) => {
    const body = optionalCommentBody.safeParse(request.body ?? {});
    return body.success ? publishing.submit(id, request.staff!.userId, body.data.comment ?? null) : invalid(reply, body.error);
  }));
  app.post('/api/newsletter/issues/:id/request-changes', { preHandler: managers }, withId(async (id, request, reply) => {
    const body = commentBody.safeParse(request.body);
    return body.success ? publishing.requestChanges(id, request.staff!.userId, body.data.comment) : invalid(reply, body.error);
  }));
  app.post('/api/newsletter/issues/:id/approve', { preHandler: managers }, withId(async (id, request, reply) => {
    const body = approveBody.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error);
    return publishing.approve(id, request.staff!.userId, body.data.comment ?? null, body.data.scheduledAt ? new Date(body.data.scheduledAt) : null);
  }));
  app.post('/api/newsletter/issues/:id/unschedule', { preHandler: managers }, withId(async (id, request) => publishing.unschedule(id, request.staff!.userId)));

  // Issue report (NWS-13).
  app.get('/api/newsletter/issues/:id/report', { preHandler: canEdit }, withId(async (id) => publishing.report(id)));

  // Public archive (NWS-12): no session; stable URLs by slug.
  const archiveQuery = z.object({ language: z.enum(LANGUAGES).optional() });
  const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,40}$/) });
  app.get('/api/public/newsletter', async (request, reply) => {
    const query = archiveQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: 'language must be hy, en or ru' });
    return { issues: await publishing.archive(query.data.language) };
  });
  app.get('/api/public/newsletter/:slug', async (request, reply) => {
    const params = slugParams.safeParse(request.params);
    const issue = params.success ? await publishing.archived(params.data.slug) : null;
    return issue ? reply.header('cache-control', 'public, max-age=3600').send(issue) : reply.code(404).send({ error: 'not_found', message: 'Issue not found' });
  });

  // NWS-07: AI writing assist; answers 503 when no API key is configured or the AI service fails.
  app.get('/api/newsletter/ai', { preHandler: canEdit }, async () => ({ enabled: editor.aiEnabled }));
  app.post('/api/newsletter/issues/:id/ai-draft', { preHandler: canEdit }, withId(async (id, request, reply) => {
    try {
      return await editor.aiDraft(id, request.staff!.userId);
    } catch (error) {
      if (error instanceof AssistUnavailableError) return reply.code(503).send({ error: 'ai_unavailable', message: error.message });
      throw error;
    }
  }));
  app.get('/api/newsletter/issues/:id/edits', { preHandler: canEdit }, withId(async (id) => ({ edits: await editor.edits(id) })));

  // Images for blocks (NWS-05): uploaded by staff, served publicly for email clients.
  app.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 + 1 }, (_request, body, done) => done(null, body));
    scoped.post('/api/uploads/images', { preHandler: canEdit }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'invalid_request', message: 'Upload the image as the request body' });
      try {
        return reply.code(201).send(await uploads.saveImage(request.body, request.staff!.userId));
      } catch (error) {
        if (error instanceof UploadError) return reply.code(400).send({ error: 'invalid_image', message: error.message });
        throw error;
      }
    });
  });
  app.get('/api/public/images/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const image = params.success ? await uploads.get(params.data.id) : null;
    if (!image) return reply.code(404).send({ error: 'not_found', message: 'Image not found' });
    return reply
      .header('content-type', image.contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('etag', `"${image.sha256}"`)
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(image.bytes);
  });
}
