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
      "order": 1,
      "contentHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
| `version` | string | No | Human-readable release version (e.g. `"1.0.0"`). |
| `articles` | array | Yes | Non-empty array of article entries. |

### Article fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier within this collection. |
| `title` | string | Yes | Display title for the article. |
| `url` | string | Yes | Path to the `.md` file (absolute or relative to the manifest URL). |
| `order` | number | No | Sort order. Defaults to the array index (1-based) when omitted. |
| `contentHash` | string | No | SHA-256 of the exact Markdown response bytes, formatted as `sha256:` plus 64 hexadecimal characters. |

## Stable IDs And Incremental Updates

The top-level `id` is the permanent identity of the collection. Keep it stable
when the title, version, article list, hosting domain, or manifest URL changes.
If the reader fetches a different top-level ID while checking an existing
source, it treats that response as a different collection and refuses to
overwrite the current group.

Article `id` values are also stable identities. Changing an article ID is
equivalent to removing the old article and adding a new one, so the old
article's downloaded content, favorite, and reading progress are deleted.

The reader compares manifests by article ID:

- a new ID is added;
- a missing ID is permanently removed;
- a changed `contentHash` or resolved article URL downloads a replacement;
- title and order changes update metadata without downloading Markdown; and
- unchanged articles keep their offline content and reading state.

The application checks only when the user selects **Check for updates**. It
shows a diff and requires confirmation before applying additions, replacements,
or removals. If the manifest moves, importing its new URL with the same
top-level `id` offers to update the existing collection's source URL.

## Content Hashes

`contentHash` is optional for backward compatibility but strongly recommended.
Calculate it from the exact final bytes served for the Markdown file, before
UTF-8 decoding or newline conversion. For example, the SHA-256 of a file whose
bytes are `abc` is:

```text
sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

Do not ask an AI model to invent the value. A deterministic publishing step
should write the Markdown files first, hash the final files, and then generate
the manifest. A typical generator performs this sequence:

```text
for each final Markdown file:
  bytes = readFile(file)
  contentHash = "sha256:" + SHA256(bytes).hex()
  append { id, title, url, order, contentHash } to articles
write manifest.json
```

The top-level `version` and article hashes have different jobs. `version` is a
publisher-readable release label; `contentHash` is the precise signal for one
article's bytes. When hashes are absent and `version` changes, the reader
conservatively refreshes every previously downloaded hashless article. When
both hashes and a version change are absent, same-URL Markdown edits cannot be
detected.

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
