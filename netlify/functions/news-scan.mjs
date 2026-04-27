/**
 * Netlify serverless function — fetches recent headlines from iGaming + fintech news sources.
 * Returns parsed headlines grouped by source for use in the topic scan prompt.
 */

const SOURCES = {
  igaming: [
    { name: 'iGaming Business (IGB)', url: 'https://www.igamingbusiness.com/feed/', type: 'rss' },
    { name: 'Next.io', url: 'https://next.io/feed/', type: 'rss' },
    { name: 'Next.io News', url: 'https://next.io/news/', type: 'html' },
    { name: 'SBC News', url: 'https://www.sbcnews.co.uk/feed/', type: 'rss' },
    { name: 'Yogonet', url: 'https://www.yogonet.com/international/rss/last_news', type: 'rss' },
    { name: 'CalvinAyre', url: 'https://calvinayre.com/feed/', type: 'rss' },
    { name: 'GamblingNews.com', url: 'https://www.gamblingnews.com/feed/', type: 'rss' },
    { name: 'iGaming.org', url: 'https://igaming.org/news/feed/', type: 'rss' },
  ],
  fintech: [
    { name: 'Finextra', url: 'https://www.finextra.com/rss/headlines.aspx', type: 'rss' },
    { name: 'PaymentsJournal', url: 'https://www.paymentsjournal.com/feed/', type: 'rss' },
    { name: 'The Paypers', url: 'https://thepaypers.com/rss', type: 'rss' },
  ],
  obtained: [
    { name: 'Obtained.com Blog', url: 'https://obtained.com/blog/feed/', type: 'rss' },
    { name: 'Obtained.com Blog (alt)', url: 'https://obtained.com/feed/', type: 'rss' },
  ],
  regulation: [
    { name: 'GamblingCompliance', url: 'https://gamblingcompliance.com/feed', type: 'rss' },
  ]
};

function parseRSS(xml, maxItems = 15) {
  const items = [];
  // Match <item> or <entry> blocks
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1] || match[2] || '';
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1] ||
                 (block.match(/<link[^>]*href="([^"]*)"/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || [])[1] ||
                    (block.match(/<published[^>]*>([\s\S]*?)<\/published>/) || [])[1] ||
                    (block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/) || [])[1] || '';
    const desc = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] ||
                 (block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) || [])[1] || '';
    // Strip HTML from description
    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 200);
    const cleanTitle = title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (cleanTitle) {
      items.push({ title: cleanTitle, link: link.trim(), date: pubDate.trim(), snippet: cleanDesc });
    }
  }
  return items;
}

function parseHTML(html, maxItems = 10) {
  // Basic headline extraction from HTML pages — looks for common patterns
  const items = [];
  // Try article/h2/h3 patterns
  const headlineRegex = /<(?:h[1-3]|a)[^>]*class="[^"]*(?:title|headline|post-title|entry-title|article-title)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[1-3]|a)>/gi;
  let match;
  while ((match = headlineRegex.exec(html)) !== null && items.length < maxItems) {
    const title = match[1].replace(/<[^>]+>/g, '').trim();
    if (title && title.length > 10) items.push({ title, link: '', date: '', snippet: '' });
  }
  // Fallback: look for any h2/h3 tags
  if (!items.length) {
    const h2Regex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    while ((match = h2Regex.exec(html)) !== null && items.length < maxItems) {
      const title = match[1].replace(/<[^>]+>/g, '').trim();
      if (title && title.length > 10) items.push({ title, link: '', date: '', snippet: '' });
    }
  }
  return items;
}

async function fetchSource(source, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ContentStudio/1.0 (News Aggregator)' }
    });
    clearTimeout(timer);
    if (!res.ok) return { source: source.name, items: [], error: `HTTP ${res.status}` };
    const text = await res.text();
    const items = source.type === 'rss' ? parseRSS(text) : parseHTML(text);
    return { source: source.name, items, error: null };
  } catch (e) {
    return { source: source.name, items: [], error: e.message || 'Fetch failed' };
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    // Which source groups to fetch: 'all', 'igaming', 'fintech', 'obtained', 'regulation'
    const groups = body.groups || ['igaming', 'fintech', 'obtained', 'regulation'];
    // Optional: extra custom source URLs
    const customSources = body.customSources || [];

    // Gather all sources to fetch
    let allSources = [];
    for (const g of groups) {
      if (SOURCES[g]) allSources.push(...SOURCES[g]);
    }
    allSources.push(...customSources.map(s => ({ name: s.name || s.url, url: s.url, type: s.type || 'rss' })));

    // Fetch all in parallel with timeout
    const results = await Promise.allSettled(
      allSources.map(s => fetchSource(s))
    );

    const output = results.map(r => r.status === 'fulfilled' ? r.value : { source: 'unknown', items: [], error: r.reason?.message });
    const totalItems = output.reduce((acc, r) => acc + r.items.length, 0);

    return Response.json(
      { results: output, totalItems, fetchedAt: new Date().toISOString() },
      { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (e) {
    return Response.json(
      { error: e.message, results: [], totalItems: 0 },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
};
