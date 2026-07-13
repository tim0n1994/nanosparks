export interface WikiSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchWikipedia(query: string): Promise<WikiSearchResult[]> {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`
    );
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };

    const results = data.query?.search || [];
    return results.map((r) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: r.snippet.replace(/<[^>]+>/g, ''),
    }));
  } catch (error) {
    console.warn('Wikipedia search failed:', error);
    return [];
  }
}
