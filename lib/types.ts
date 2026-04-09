export interface NewsletterEvent {
  event_name: string;
  date: string;
  day: string;
  time: string;
  venue: string;
  address: string;
  category: string;
  cost: string;
  free: boolean;
  description: string;
  source_site: string;
  event_url: string;
  engagement_score: number;
  flags?: string;
}

export type SSEEvent =
  | { type: 'progress'; message: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; preview: string }
  | { type: 'complete'; events: NewsletterEvent[]; top3: NewsletterEvent[]; csvContent: string }
  | { type: 'error'; message: string };

export interface LogEntry {
  id: number;
  kind: 'progress' | 'tool_call' | 'tool_result' | 'error';
  message: string;
  timestamp: string;
}

export interface FormattingOptions {
  tone: 'casual' | 'energetic' | 'dry';
  descLength: 'brief' | 'standard' | 'detailed';
  customInstructions: string;
}
