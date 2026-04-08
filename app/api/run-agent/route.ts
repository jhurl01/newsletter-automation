import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { webFetch, webSearch } from '@/lib/tools';
import { generateCsv } from '@/lib/csv';
import type { SSEEvent, NewsletterEvent } from '@/lib/types';

export const maxDuration = 300; // 5 minutes

const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'web_fetch',
    description:
      'Fetch content from a URL. Returns the HTML/text content of the page (truncated to 20,000 chars). Use this for direct-fetch sources. If the page returns only navigation/shell content without event data, note it and move on.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the web using Brave Search. Returns titles, URLs, and snippets for up to 10 results. Use for sources that require search (Eventbrite, SeatGeek, Songkick) and for event verification.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
];

function buildSystemPrompt(
  startDate: string,
  endDate: string,
  sendDate: string,
  csvContent: string
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const start = new Date(startDate + 'T12:00:00');
  const monthName = start.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const monthAbbr = start.toLocaleString('en-US', { month: 'long' });
  const year = start.getFullYear();

  return `You are a Louisville event researcher for the LouPlug newsletter. Today is ${today}.
Newsletter week: ${startDate} through ${endDate}. Newsletter send date: ${sendDate} at 10:00 AM Sunday.

Your job is to find, verify, score, and format Louisville events happening during ${startDate}–${endDate}.

## Event Sources (CSV)
${csvContent}

## Instructions — Follow These Steps In Order

### Step 1: GoToLouisville Blog (Highest-yield — do this FIRST)
Always fetch this URL — it is the most reliable single source:
https://www.gotolouisville.com/blog/top-events-happening-in-louisville-this-${monthName}/

### Step 2: Direct Fetches
For each source with fetch_method=direct_fetch or direct_fetch_partial, call web_fetch on the URL.
Replace [month] in any URL with "${monthName}".
If a page returns only navigation/shell content with no actual event data, note it briefly and move on. Do not retry.
Sources that often work well via direct fetch:
- louisvilledowntown.org/all-events/ — chronological list
- loutoday.6amcity.com/events — partial render
- milb.com/louisville — Bats schedule
- kdf.org/events/ — Derby Festival
- leoweekly.com/events/ — arts/culture

Sources that require login (skip direct fetch, just note):
- nextdoor.com — login required
- facebook.com/events — login required

### Step 3: Web Searches
For sources with fetch_method=web_search, and to fill gaps, run these searches:
1. "Louisville KY events ${startDate} ${endDate} ${year}"
2. "Louisville ${monthAbbr} ${year} festival food outdoor family"
3. "site:eventbrite.com Louisville events ${monthAbbr} ${year}"
4. "site:gotolouisville.com Louisville events ${monthAbbr} ${year}"
5. "Louisville KY ${monthAbbr} ${year} things to do NOT concert"
6. "Louisville ${monthAbbr} ${year} site:seatgeek.com"
7. "Louisville ${monthAbbr} ${year} site:songkick.com"

### Step 4: Verify Individual Events
For each promising event found, run a targeted search to confirm:
- Exact date and day of week (critical — reject if date falls outside ${startDate}–${endDate})
- Exact time and door time if relevant
- Venue name and full street address
- Ticket price or "Free"
- Any special details (giveaways, guest performers, etc.)

### Step 5: Score Each Event (1–10)
Scoring criteria:
+ Broad appeal — multiple demographics welcome
+ Louisville-proud — uniquely local, Derby-adjacent, hyper-Louisville
+ Actionable — reader can attend after the 10 AM Sunday send on ${sendDate}
+ Visual/shareable — Instagram-worthy moment
- Category stacking — penalize if similar events already ranked higher
- Timing conflict — if event is on ${sendDate} and starts before 10 AM, flag or exclude

### Step 6: Filter
Target 8–10 events scoring 6–10. Skip recurring weekly events (trivia nights, yoga classes, etc.).

### Step 7: Top 3 Diversity Rules
The final top 3 MUST follow:
- Maximum 1 concert/live music event
- At least 1 free or low-cost event
- At least 1 non-music/non-nightlife event (food, outdoor, sports, art, family, community)
If two of the top 3 are concerts, replace the lower-scoring one with the next best non-concert event.

### Step 8: Flags
Apply these flags where appropriate:
- "unconfirmed" — sourced from only one site and date couldn't be verified from a second source
- "timing-conflict" — event on ${sendDate} starting before 10 AM

### Notes on Sources That Won't Work
- Nextdoor: login required, cannot scrape
- Facebook Events: login required, cannot scrape
- SeatGeek: 403 blocks direct fetch — use web search instead
- Songkick: use web search instead

## Output Format

After completing all research, output your final analysis followed by a JSON block in this EXACT format.
The JSON must be valid and parseable. Do NOT truncate it.

\`\`\`json
{
  "events": [
    {
      "event_name": "Full Event Name",
      "date": "April 12, 2026",
      "day": "Sunday",
      "time": "2:00 PM",
      "venue": "Venue Name",
      "address": "123 Main St, Louisville, KY 40202",
      "category": "Music",
      "cost": "$15",
      "free": false,
      "description": "2-4 sentences. Factual. Casual Louisville-proud voice. No fluff.",
      "source_site": "gotolouisville.com",
      "event_url": "https://example.com/event",
      "engagement_score": 8,
      "flags": ""
    }
  ],
  "top3": [
    // exactly 3 events from the events array, categorically diverse per the rules above
  ]
}
\`\`\`

IMPORTANT:
- Only include events that fall within ${startDate}–${endDate}
- The JSON block must appear at the very END of your response
- "top3" must have EXACTLY 3 items
- All fields are required (use empty string "" if unknown, not null)
- "free" must be a boolean true/false
- "engagement_score" must be a number 1–10`;
}

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  evt: SSEEvent
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
}

function extractJsonFromText(text: string): { events: NewsletterEvent[]; top3: NewsletterEvent[] } | null {
  // Look for ```json ... ``` block
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (Array.isArray(parsed.events) && Array.isArray(parsed.top3)) {
      return parsed as { events: NewsletterEvent[]; top3: NewsletterEvent[] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { startDate, endDate, sendDate } = await req.json();

  if (!startDate || !endDate || !sendDate) {
    return new Response(JSON.stringify({ error: 'Missing dates' }), { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: SSEEvent) => sendSSE(controller, encoder, evt);

      try {
        // Load CSV
        const csvPath = path.join(process.cwd(), 'data', 'louisville_event_sources.csv');
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        send({ type: 'progress', message: `Loaded event sources CSV (${csvContent.split('\n').length - 1} sources)` });

        const systemPrompt = buildSystemPrompt(startDate, endDate, sendDate, csvContent);
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const messages: Anthropic.MessageParam[] = [
          {
            role: 'user',
            content: `Find Louisville events for the newsletter week of ${startDate} through ${endDate}. Follow all steps in your instructions. Be thorough — run all the searches and fetches described.`,
          },
        ];

        send({ type: 'progress', message: 'Starting agent...' });

        let iterations = 0;
        const MAX_ITERATIONS = 40;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8192,
            system: systemPrompt,
            tools: TOOL_DEFS,
            messages,
          });

          // Append assistant message
          messages.push({ role: 'assistant', content: response.content });

          if (response.stop_reason === 'end_turn') {
            // Extract final text
            const textBlock = response.content.find((b) => b.type === 'text');
            const finalText = textBlock?.type === 'text' ? textBlock.text : '';

            send({ type: 'progress', message: 'Agent completed. Parsing results...' });

            const parsed = extractJsonFromText(finalText);
            if (!parsed) {
              send({
                type: 'error',
                message: 'Could not parse events JSON from agent response. The agent may not have output a valid JSON block.',
              });
              controller.close();
              return;
            }

            const csvOutput = generateCsv(parsed.events);
            send({
              type: 'complete',
              events: parsed.events,
              top3: parsed.top3,
              csvContent: csvOutput,
            });
            controller.close();
            return;
          }

          if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
            );

            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of toolUseBlocks) {
              const input = block.input as Record<string, string>;
              send({
                type: 'tool_call',
                tool: block.name,
                input: input,
              });

              let result: string;
              if (block.name === 'web_fetch') {
                result = await webFetch(input.url);
              } else if (block.name === 'web_search') {
                result = await webSearch(input.query);
              } else {
                result = `ERROR: Unknown tool: ${block.name}`;
              }

              // Send a preview (first 200 chars)
              const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
              send({ type: 'tool_result', tool: block.name, preview });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
              });
            }

            messages.push({ role: 'user', content: toolResults });
            continue;
          }

          // Unexpected stop reason
          send({
            type: 'error',
            message: `Unexpected stop reason: ${response.stop_reason}`,
          });
          break;
        }

        if (iterations >= MAX_ITERATIONS) {
          send({ type: 'error', message: 'Agent exceeded maximum iterations (40).' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendSSE(controller, encoder, { type: 'error', message: msg });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
