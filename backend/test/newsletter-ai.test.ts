import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeWritingAssistant, type AssistInput, type WritingAssistant } from '../src/ai/writing-assistant.js';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
afterEach(() => app?.close());

const fake: WritingAssistant & { calls: AssistInput[] } = {
  enabled: true,
  calls: [],
  async draft(input) {
    this.calls.push(input);
    return { summaries: input.blocks.map((block) => ({ blockId: block.id, text: `Intro for ${block.title}` })), subjectLines: ['Open day, new groups and a graduation', 'Option two', 'Option three'] };
  },
};

async function draftedIssue(assistant?: WritingAssistant) {
  app = await buildTestApp(assistant ? { writingAssistant: assistant } : {});
  await app.newsletter.saveCadence({ name: 'Monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['hy'], segments: {}, active: true });
  await app.newsletter.schedule();
  const issue = (await app.newsletter.list())[0]!;
  await app.newsletter.collectAndDraft(issue.id);
  return issue.id;
}

describe('AI writing assist (NWS-07)', () => {
  it('drafts block intros from collected facts, marks them and logs them until a person accepts', async () => {
    const issueId = await draftedIssue(fake);
    expect((await app.inject({ method: 'GET', url: '/api/newsletter/ai', headers: bearer('editor') })).json()).toEqual({ enabled: true });
    const response = await app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/ai-draft`, headers: bearer('editor') });
    expect(response.json()).toMatchObject({ subjectLines: expect.arrayContaining(['Open day, new groups and a graduation']) });
    expect(fake.calls.at(-1)).toMatchObject({ language: 'hy' });
    expect(fake.calls.at(-1)!.blocks.every((block) => block.facts.length > 0)).toBe(true);
    // Only public facts go to the AI: no one named without feature consent.
    expect(JSON.stringify(fake.calls.at(-1))).not.toContain('Maria');

    const blocks = await app.newsletter.blocks(issueId);
    const drafted = blocks.filter((block) => block.aiDrafted);
    expect(drafted.length).toBe(response.json().blocks);
    expect(drafted[0]!.body).toMatch(/^Intro for /);

    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}/blocks/${drafted[0]!.id}`, headers: bearer('editor'), payload: { acceptAi: true } });
    expect((await app.newsletter.blocks(issueId)).find((block) => block.id === drafted[0]!.id)?.aiDrafted).toBe(false);

    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'Option two', subjectFromAi: true } });
    expect(await app.newsletter.require(issueId)).toMatchObject({ subject: 'Option two', subjectAiDrafted: true });
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'My own subject' } });
    expect((await app.newsletter.require(issueId)).subjectAiDrafted).toBe(false);

    const log = (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/edits`, headers: bearer('editor') })).json().edits;
    expect(log.some((edit: { action: string }) => edit.action === 'ai_draft')).toBe(true);
  });

  it('is visibly off without an API key', async () => {
    const issueId = await draftedIssue();
    expect((await app.inject({ method: 'GET', url: '/api/newsletter/ai', headers: bearer('editor') })).json()).toEqual({ enabled: false });
    const response = await app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/ai-draft`, headers: bearer('editor') });
    expect(response.statusCode).toBe(503);
    expect(response.json().message).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('Claude writing assistant', () => {
  const input: AssistInput = { language: 'en', edition: 'December 2026', blocks: [{ id: 'b1', type: 'library', title: 'New in the Library', facts: ['Git branching'] }] };
  const withResponse = (response: unknown, seen: unknown[] = []) =>
    new ClaudeWritingAssistant({
      apiKey: 'test',
      model: 'claude-opus-5-5',
      client: { beta: { messages: { parse: async (params: unknown) => (seen.push(params), response) } } } as unknown as Anthropic,
    });

  it('sends the facts with fallbacks on and returns the parsed output for known blocks only', async () => {
    const seen: unknown[] = [];
    const result = await withResponse(
      { stop_reason: 'end_turn', parsed_output: { summaries: [{ blockId: 'b1', text: ' New guides this month. ' }, { blockId: 'zz', text: 'x' }], subjectLines: ['A', 'B', 'C', 'D'] } },
      seen,
    ).draft(input);
    expect(result).toEqual({ summaries: [{ blockId: 'b1', text: 'New guides this month.' }], subjectLines: ['A', 'B', 'C'] });
    expect(seen[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
  });

  it('turns a refusal or an unreadable answer into a clear message', async () => {
    await expect(withResponse({ stop_reason: 'refusal', parsed_output: null }).draft(input)).rejects.toThrow(/declined/);
    await expect(withResponse({ stop_reason: 'end_turn', parsed_output: null }).draft(input)).rejects.toThrow(/could not be read/);
  });
});
