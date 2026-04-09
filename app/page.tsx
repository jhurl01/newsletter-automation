'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { NewsletterEvent, LogEntry, SSEEvent, FormattingOptions } from '@/lib/types';
import { getCsvFilename, getMdFilename } from '@/lib/csv';

let logIdCounter = 0;

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function eventKey(ev: NewsletterEvent): string {
  return `${ev.event_name}::${ev.date}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? 'text-green-400' : score >= 6 ? 'text-yellow-400' : 'text-zinc-500';
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

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-xs border transition-colors first:rounded-l last:rounded-r ${
            value === opt.value
              ? 'bg-white text-black border-white'
              : 'bg-transparent text-zinc-400 border-zinc-600 hover:border-zinc-400 hover:text-zinc-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  // Phase 1: dates
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sendDate, setSendDate] = useState('');

  // Phase 2: research agent
  const [isRunning, setIsRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');

  // Phase 3: results
  const [events, setEvents] = useState<NewsletterEvent[]>([]);
  const [csvContent, setCsvContent] = useState('');
  const [sortKey, setSortKey] = useState<'engagement_score' | 'date'>('engagement_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Phase 3b: manual selection (max 3)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Phase 4: formatting options
  const [tone, setTone] = useState<FormattingOptions['tone']>('casual');
  const [descLength, setDescLength] = useState<FormattingOptions['descLength']>('standard');
  const [customInstructions, setCustomInstructions] = useState('');

  // Phase 5: formatted output
  const [isFormatting, setIsFormatting] = useState(false);
  const [markdownOutput, setMarkdownOutput] = useState('');
  const [copied, setCopied] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const addLog = useCallback((kind: LogEntry['kind'], message: string) => {
    setLog((prev) => [
      ...prev,
      { id: logIdCounter++, kind, message, timestamp: formatTime() },
    ]);
  }, []);

  // ── Research agent ──────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!startDate || !endDate || !sendDate) {
      setError('Please fill in all three dates.');
      return;
    }
    setError('');
    setIsRunning(true);
    setLog([]);
    setEvents([]);
    setCsvContent('');
    setSelectedKeys(new Set());
    setMarkdownOutput('');

    try {
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, sendDate }),
      });

      if (!res.ok || !res.body) {
        setError(`Request failed: ${await res.text()}`);
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
          let evt: SSEEvent;
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (evt.type === 'progress') {
            addLog('progress', evt.message);
          } else if (evt.type === 'tool_call') {
            addLog('tool_call', `[${evt.tool}] ${Object.values(evt.input).join(' ')}`);
          } else if (evt.type === 'tool_result') {
            addLog('tool_result', `[${evt.tool}] ${evt.preview}`);
          } else if (evt.type === 'complete') {
            setEvents(evt.events ?? []);
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

  // ── Event selection ─────────────────────────────────────────────────────────

  const handleToggleSelect = useCallback(
    (ev: NewsletterEvent) => {
      const key = eventKey(ev);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else if (next.size < 3) {
          next.add(key);
        }
        return next;
      });
      setMarkdownOutput('');
    },
    []
  );

  // ── Format newsletter ────────────────────────────────────────────────────────

  const selectedEvents = events.filter((e) => selectedKeys.has(eventKey(e)));

  const handleFormatNewsletter = useCallback(async () => {
    if (selectedEvents.length !== 3) return;
    setIsFormatting(true);
    setMarkdownOutput('');
    setError('');
    try {
      const res = await fetch('/api/format-newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: selectedEvents,
          options: { tone, descLength, customInstructions },
          startDate,
          endDate,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMarkdownOutput(data.markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFormatting(false);
    }
  }, [selectedEvents, tone, descLength, customInstructions, startDate, endDate]);

  // ── Downloads / copy ─────────────────────────────────────────────────────────

  const handleDownloadCsv = useCallback(() => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getCsvFilename(startDate, endDate);
    a.click();
    URL.revokeObjectURL(url);
  }, [csvContent, startDate, endDate]);

  const handleDownloadMd = useCallback(() => {
    if (!markdownOutput) return;
    const blob = new Blob([markdownOutput], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getMdFilename(startDate, endDate);
    a.click();
    URL.revokeObjectURL(url);
  }, [markdownOutput, startDate, endDate]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(markdownOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [markdownOutput]);

  // ── Sorting ──────────────────────────────────────────────────────────────────

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
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const logPrefix = (kind: LogEntry['kind']) =>
    kind === 'tool_call' ? '→' : kind === 'tool_result' ? '←' : kind === 'error' ? '!' : '>';
  const logColor = (kind: LogEntry['kind']) =>
    kind === 'tool_call'
      ? 'text-blue-400'
      : kind === 'tool_result'
      ? 'text-zinc-400'
      : kind === 'error'
      ? 'text-red-400'
      : 'text-green-400';

  const canFormat = selectedKeys.size === 3;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6 border-b border-zinc-800 pb-4">
        <h1 className="text-lg font-bold tracking-widest text-white uppercase">
          LouPlug Event Finder
        </h1>
        <p className="text-xs text-zinc-500 mt-1">Louisville newsletter automation</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        {[
          { label: 'Week Start', val: startDate, set: setStartDate },
          { label: 'Week End', val: endDate, set: setEndDate },
          { label: 'Send Date', val: sendDate, set: setSendDate },
        ].map(({ label, val, set }) => (
          <div key={label} className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">{label}</label>
            <input
              type="date"
              value={val}
              onChange={(e) => set(e.target.value)}
              disabled={isRunning}
              className="bg-zinc-900 border border-zinc-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:border-zinc-400 disabled:opacity-50"
            />
          </div>
        ))}

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
            onClick={handleDownloadCsv}
            className="px-4 py-2 bg-zinc-800 text-white text-sm rounded hover:bg-zinc-700 border border-zinc-600 transition-colors"
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

      {/* Agent Log */}
      {log.length > 0 && (
        <div className="mb-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Agent Log ({log.length})
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded p-3 h-56 overflow-y-auto text-xs leading-5">
            {log.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">{entry.timestamp}</span>
                <span className={`shrink-0 ${logColor(entry.kind)}`}>{logPrefix(entry.kind)}</span>
                <span className={entry.kind === 'error' ? 'text-red-400' : entry.kind === 'tool_result' ? 'text-zinc-400' : 'text-zinc-200'}>
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
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              All Events ({sortedEvents.length})
            </div>
            <div className="text-xs text-zinc-500">
              Click rows to select your top 3
            </div>
          </div>
          <div className="overflow-x-auto border border-zinc-800 rounded">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-left">
                  <th className="px-3 py-2 font-normal w-8"></th>
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
                    Score {sortKey === 'engagement_score' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                  </th>
                  <th className="px-3 py-2 font-normal">Flags</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.map((ev, i) => {
                  const key = eventKey(ev);
                  const isSelected = selectedKeys.has(key);
                  const isDisabled = !isSelected && selectedKeys.size >= 3;
                  return (
                    <tr
                      key={i}
                      onClick={() => !isDisabled && handleToggleSelect(ev)}
                      className={`border-t border-zinc-800 transition-colors ${
                        isSelected
                          ? 'bg-zinc-800'
                          : isDisabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-zinc-900 cursor-pointer'
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => {}}
                          className="accent-white cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        {ev.event_url ? (
                          <a
                            href={ev.event_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ev.event_name}
                          </a>
                        ) : (
                          ev.event_name
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-zinc-300">{ev.date}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{ev.day}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{ev.time}</td>
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
                      <td className="px-3 py-2 text-zinc-400 max-w-[12rem] truncate">{ev.venue}</td>
                      <td className="px-3 py-2 text-center">
                        <ScoreBadge score={ev.engagement_score} />
                      </td>
                      <td className="px-3 py-2">
                        <FlagBadge flags={ev.flags} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Your Picks + Format Options */}
      {events.length > 0 && (
        <div className="mb-6 border border-zinc-700 rounded p-5 bg-zinc-950">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider font-bold">
              Your Picks
            </div>
            <div className={`text-xs font-bold ${canFormat ? 'text-green-400' : 'text-zinc-500'}`}>
              {selectedKeys.size}/3 selected
            </div>
          </div>

          {/* 3 pick slots */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            {[0, 1, 2].map((slot) => {
              const ev = selectedEvents[slot];
              return (
                <div
                  key={slot}
                  className={`border rounded p-3 min-h-[72px] flex flex-col justify-between gap-1 ${
                    ev ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 border-dashed'
                  }`}
                >
                  {ev ? (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-white leading-snug flex-1">
                          {ev.event_name}
                        </span>
                        <button
                          onClick={() => handleToggleSelect(ev)}
                          className="text-zinc-500 hover:text-red-400 text-xs shrink-0 transition-colors"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {ev.day}, {ev.date} · {ev.category}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-700 self-center text-center">
                      Pick #{slot + 1} — click a row above
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Formatting options */}
          <div className="border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
              Formatting Options
            </div>
            <div className="flex flex-wrap gap-6 mb-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-500">Tone</label>
                <SegmentedControl
                  value={tone}
                  onChange={setTone}
                  options={[
                    { value: 'casual', label: 'Casual' },
                    { value: 'energetic', label: 'Energetic' },
                    { value: 'dry', label: 'Dry' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-500">Description Length</label>
                <SegmentedControl
                  value={descLength}
                  onChange={setDescLength}
                  options={[
                    { value: 'brief', label: 'Brief' },
                    { value: 'standard', label: 'Standard' },
                    { value: 'detailed', label: 'Detailed' },
                  ]}
                />
              </div>
              <div className="flex items-end">
                <span className="text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 select-none">
                  No em dashes enforced
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-xs text-zinc-500">
                Custom Instructions{' '}
                <span className="text-zinc-600">(optional)</span>
              </label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g. Mention parking if available. Emphasize Derby connection. Note age restrictions..."
                rows={2}
                className="bg-zinc-900 border border-zinc-700 text-white text-xs px-3 py-2 rounded focus:outline-none focus:border-zinc-400 resize-none placeholder:text-zinc-600 w-full max-w-2xl"
              />
            </div>

            <button
              onClick={handleFormatNewsletter}
              disabled={!canFormat || isFormatting}
              className="px-5 py-2 bg-white text-black text-sm font-bold rounded hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isFormatting ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Formatting...
                </span>
              ) : (
                'Format Newsletter'
              )}
            </button>
            {!canFormat && events.length > 0 && (
              <span className="text-xs text-zinc-600 ml-3">
                Select 3 events to enable
              </span>
            )}
          </div>
        </div>
      )}

      {/* Markdown Output */}
      {markdownOutput && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              Newsletter Markdown — {getMdFilename(startDate, endDate)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded hover:bg-zinc-700 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownloadMd}
                className="px-3 py-1 text-xs bg-zinc-800 border border-zinc-600 rounded hover:bg-zinc-700 transition-colors"
              >
                Download .md
              </button>
              <button
                onClick={() => setMarkdownOutput('')}
                className="px-3 py-1 text-xs border border-zinc-700 rounded text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={markdownOutput}
            rows={Math.max(16, markdownOutput.split('\n').length + 2)}
            className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs px-4 py-3 rounded font-mono leading-relaxed focus:outline-none resize-none"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </main>
  );
}
