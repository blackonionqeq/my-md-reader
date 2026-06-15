# Manifest Format

My MD Reader can import a collection of Markdown articles from a remote
`manifest.json` file. This page describes the expected format.

## Schema

```json
{
  "schemaVersion": 1,
  "id": "my-collection",
  "title": "My Article Collection",
  "description": "An optional description shown on the bookshelf.",
  "version": "1.0.0",
  "articles": [
    {
      "id": "intro",
      "title": "Introduction",
      "url": "articles/intro.md",
      "order": 1
    },
    {
      "id": "getting-started",
      "title": "Getting Started",
      "url": "articles/getting-started.md",
      "order": 2
    }
  ]
}
```

## Field Reference

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | number | Yes | Schema version number. Currently `1`. |
| `id` | string | Yes | Unique identifier for this collection. |
| `title` | string | Yes | Display title shown on the bookshelf. |
| `description` | string | No | Short description of the collection. |
| `version` | string | No | Version string (e.g. `"1.0.0"`). |
| `articles` | array | Yes | Non-empty array of article entries. |

### Article fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier within this collection. |
| `title` | string | Yes | Display title for the article. |
| `url` | string | Yes | Path to the `.md` file (absolute or relative to the manifest URL). |
| `order` | number | No | Sort order. Defaults to the array index (1-based) when omitted. |

## URL Resolution

Article `url` values are resolved **relative to the manifest URL**. For
example, if the manifest lives at:

```
https://example.com/docs/manifest.json
```

then an article with `"url": "articles/intro.md"` resolves to:

```
https://example.com/docs/articles/intro.md
```

Absolute URLs (starting with `https://`) are also accepted and used as-is.

## Hosting Tips

- Serve the manifest with a `Content-Type: application/json` header.
- If the reader and the manifest are on different origins, enable CORS on the
  server hosting the manifest and the Markdown files.
- All referenced `.md` files must be publicly accessible (or accessible from
  the reader's origin).
