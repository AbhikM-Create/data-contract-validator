# Releasing

What it takes to publish the CLI to npm and host the app, and what has been checked.
Prepared 11 Nov 2026 (final-spec C8). **Nothing has been pushed or published.**

## Where things stand

| Item | State |
|---|---|
| Git | This folder is connected to `github.com/AbhikM-Create/data-contract-validator`, and the work since the last release of `main` (`9ead7d5`) is committed on the branch `v3-pilot-build`, not pushed |
| npm | `data-contract-validator` is not on the registry (`npm view` → 404). The release workflow has never run |
| Package | `npm run verify:package` passes: the packed tarball, installed alone, builds an object from a pack, checks a file, writes a sign-off record, and the record's own re-run command gives the same answer |
| Hosted app | The build emits four files with fixed names: `index.html`, `app.js`, `app.css`, `app-worker.js`. `publish/artifact.html` is generated from the build |
| Secrets | None in the tree (scanned for tokens and keys). `.env*` is ignored; `.env.example` holds names only |

## Decisions before the first release

1. **Version.** `package.json` and `src/lib/version.js` say `2.0.0`, which was never
   published. The code now carries the v3 work (four rule kinds, masking, the sign-off
   record, packs, column matching, sharing). Either publish it as `2.0.0`, or bump both
   files to `3.0.0-beta.1` and publish with the `next` dist-tag while the packs are
   drafts. A test holds the two files equal.
2. **The prototypes and strategy reports** — decided 11 Nov 2026: kept out. The
   prototype files, the strategy reports and the two spec drafts stay on the founder's
   machine, excluded through `.git/info/exclude` (a local file, not committed). Code
   comments and `CLAUDE.md` cite them by section; those references point at documents
   this repository does not hold.
3. **The name.** The package stays `data-contract-validator` and the command `dcv`;
   "Plumbstep" is a working product name and appears in no published identifier.

## Before hosting a build with accounts

`supabase/schema.sql` gained the `migration_objects` table and, for
organisations, `organisations`, `memberships`, `invitations`, the functions
`role_in`, `accept_invitations` and two triggers (12 Nov 2026). It is
idempotent: run the whole file again in the project's SQL editor. Until it has
run, "Save to account" and the Organisation screen say the tables do not exist
yet. Invitations are accepted on sign-in by email: the project's sign-up must
confirm emails, or anyone could claim an invited address.

## Steps

### 1. Commit (local)

```bash
git switch -c v3-pilot-build
```

```bash
git add -A
```

The excluded documents do not appear in `git status`.

### 2. Push and open a pull request

CI runs lint, the unit tests, the build, account isolation, the browser tests, the
package check and the dependency audit. Merge when it is green.

### 3. One-time npm setup

- An npm account that owns the name `data-contract-validator` (it is free today).
- In the GitHub repository: an environment named `npm` holding the secret `NPM_TOKEN`
  (npmjs.com → Access Tokens → Granular, publish rights for this package). After the
  first publish, switch to npm trusted publishing and delete the token.

### 4. Release the CLI

```bash
git tag v2.0.0
```

```bash
git push origin v2.0.0
```

The tag must equal the version in `package.json`. `.github/workflows/release.yml` then
runs lint, tests, the audit and the package check, stamps the commit into the package
(`cli/commit.json`), and publishes with npm provenance.

Afterwards, from any machine:

```bash
npm install --global data-contract-validator
```

```bash
dcv --version
```

It should print the version and the commit of the tag.

### 5. Host the app

`npm run build`, then serve `dist/` from any static host. Set `frame-ancestors` as an
HTTP header there (it cannot be set from a `<meta>` tag).

For the site: `npm run build:site` after `npm run build` writes `dist-site/` — the
marketing pages at the root and the app under `app/` — to serve as one static site.

For the Artifact page: `npm run publish:files` rewrites `publish/artifact.html` from the
build and prints the files to publish beside it — `app.js` and `app-worker.js`.

## What each check proves

| Check | Proves |
|---|---|
| `npm run verify:package` | The tarball ships every file the CLI needs and nothing browser-only; a record's printed re-run command runs against an installed copy |
| `cli/cli.test.js` — "names its own commit" | A copy installed inside another git project reports its own release commit, or unknown, never that project's commit |
| CI `verify` job — `publish:files` then `git diff --exit-code` | The hosted wrapper matches the build, and the file list includes the worker |
| `npm run test:e2e` | The production build, worker included, under its Content-Security-Policy |

## Not checked

- The release workflow itself has not run: its first run is the first tag.
- The Artifact page has not been republished or opened since the worker was renamed.
- npm provenance needs the repository to be public and the workflow to run on GitHub;
  neither was exercised here.
