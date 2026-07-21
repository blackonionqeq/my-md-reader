# My MD Reader

An offline-first Markdown reader built with Svelte 5, Vite, Dexie, and `vite-plugin-pwa`. It supports ordinary single-article reading and an opt-in virtualized continuous mode for fully downloaded collections.

## Development

- Install: `pnpm install`
- Dev server: `pnpm dev`
- Type and Svelte checks: `pnpm check`
- Unit tests: `pnpm test:unit`
- Production build: `pnpm build`

## Deployment

The production deployment model uses:

- a dedicated HTTPS subdomain such as `reader.example.com`
- app hosting at the root path `/`
- same-origin server-hosted content under `/content/`
- a git-ignored server-local env file at `deploy/deploy.env`
- an Nginx config generated from `deploy/nginx.site.conf.template`

### 1. Point a subdomain at your server

Create a DNS `A` record for your reader subdomain and point it to the server IP. If you use IPv6, add an `AAAA` record as well.

### 2. Prepare TLS for the subdomain

Issue or install a certificate that covers the chosen subdomain. The deploy env file stores the certificate and key paths used by Nginx.

### 3. Create the deploy env file

Copy the example file and fill in real server values:

```bash
cp deploy/deploy.env.example deploy/deploy.env
```

Required values:

- `APP_DOMAIN`: deployed app domain
- `DEPLOY_ROOT`: absolute path to this project on the server
- `WEB_ROOT`: published static site directory used by Nginx
- `NGINX_SITE_PATH`: generated Nginx config destination
- `SSL_CERT_PATH`: certificate file path
- `SSL_KEY_PATH`: private key file path

`deploy/deploy.env` is ignored by git so real values stay local to the server.

### 4. Deploy from the server checkout

Run:

```bash
bash deploy/deploy.sh
```

The script will:

1. load `deploy/deploy.env`
2. install dependencies with `pnpm install --frozen-lockfile`
3. build the app with `pnpm build`
4. sync `dist/` into `WEB_ROOT`
5. render the Nginx config from the template
6. validate Nginx with `sudo nginx -t`
7. reload Nginx with `sudo systemctl reload nginx`

The script expects `pnpm`, `rsync`, `nginx`, and `sudo` to be available on the server.

### 5. Organize hosted content

Keep content under `/content/` on the same origin. Example layout:

```text
/content/course-a/manifest.json
/content/course-a/articles/001-intro.md
/content/course-b/manifest.json
```

You can then add sources in the app using URLs such as:

- `https://reader.example.com/content/course-a/manifest.json`
- `https://reader.example.com/content/course-b/manifest.json`

### Cache policy

The generated Nginx site config applies these defaults:

- `/index.html`: `no-cache`
- `/manifest.webmanifest`: `no-cache`
- `/sw.js`: `no-cache`
- `/assets/`: `public, max-age=31536000, immutable`
- `/icon.svg`: `public, max-age=31536000, immutable`
- `/content/`: `public, max-age=300`

## Specs

- [PWA design](docs/superpowers/specs/2026-05-16-md-reader-pwa-design.md)
- [Bundle splitting design](docs/superpowers/specs/2026-05-16-bundle-splitting-llm-doc-design.md)
- [Offline image caching design](docs/superpowers/specs/2026-05-17-offline-image-caching-design.md)
- [Cache Storage image migration design](docs/superpowers/specs/2026-07-16-cache-storage-image-migration-design.md)
- [Continuous reading virtualization design](docs/superpowers/specs/2026-07-21-continuous-reading-virtualization-design.md)
- [Manifest incremental update design](docs/superpowers/specs/2026-07-21-manifest-incremental-update-design.md)
- [Deployment and nginx design](docs/superpowers/specs/2026-05-17-deployment-and-nginx-design.md)
