# Bulk Scanner

Desktop app (Windows, macOS, Linux) for scanning batches of documents from network scanners into named PDFs.
Tauri 2: Rust backend (mDNS discovery + AirScan/eSCL scan jobs, native file saving), React UI.

- Finds AirScan/eSCL scanners on the LAN automatically, or add one by IP
- Flatbed, feeder and duplex; colour/grey/B&W; blank-page skipping
- Naming presets built from blocks (date, time, text, separator, input-on-save, counter)
- Sessions stored locally; save one PDF or the whole batch as a ZIP

## Develop

Needs Node 20+ and Rust (plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) on Linux).

```
npm install
npm run app        # dev window with hot reload (dev builds also list a demo scanner)
npm run bundle     # release installers in src-tauri/target/release/bundle
```

Live scanner checks: `cd src-tauri && cargo test -- --ignored --nocapture` (discovers scanners, reads capabilities, runs one 100 dpi flatbed scan).

## Release

1. Bump `version` in `package.json` (the app reads it from there; keep `src-tauri/Cargo.toml` in step).
2. `git tag v1.0.1 && git push origin v1.0.1` — `.github/workflows/build.yml` builds Windows (.exe/.msi), macOS Apple Silicon + Intel (.dmg) and Linux (.AppImage/.deb/.rpm), signs the update bundles and attaches everything plus `latest.json` to a draft release.
3. Publish the draft. Installed apps see it within a few seconds of their next launch (and every 6 hours) and show **Update to vX** in the status bar.

The repo must be public: the website download links and the in-app updater (`releases/latest/download/latest.json`) fetch from it without a login.

### Update signing key

Updates are verified with a minisign key pair. The public key is in `src-tauri/tauri.conf.json`; the private key lives outside the repo at `~/.tauri/bulk-scanner.key` (no password).
Add it to the GitHub repo as secret `TAURI_SIGNING_PRIVATE_KEY` (file contents) and an empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back the key up: if it's lost, existing installs can no longer verify new updates.
