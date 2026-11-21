import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import type { Language } from '../integrations/core-engine/contract.js';

export type AssistInput = {
  language: Language;
  /** e.g. "December 2026" */
  edition: string;
  blocks: { id: string; type: string; title: string; facts: string[] }[];
};

export type AssistOutput = {
  summaries: { blockId: string; text: string }[];
  /** Three options, each under 70 characters (NWS-09). */
  subjectLines: string[];
};

export class AssistUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistUnavailableError';
  }
}

/** NWS-07: drafts short block summaries and subject line options from the collected items. */
export interface WritingAssistant {
  readonly enabled: boolean;
  draft(input: AssistInput): Promise<AssistOutput>;
}

/** Used when no API key is configured: the feature is visibly off, nothing else changes. */
export class DisabledWritingAssistant implements WritingAssistant {
  readonly enabled = false;

  async draft(): Promise<AssistOutput> {
    throw new AssistUnavailableError('AI writing assist is off: set ANTHROPIC_API_KEY to turn it on');
  }
}

const LANGUAGE_NAME: Record<Language, string> = { hy: 'Armenian', en: 'English', ru: 'Russian' };

const OutputSchema = z.object({
  summaries: z.array(z.object({ blockId: z.string(), text: z.string() })),
  subjectLines: z.array(z.string()),
});

const SYSTEM = `You write the Picsart Academy newsletter: a coding and design school in Yerevan writing to its students, graduates and people interested in its courses.

You receive the blocks of one issue, each with the facts collected for it. For each block, write one or two short, warm sentences that introduce the block to readers. Then write three subject line options for the whole issue.

Rules:
- Use only the facts given. Do not invent dates, numbers, places, people or quotes. If a block has little to say, keep its sentence plain.
- Name only people who already appear in the facts.
- Write in the language requested, natural for native readers. Armenian uses Armenian script.
- Subject lines: under 70 characters, specific to this issue, no clickbait, no all-caps, no emoji.
- Return a summary for every block ID you were given, and exactly three subject lines.`;

/**
 * Claude-backed writing assist (NWS-07). Only public facts from the collected items are sent (titles,
 * dates, course names, and graduates who agreed to be featured). Everything it returns is marked as
 * AI-drafted until a person edits or accepts it (R11).
 */
export class ClaudeWritingAssistant implements WritingAssistant {
  readonly enabled = true;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string; client?: Anthropic }) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 120_000 });
    this.model = options.model;
  }

  async draft(input: AssistInput): Promise<AssistOutput> {
    const blocks = input.blocks.map((block) => ({ blockId: block.id, type: block.type, title: block.title, facts: block.facts }));
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        // A policy decline on the main model is retried on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(OutputSchema) },
        messages: [
          {
            role: 'user',
            content: `Language: ${LANGUAGE_NAME[input.language]}\nIssue: ${input.edition}\n\nBlocks (JSON):\n${JSON.stringify(blocks, null, 2)}`,
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new AssistUnavailableError('The AI API key was rejected; check ANTHROPIC_API_KEY');
      if (error instanceof Anthropic.RateLimitError) throw new AssistUnavailableError('The AI service is busy; try again in a minute');
      if (error instanceof Anthropic.APIConnectionError) throw new AssistUnavailableError('The AI service is not reachable right now');
      if (error instanceof Anthropic.APIError) throw new AssistUnavailableError(`The AI service answered ${error.status}; try again later`);
      throw error;
    }
    if (response.stop_reason === 'refusal') throw new AssistUnavailableError('The AI declined to draft this issue; write it by hand');
    const parsed = response.parsed_output;
    if (!parsed) throw new AssistUnavailableError('The AI answer could not be read; try again');
    const known = new Set(input.blocks.map((block) => block.id));
    return {
      summaries: parsed.summaries.filter((summary) => known.has(summary.blockId) && summary.text.trim()).map((summary) => ({ blockId: summary.blockId, text: summary.text.trim() })),
      subjectLines: parsed.subjectLines.map((line) => line.trim()).filter(Boolean).slice(0, 3),
    };
  }
}

export function createWritingAssistant(config: { anthropicApiKey: string | null; aiModel: string }): WritingAssistant {
  return config.anthropicApiKey ? new ClaudeWritingAssistant({ apiKey: config.anthropicApiKey, model: config.aiModel }) : new DisabledWritingAssistant();
}
