const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 20_000;

export async function webFetch(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return `ERROR: HTTP ${response.status} for ${url}`;
    }

    const text = await response.text();
    if (text.length > MAX_CONTENT_LENGTH) {
      return text.slice(0, MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED]';
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return `ERROR: Timeout fetching ${url}`;
    }
    return `ERROR: ${err instanceof Error ? err.message : String(err)} fetching ${url}`;
  }
}

export async function webSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return 'ERROR: BRAVE_API_KEY not set. Cannot perform web search.';
  }

  try {
    const params = new URLSearchParams({ q: query, count: '10' });
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      return `ERROR: Brave Search HTTP ${response.status}`;
    }

    const data = await response.json();
    const results: Array<{ title: string; url: string; description?: string }> =
      data?.web?.results ?? [];

    if (results.length === 0) {
      return 'No results found.';
    }

    return results
      .map(
        (r) =>
          `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description ?? '(no snippet)'}\n---`
      )
      .join('\n');
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}
