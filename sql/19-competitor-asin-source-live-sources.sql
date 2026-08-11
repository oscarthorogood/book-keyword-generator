-- competitor_asins_source_check (sql/16, tightened by sql/18) never kept up
-- with app/api/books/[id]/competitors/generate/route.ts: that route tags
-- rows with the actual liveGroups key ("amazon-autocomplete",
-- "google-autocomplete", "youtube-autocomplete", "duckduckgo-autocomplete",
-- "serpapi", "ads-api", "persona-llm", "groq-persona", "decodo", and now
-- "zenrows" — see lib/zenrowsClient.ts), none of which were ever in the
-- allowed list, so any Generate ASINs run that discovered a competitor via
-- a live source (as opposed to the snapshot crawl's 'auto-crawl' tag) would
-- fail the whole upsert.

ALTER TABLE competitor_asins DROP CONSTRAINT IF EXISTS competitor_asins_source_check;
ALTER TABLE competitor_asins
  ADD CONSTRAINT competitor_asins_source_check
  CHECK (source IN (
    'manual', 'kdpradar', 'datadive', 'helium10', 'sellersprite',
    'auto-crawl', 'genre-preset',
    'amazon-autocomplete', 'google-autocomplete', 'youtube-autocomplete', 'duckduckgo-autocomplete',
    'serpapi', 'ads-api', 'persona-llm', 'groq-persona', 'decodo', 'zenrows'
  ));
