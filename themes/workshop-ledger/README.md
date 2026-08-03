# Workshop Ledger

A ledger/workbench-themed Zola theme built for an engineer's personal site: a
TOML-driven project graph, resume, and speaking page, a generative
signature/portrait system, dark/light theme toggle, hand-rolled site search,
and a playable easter-egg 404. No JS build step, no bundler — plain vanilla
JS loaded directly.

## Install

```toml
# config.toml
theme = "workshop-ledger"
compile_sass = true
```

Zola only auto-compiles the *site's* own `sass/` directory, not a theme's —
your root `sass/main.scss` needs to pull the theme in explicitly:

```scss
// sass/main.scss
@import "../themes/workshop-ledger/sass/main";
```

Your own `content/` and `data/` live at your site's root as normal; this
repo's own root doubles as a working example/demo of the theme.

## `[extra]` config reference

Identity & branding:

| Key | Purpose |
|---|---|
| `hero_name` | Plain-text name shown on the home hero (fallback for `hero_name_html`) |
| `hero_name_html` | Optional raw HTML override for the hero heading — lets you accent-color a specific letter/word without the theme guessing where to split a name |
| `portrait_image` | Path (under `static/`) to your portrait photo — used on `/about/`, as the OG/share image, and in the `Person` JSON-LD |
| `portrait_image_resume` | Optional alternate crop for `/resume/`, falls back to `portrait_image` |
| `home_og_image` | Optional static screenshot of the home hero (recommended 1200x630), used as the home page's `og:image`/`twitter:image` since social crawlers can't render the live canvas. Falls back to `portrait_image` when unset — keep it in sync by hand if the hero copy changes |
| `signature_seed` | Seed string for the colophon's generative signature/wordmark canvas, falls back to `author` |
| `portrait_seed` | Seed string for the about page's generative portrait pattern, falls back to `author` |

Site chrome — see `config.toml` in this repo for full worked examples of
each: `hero_status_focus`, `hero_stats`, `team_size`, `career_start_year`,
`current_year`, `tag_clusters`, `navigation`, `social_icons`,
`cloudflare_analytics_token` (optional, omit to ship with analytics off),
`extra.comment.utterances` (optional GitHub-issues comment widget), and the
`show_*` display toggles (`show_scroll_to_top`, `show_code_copy_buttons`,
`show_reading_time`, `show_word_count`, `show_post_nav_links`,
`show_post_meta`, `show_post_edit_button`, `default_toc_open`).

A handful more read from `[extra]` without a template-side default, so treat
them as required: `site_name`, `keywords` (array), `language_direction`
(`"ltr"`/`"rtl"`, sets `<html dir>`), `date_format` (a `chrono` format
string), and `edit_post_url` (base URL used to build each post's "Suggest
changes" link when `show_post_edit_button` is on).

## Data files

Every showcase page loads its content from `data/*.toml` via Zola's
`load_data()` rather than hardcoding copy in the template — edit the TOML,
not the template, for all of these:

- **`projects.toml`** — grouped project records (`groups[].items[]`), each with
  `category` (`leadership`/`architecture`/`feature`), `kind` (`card`/`row`),
  `vis` (controls client-name masking) plus a matching **required** `badge_label`
  (the display text — e.g. `"Confidential"`, `"Own product"`, `"Idea"` — is
  intentionally more varied than `vis` alone, so it's not auto-derived), dates,
  stack list, and optional `seed` (drives the generative fingerprint mark),
  `home_feature` (surfaces it on the home page), and `meta`.
- **`resume.toml`** — `full_name`, `contact_email`, `employment[]` (role eras),
  `skills[]` (grouped, each item optionally a `chip_icon` for the home hero).
  `location`, `summary`, `education[]`, `languages[]`, and `certifications[]`
  are all optional — safe to omit for a thin/example resume. Experience
  bullets are *not* duplicated here — they're filtered live from
  `projects.toml` by matching `company`/`role`.
- **`speaking.toml`** — flat list of talks/articles/courses; `type`, `title`,
  `venue`, `year`, and `desc` are required per entry, `url`/`url_label`/`note`
  optional.
- **`stack.toml`**, **`graph.toml`**, **`colophon.toml`**, **`changelog.toml`**
  — each just a `lead_strip` (and for changelog, a flat dated entry list);
  the pages themselves are generated (stack specimen wall, project graph,
  changelog timeline) rather than block-authored.

### `leadership.toml` / `about.toml` — the generic block schema

These two pages share one layout engine: a `lead_strip` intro, then
`sections[]` (`id`, `num`, `label`, optionally `stats[]`), each with a
`blocks[]` array. A block's `type` picks its renderer — write any of these in
either file, in any order, to build the page. `about.toml`'s top-level
`log_continues[]` (a closing changelog-style note list) is optional.

| `type` | Fields | Renders as |
|---|---|---|
| `paragraph` | `text` | A plain paragraph |
| `pull` | `text` | A pulled-quote callout |
| `arc` | `nodes[]` (`year`, `note`, `resolved`) | A horizontal timeline |
| `chip_row` (leadership) / `chips` (about) | `items[]` | A row of small chips |
| `org_tree` (leadership) | `root_name`, `root_role`, `root_dot`, `children[]` (`name`, `role`, `dot`, optional `leaves[]`) | A 2-3 level org chart |
| `systems_grid` (about) | `groups[]` (`name`, `items[]` with `name`/optional `project_seed`) | A grouped systems diagram |
| `checklist_card` (leadership) | `good_label`, `good_items[]`, `bad_label`, `bad_items[]`, `scoring` | A two-column good/bad checklist |
| `ramp_scale` (leadership) | `min_label`, `max_label`, `marker_pct`, `caption` | A labeled scale with a marker |
| `outlook` (leadership) | `heading`, `items[]` | A goals list |

Both templates (`templates/leadership.html`, `templates/about.html`) are
fully generic — there's nothing to edit in the template itself to write your
own leadership/about page, only the TOML.
