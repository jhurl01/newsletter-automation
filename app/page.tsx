'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { NewsletterEvent, LogEntry, SSEEvent } from '@/lib/types';
import { getCsvFilename } from '@/lib/csv';

let logIdCounter = 0;

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8
      ? 'text-green-400'
      : score >= 6
      ? 'text-yellow-400'
      : 'text-zinc-500';
  return <span className={`font-bold ${color}`}>{score}</span>;
}

function FlagBadge({ flags }: { flags?: string }) {
  if (!flags) return null;
  const parts = flags.split(',').map((f) => f.trim()).filter(Boolean);
  return (
    <span className="flex gap-1 flex-wrap">
      {parts.map((f) => (
        <span
          key={f}
          className={`text-xs px-1 rounded ${
            f === 'timing-conflict'
              ? 'bg-orange-900 text-orange-300'
              : 'bg-yellow-900 text-yellow-300'
          }`}
        >
          {f}
        </span>
      ))}
    </span>
  );
}

export default function Home() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sendDate, setSendDate] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<NewsletterEvent[]>([]);
  const [top3, setTop3] = useState<NewsletterEvent[]>([]);
  const [csvContent, setCsvContent] = useState('');
  const [sortKey, setSortKey] = useState<'engagement_score' | 'date'>('engagement_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const addLog = useCallback((kind: LogEntry['kind'], message: string) => {
    setLog((prev) => [
      ...prev,
      { id: logIdCounter++, kind, message, timestamp: formatTime() },
    ]);
  }, []);

  const handleRun = useCallback(async () => {
    if (!startDate || !endDate || !sendDate) {
      setError('Please fill in all three dates.');
      return;
    }
    setError('');
    setIsRunning(true);
    setLog([]);
    setEvents([]);
    setTop3([]);
    setCsvContent('');

    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, sendDate }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        setError(`Request failed: ${text}`);
        setIsRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);
          let evt: SSEEvent;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }

          if (evt.type === 'progress') {
            addLog('progress', evt.message);
          } else if (evt.type === 'tool_call') {
            const inputStr =
              typeof evt.input === 'object'
                ? Object.values(evt.input).join(' ')
                : String(evt.input);
            addLog('tool_call', `[${evt.tool}] ${inputStr}`);
          } else if (evt.type === 'tool_result') {
            addLog('tool_result', `[${evt.tool}] ${evt.preview}`);
          } else if (evt.type === 'complete') {
            setEvents(evt.events ?? []);
            setTop3(evt.top3 ?? []);
            setCsvContent(evt.csvContent ?? '');
            addLog('progress', `Done. ${evt.events?.length ?? 0} events found.`);
          } else if (evt.type === 'error') {
            setError(evt.message);
            addLog('error', evt.message);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog('error', msg);
    } finally {
      setIsRunning(false);
    }
  }, [startDate, endDate, sendDate, addLog]);

  const handleDownload = useCallback(() => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getCsvFilename(startDate, endDate);
    a.click();
    URL.revokeObjectURL(url);
  }, [csvContent, startDate, endDate]);

  const sortedEvents = [...events].sort((a, b) => {
    if (sortKey === 'engagement_score') {
      return sortDir === 'desc'
        ? b.engagement_score - a.engagement_score
        : a.engagement_score - b.engagement_score;
    }
    return sortDir === 'desc'
      ? b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date);
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const logPrefix = (kind: LogEntry['kind']) => {
    if (kind === 'tool_call') return '→';
    if (kind === 'tool_result') return '←';
    if (kind === 'error') return '!';
    return '>';
  };

  const logColor = (kind: LogEntry['kind']) => {
    if (kind === 'tool_call') return 'text-blue-400';
    if (kind === 'tool_result') return 'text-zinc-400';
    if (kind === 'error') return 'text-red-400';
    return 'text-green-400';
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 border-b border-zinc-800 pb-4">
        <h1 className="text-lg font-bold tracking-widest text-white uppercase">
          LouPlug Event Finder
        </h1>
        <p className="text-xs text-zinc-500 mt-1">
          Louisville newsletter automation · Phase 1
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">
            Week Start
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={isRunning}
            className="bg-zinc-900 border border-zinc-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">
            Week End
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={isRunning}
            className="bg-zinc-900 border border-zinc-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">
            Send Date
          </label>
          <input
            type="date"
            value={sendDate}
            onChange={(e) => setSendDate(e.target.value)}
            disabled={isRunning}
            className="bg-zinc-900 border border-zinc-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="px-5 py-2 bg-white text-black text-sm font-bold rounded hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Running...
            </span>
          ) : (
            'Find Events'
          )}
        </button>
        {csvContent && (
          <button
            onClick={handleDownload}
            className="px-5 py-2 bg-zinc-800 text-white text-sm rounded hover:bg-zinc-700 border border-zinc-600 transition-colors"
          >
            Download CSV
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-950 border border-red-800 text-red-300 text-sm rounded">
          {error}
        </div>
      )}

      {/* Progress Log */}
      {log.length > 0 && (
        <div className="mb-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Agent Log ({log.length} entries)
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded p-3 h-64 overflow-y-auto text-xs leading-5">
            {log.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">{entry.timestamp}</span>
                <span className={`shrink-0 ${logColor(entry.kind)}`}>
                  {logPrefix(entry.kind)}
                </span>
                <span
                  className={
                    entry.kind === 'error'
                      ? 'text-red-400'
                      : entry.kind === 'tool_result'
                      ? 'text-zinc-400'
                      : 'text-zinc-200'
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Events Table */}
      {sortedEvents.length > 0 && (
        <div className="mb-8">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            All Events ({sortedEvents.length})
          </div>
          <div className="overflow-x-auto border border-zinc-800 rounded">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2 font-normal">Event</th>
                  <th
                    className="px-3 py-2 font-normal cursor-pointer hover:text-white select-none whitespace-nowrap"
                    onClick={() => toggleSort('date')}
                  >
                    Date {sortKey === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                  </th>
                  <th className="px-3 py-2 font-normal">Day</th>
                  <th className="px-3 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Category</th>
                  <th className="px-3 py-2 font-normal">Cost</th>
                  <th className="px-3 py-2 font-normal">Venue</th>
                  <th
                    className="px-3 py-2 font-normal cursor-pointer hover:text-white select-none whitespace-nowrap"
                    onClick={() => toggleSort('engagement_score')}
                  >
                    Score{' '}
                    {sortKey === 'engagement_score'
                      ? sortDir === 'desc'
                        ? '↓'
                        : '↑'
                      : '↕'}
                  </th>
                  <th className="px-3 py-2 font-normal">Flags</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.map((ev, i) => (
                  <tr
                    key={i}
                    className="border-t border-zinc-800 hover:bg-zinc-900 transition-colors"
                  >
                    <td className="px-3 py-2 max-w-xs">
                      {ev.event_url ? (
                        <a
                          href={ev.event_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          {ev.event_name}
                        </a>
                      ) : (
                        ev.event_name
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-300">
                      {ev.date}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">
                      {ev.day}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">
                      {ev.time}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-300">
                        {ev.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {ev.free ? (
                        <span className="text-green-400">Free</span>
                      ) : (
                        <span className="text-zinc-300">{ev.cost}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-400 max-w-[12rem] truncate">
                      {ev.venue}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ScoreBadge score={ev.engagement_score} />
                    </td>
                    <td className="px-3 py-2">
                      <FlagBadge flags={ev.flags} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top 3 Newsletter Format */}
      {top3.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
            Top 3 for Newsletter
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {top3.map((ev, i) => (
              <div
                key={i}
                className="border border-zinc-700 rounded p-4 bg-zinc-950 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-zinc-600 font-bold">#{i + 1}</span>
                  <ScoreBadge score={ev.engagement_score} />
                </div>
                <div className="font-bold text-sm text-white leading-snug">
                  {ev.event_name}
                </div>
                <div className="text-xs text-zinc-400 space-y-0.5">
                  <div>
                    <span className="text-zinc-500">When: </span>
                    {ev.day}, {ev.date} · {ev.time}
                  </div>
                  <div>
                    <span className="text-zinc-500">Where: </span>
                    {ev.venue}
                    {ev.address ? `, ${ev.address}` : ''}
                  </div>
                  <div>
                    <span className="text-zinc-500">Cost: </span>
                    {ev.free ? (
                      <span className="text-green-400">Free</span>
                    ) : (
                      ev.cost
                    )}
                  </div>
                  <div>
                    <span className="text-zinc-500">Category: </span>
                    {ev.category}
                  </div>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed border-t border-zinc-800 pt-2 mt-1">
                  {ev.description}
                </p>
                {ev.event_url && (
                  <a
                    href={ev.event_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline truncate mt-auto"
                  >
                    {ev.event_url}
                  </a>
                )}
                {ev.flags && <FlagBadge flags={ev.flags} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
