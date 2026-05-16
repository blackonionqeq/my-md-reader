# MD Reader Deployment And Nginx Design

Date: 2026-05-17

## Goal

Define a production deployment design for the Markdown reader that supports HTTPS, an isolated app subdomain, multiple server-hosted content directories, and a one-command server-side deployment flow that also manages Nginx site configuration.

## Scope

In scope:

- Deploy the app as a static Vite build behind Nginx.
- Use a dedicated subdomain for the reader application.
- Keep the app itself mounted at the root path `/` of that subdomain.
- Serve multiple content directories and `manifest.json` files from the same server.
- Keep real production domain values out of the repository.
- Manage deployment through a server-local env file ignored by git.
- Generate Nginx site configuration from a committed template.
- Let the deploy script build the app, publish the static output, validate Nginx config, and reload Nginx.
- Document cache policy expectations for app shell files, hashed assets, and content files.

Out of scope:

- Dockerization.
- CI/CD pipelines.
- Automatic rollback or release retention.
- Background content publishing workflows.
- Cross-origin content hosting as a first-class deployment mode.

## Current Problem

The application is buildable and testable, but it does not yet have a production deployment contract. The repository lacks a deployment script, Nginx configuration template, and a safe way to keep environment-specific values such as the real domain name and deployment paths out of version control.

Without these pieces, shipping requires repeated manual steps and increases the risk of path mistakes, stale cache behavior, and broken PWA hosting details.

## Deployment Approach

### 1. Use a dedicated subdomain with root-path hosting

The reader should be hosted on a dedicated subdomain such as `reader.example.com`, but the real domain must remain server-local and not be committed to the repository.

The application should run at the root path `/` of that subdomain rather than under a nested path such as `/reader/`. This keeps the deployment aligned with Vite and PWA defaults:

- Vite `base` can remain `/`.
- The web app manifest `start_url` can remain `/`.
- The web app manifest `scope` can remain `/`.
- Service Worker scope matches the whole app naturally.
- Nginx SPA fallback stays simple.

This design minimizes path-related production risk and avoids the extra coupling required for sub-path deployment.

### 2. Keep content on the same origin under `/content/`

Remote Markdown collections should be served from the same deployed origin as the app, using a path layout rooted under `/content/`.

Example structure:

- `/content/course-a/manifest.json`
- `/content/course-a/articles/intro.md`
- `/content/course-b/manifest.json`

This supports multiple content directories and multiple manifests while keeping the browser fetch path same-origin. That avoids CORS complexity for the initial deployment model and lets the existing `fetch`-based manifest and article download flow work without proxying.

Local `.md` file import remains unchanged and does not require any server configuration beyond hosting the web app itself.

### 3. Separate committed templates from server-local secrets and paths

The repository should commit a deployment example env file and an Nginx template, but not the real deployment values.

Committed files:

- `deploy/deploy.env.example`
- `deploy/nginx.site.conf.template`
- `deploy/deploy.sh`

Ignored file:

- `deploy/deploy.env`

The real env file will live inside the project directory on the server and contain values such as:

- application domain
- deploy root
- published web root
- Nginx site output path
- certificate paths

This keeps deployment portable while preventing the real domain from being exposed in the repository.

### 4. Let the deploy script manage the full publish path

Deployment will be initiated manually on the server and may use `sudo`.

The deploy script should own the following workflow:

1. Load `deploy/deploy.env`.
2. Validate required variables are present.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Build the app with `pnpm build`.
5. Ensure the destination web root exists.
6. Sync the built `dist/` output into the published site directory.
7. Render the Nginx config template using env substitution.
8. Write the rendered config to the configured Nginx site path.
9. Run `sudo nginx -t`.
10. Run `sudo systemctl reload nginx`.

If Nginx config validation fails, the script must stop before reload so a broken site definition is never activated.

The script does not need to retain previous releases. Recovery is expected to happen through source control revert plus redeploy.

## Nginx Design

### Site shape

Nginx should define a dedicated `server` block for the reader subdomain:

- HTTP requests redirect to HTTPS.
- HTTPS requests serve the static app.
- The site root points to the published app directory.

The key request behavior is SPA fallback:

- `try_files $uri $uri/ /index.html`

This allows deep links and browser refreshes to resolve back through the app shell.

### MIME and PWA details

The site config must explicitly serve `.webmanifest` with the manifest MIME type if not already defined globally:

- `application/manifest+json`

This avoids browsers misreading the generated manifest file.

### Cache behavior

Nginx should encode the cache strategy directly in the site config.

Recommended policy:

- `/index.html`: `no-cache`
- `/manifest.webmanifest`: `no-cache`
- hashed files under `/assets/`: long-lived immutable cache
- icons and other generated static assets: long-lived cache when content-hashed or otherwise versioned
- `/content/`: short-to-moderate cache, allowing content updates without excessive staleness

This keeps app deployments responsive to shell updates while preserving the performance benefit of Vite's hashed assets.

## File-Level Additions

- `deploy/deploy.env.example`: documents required deployment variables with placeholder values.
- `deploy/deploy.sh`: server-side deployment entry point.
- `deploy/nginx.site.conf.template`: Nginx config template with env placeholders.
- `.gitignore`: include `deploy/deploy.env`.
- `README.md` or an equivalent deployment section: explain DNS, env setup, deploy usage, and content directory layout.

## Expected Env Variables

The env file should provide a minimal, explicit set of variables:

- `APP_DOMAIN`
- `DEPLOY_ROOT`
- `WEB_ROOT`
- `NGINX_SITE_PATH`
- `SSL_CERT_PATH`
- `SSL_KEY_PATH`

Optional variables may be added later only if they eliminate real duplication in the script or template.

## Failure Handling

Missing env file:

- Deployment stops with a clear error.

Missing required env variable:

- Deployment stops before build or config generation.

Build failure:

- Deployment stops before static files are copied into place.

Nginx template render failure:

- Deployment stops before overwriting the active site config.

`nginx -t` failure:

- Deployment stops before reload.

Reload failure:

- Report the error clearly so the operator can inspect the service state.

## Testing Strategy

Deployment work should be verified with lightweight local and server-side checks rather than browser automation.

Checks:

- `pnpm build` still succeeds after the deployment additions.
- The deploy script supports a dry local read of `deploy/deploy.env.example` structure through documentation or simple validation logic.
- Rendered Nginx config includes the expected substituted paths and domain.
- `sudo nginx -t` passes with the generated config on the target server.
- Visiting `/` serves the app shell.
- Refreshing a deep client-side route still returns `index.html`.
- Visiting a hosted content manifest under `/content/.../manifest.json` succeeds over HTTPS.
- The generated `manifest.webmanifest` is served with the correct MIME type.

## Expected Outcome

After this work, the project will have a repeatable production deployment path for a dedicated HTTPS subdomain. The repository will keep reusable deployment logic and templates, while sensitive server-specific values stay in a git-ignored env file. A single server-side command will build the app, publish static assets, refresh Nginx configuration, validate it safely, and reload the web server.
