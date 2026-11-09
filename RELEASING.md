# Releasing iccqr

Releases are published to npm by GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token is stored anywhere, and every release gets a provenance statement linking it to the commit and workflow that built it.

npm only lets you set up trusted publishing for a package that already exists, so the very first version is published by hand.

## Once: the first release

1. **Enable two-factor authentication** on your npm account (Account → Two-Factor Authentication). npm requires it for configuring trusted publishing.
2. **Push this repository** to `https://github.com/iccqr/iccqr`. `package.json`'s `repository.url` must match it exactly, or npm will refuse CI releases.
3. **Publish 1.0.0 from your computer:**

   ```sh
   npm login
   npm ci
   npm test
   npm publish --access public   # builds dist/ first, then asks for your 2FA code
   ```

4. **Tag it,** so the repository records what was released:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The publish workflow runs, sees 1.0.0 is already on npm, and stops there without an error.

5. **Connect GitHub Actions to the package:** on npmjs.com, open the `iccqr` package → Settings → Trusted publishing → GitHub Actions, and enter:

   | Field | Value |
   |---|---|
   | Organization or user | `iccqr` |
   | Repository | `iccqr` |
   | Workflow filename | `publish.yml` |
   | Environment | leave empty |

   npm doesn't check these when you save them; a mistake only shows up when the workflow tries to publish. npm also expects a new trusted publisher's first publish within 2 days, so set this up when the next release is close, or delete and re-add it later.

6. **Optional, recommended:** in the same settings page, under Publishing access, choose to require two-factor authentication and disallow tokens. From then on, only the workflow (or you, with 2FA) can publish.

## Every release after that

```sh
npm version patch     # or minor / major: updates package.json, commits, and tags v1.0.1
git push --follow-tags
```

The tag starts `.github/workflows/publish.yml`. It checks that the tag matches `package.json`, runs the tests, and publishes. Follow it under the repository's Actions tab. The new version appears on npmjs.com with a "Built and signed on GitHub Actions" provenance badge.

## Choosing the version number

- **patch**: fixes that change no behavior anyone relies on.
- **minor**: new options, commands or exports.
- **major**: a change to the JavaScript API or the command line that could break someone's code or scripts.

The marker format is separate and never breaks. See [FORMAT.md](FORMAT.md#rules-for-changing-the-format). A new optional marker field is a minor release.

## After a release

The website (`iccqr/iccqr.github.io`) pins an exact version of this package. To move it to a new release:

```sh
npm install --save-exact iccqr@<version>
npm run build
```

Then commit `package.json`, `package-lock.json` and `index.html` together.
