import Papa from 'papaparse';
import type { NewsletterEvent } from './types';

const COLUMNS: (keyof NewsletterEvent)[] = [
  'event_name',
  'date',
  'day',
  'time',
  'venue',
  'address',
  'category',
  'cost',
  'free',
  'description',
  'source_site',
  'event_url',
  'engagement_score',
];

export function generateCsv(events: NewsletterEvent[]): string {
  const rows = events.map((e) => COLUMNS.map((col) => e[col] ?? ''));
  return Papa.unparse({ fields: COLUMNS, data: rows });
}

export function getCsvFilename(startDate: string, endDate: string): string {
  const fmt = (d: string) => {
    const date = new Date(d + 'T12:00:00');
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${month}${day}`;
  };

  const year = new Date(startDate + 'T12:00:00').getFullYear();
  return `LouPlug_Events_${fmt(startDate)}_${fmt(endDate)}_${year}.csv`;
}
