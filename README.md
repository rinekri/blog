# rinekri.com

Source for [rinekri.com](https://rinekri.com) — my personal blog. Android engineering write-ups, career reflections, and the occasional deep dive into a bug that ate a weekend.

Built with [Zola](https://www.getzola.org/), a fast static site generator written in Rust, using a Zola port of the [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme.

## Stack

- **[Zola](https://www.getzola.org/)** `0.18.0` — static site generator (config in [`config.toml`](config.toml))
- **Theme:** `papermod` ([`themes/papermod`](themes/papermod)) — a Zola-compatible port of Hugo's PaperMod
- Content lives in [`content/posts/`](content/posts), one file or [page bundle](https://www.getzola.org/documentation/content/page/#page-bundles) per post

## Running locally

Install Zola (macOS via Homebrew):

```sh
brew install zola
```

Then, from the repo root:

```sh
zola serve
```

This starts a local dev server at `http://127.0.0.1:1111` with live reload — edit any file under `content/` or `themes/papermod/` and the browser updates automatically.

To validate the site without serving it (broken internal links, anchors, etc.):

```sh
zola check
```

To produce a production build into `public/`:

```sh
zola build
```

## Writing a post

Create a new file (or a folder with an `index.md` for a page bundle, if the post has its own images) under `content/posts/`:

```
content/posts/YYYY-MM-DD_slug.md
# or, for a post with local images:
content/posts/YYYY-MM-DD_slug/index.md
content/posts/YYYY-MM-DD_slug/cover.png
```

Every post starts with Zola's `+++` TOML front matter:

```toml
+++

title = "Post Title"

[taxonomies]
tags = ["android", "kotlin"]

+++
```

The first paragraph before the `<!-- more -->` marker is used as the post's excerpt/description on the home page and in RSS.

## Deployment

Pushing to `main` triggers [`.github/workflows/ftp-deploy.yml`](.github/workflows/ftp-deploy.yml): GitHub Actions builds the site with Zola and deploys `public/` over FTP to `ftp.rinekri.com`. No manual deploy step needed — merge to `main` and it ships.

## License

Personal blog content — all rights reserved unless a post says otherwise. The `papermod` and `anatole-zola` themes under `themes/` keep their own upstream licenses.
