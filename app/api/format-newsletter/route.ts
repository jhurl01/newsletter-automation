import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { NewsletterEvent, FormattingOptions } from '@/lib/types';

function stripEmDashes(text: string): string {
  // Replace em dash (U+2014) with a comma, cleaning up surrounding whitespace
  return text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\u2014/g, ', ')
    .replace(/&mdash;/g, ', ');
}

const TONE_DESCRIPTIONS: Record<FormattingOptions['tone'], string> = {
  casual:
    'Write like you are texting a Louisville friend about something cool to do this week. Use "you" and "y\'all." Contractions are fine. Show local pride without being over the top.',
  energetic:
    'High energy. Get the reader hyped about showing up. Short punchy sentences. Exclamations are okay if they are earned. Make it feel like something worth leaving the house for.',
  dry:
    'Just the facts, cleanly presented. Minimal adjectives. No hype language. Short declarative sentences. Let the event speak for itself.',
};

const LENGTH_DESCRIPTIONS: Record<FormattingOptions['descLength'], string> = {
  brief: '2 sentences maximum. Be tight.',
  standard: '2 to 3 sentences.',
  detailed: '3 to 4 sentences. Add context or a detail that makes the event feel worth attending.',
};

function buildFormatPrompt(options: FormattingOptions): string {
  const custom = options.customInstructions.trim();
  return `You are writing newsletter content for the LouPlug Louisville events newsletter.

MANDATORY RULE — NEVER VIOLATE:
Do NOT use em dashes (—). This is a hard rule. No exceptions.
Do not use double-hyphens (--) as a substitute for em dashes.
Use commas, periods, colons, or parentheses instead.

TONE: ${TONE_DESCRIPTIONS[options.tone]}

DESCRIPTION LENGTH: ${LENGTH_DESCRIPTIONS[options.descLength]}
${custom ? `\nADDITIONAL INSTRUCTIONS:\n${custom}\n` : ''}
You will receive data for 3 events. For each event, write a newsletter blurb using EXACTLY this markdown structure:

**{event_name}**
{day}, {date} at {time}
{venue}, {address}
{cost_line}

{description}

{event_url}

Separate each event with a line containing only three dashes: ---

Rules:
- Use the exact event name, date, time, venue, address, and URL as provided. Do not alter them.
- Write fresh descriptions based on the event data. Do not copy the provided description verbatim.
- Stay factual. Do not invent details not present in the data.
- For cost_line: write "Free" if the event is free, otherwise use the exact cost string provided.
- If the event_url is empty, omit that line.
- Output only the 3 event blurbs with --- separators. No intro, no outro, no additional commentary.`;
}

function eventToText(ev: NewsletterEvent, index: number): string {
  return `EVENT ${index + 1}:
event_name: ${ev.event_name}
date: ${ev.date}
day: ${ev.day}
time: ${ev.time}
venue: ${ev.venue}
address: ${ev.address}
category: ${ev.category}
cost: ${ev.cost}
free: ${ev.free}
description: ${ev.description}
event_url: ${ev.event_url}
source_site: ${ev.source_site}`;
}

export async function POST(req: NextRequest) {
  const { events, options, startDate, endDate } = (await req.json()) as {
    events: NewsletterEvent[];
    options: FormattingOptions;
    startDate: string;
    endDate: string;
  };

  if (!events || events.length !== 3) {
    return NextResponse.json({ error: 'Exactly 3 events required' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMessage = [
    `Format these 3 events for the LouPlug newsletter covering ${startDate} through ${endDate}.\n`,
    ...events.map((ev, i) => eventToText(ev, i)),
  ].join('\n\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: buildFormatPrompt(options),
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const markdown = stripEmDashes(raw.trim());

    return NextResponse.json({ markdown });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
