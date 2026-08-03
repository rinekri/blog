+++
title = "Search data"
# Zola always writes page output as <path>/index.html regardless of any
# extension in `path` (a ".json" path becomes a directory containing an
# index.html, not a literal file) — so this is a plain slug, fetched by
# static/js/search.js as "/search-data/" (trailing slash), not ".json".
path = "search-data"
template = "search_data.html"
in_search_index = false
# Root section (content/_index.md) is sort_by = "date" — pages without one
# are silently dropped from build output, not just excluded from listings.
# Nothing iterates the root section's pages, so this date is inert.
date = 2026-01-01

[extra]
robots = "noindex"
+++
