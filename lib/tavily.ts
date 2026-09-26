export type Comp = { title: string; url: string; content: string };

export const CLOTHING_MARKETS = ['vinted.co.uk', 'depop.com', 'ebay.co.uk'];
export const HOUSEHOLD_MARKETS = ['ebay.co.uk', 'gumtree.com', 'facebook.com', 'vinted.co.uk'];

export async function searchComps(query: string, domains: string[] = CLOTHING_MARKETS): Promise<Comp[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('TAVILY_API_KEY not set, skipping comps');
    return [];
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_domains: domains,
    }),
  });
  if (!res.ok) {
    console.warn('Tavily failed', res.status);
    return [];
  }
  const json = (await res.json()) as { results?: Comp[] };
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, content: (r.content ?? '').slice(0, 500) }));
}
