<div align="center">
  <img src="https://raw.githubusercontent.com/Ruciazyt/qnote-elec/master/src/renderer/public/icon-256.png" width="88" height="88" alt="QNote" />
  <h1>QNote</h1>
  <p><b>A quiet productivity tool that sits in the corner of your desktop</b><br />Clipboard · Notes · Todo · AI assistant · Embedded browser — all in one window</p>
</div>

<div align="center">

[![Release](https://img.shields.io/github/v/release/Ruciazyt/qnote-elec?label=Release&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Ruciazyt/qnote-elec/total?label=Downloads&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/Ruciazyt/qnote-elec/build-and-release.yml?label=release-build&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/actions/workflows/build-and-release.yml)
[![CI](https://img.shields.io/github/actions/workflow/status/Ruciazyt/qnote-elec/auto-build.yml?label=ci&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/actions/workflows/auto-build.yml)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](https://github.com/Ruciazyt/qnote-elec/releases/latest)
[![License](https://img.shields.io/github/license/Ruciazyt/qnote-elec?label=License&color=1d97a8)](LICENSE)

[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)

</div>

---

<p align="center">
  <a href="https://github.com/Ruciazyt/qnote-elec/releases/latest"><img src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-latest-1d97a8?style=for-the-badge&logo=github&logoColor=white" alt="Download the latest release" /></a>
  <a href="#feature-overview"><img src="https://img.shields.io/badge/%E5%8A%9F%E8%83%BD%E4%B8%80%E8%A7%88-1d97a8?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Feature overview" /></a>
  <a href="#development"><img src="https://img.shields.io/badge/%E5%BC%80%E5%8F%91-8A94A7?style=for-the-badge&logo=github&logoColor=white" alt="Development" /></a>
</p>

---

## What is this

QNote is a desktop productivity tool for Windows built on **Electron**. It puts the handful of things you reach for every day into a single window:

- Everything you copied is kept for you — **clipboard history** is captured in the background, searchable, and can be pinned.
- Ideas become files instead of lock-in — **notes** are plain files: Markdown, web pages, drawings, images and PDF all live side by side.
- Tasks have weights and deadlines — **to-dos** carry a priority, an optional due date and image attachments.
- The part you would rather not do by hand goes to the **AI assistant** — it reads your notes, searches your clipboard history and can operate the browser for you.
- Looking something up should not mean switching to another window — the **embedded browser** keeps bookmarks, and the AI sidebar reads the page you are on.

The design has a single principle: **quiet**. One brand color, restrained motion, a visual density that does not fight for attention, so the tool disappears into muscle memory instead of reminding you that it exists.

The application interface is in Chinese; this document is in English.

---

## Table of contents

- [What is this](#what-is-this)
- [Feature overview](#feature-overview)
- [Screenshots](#screenshots)
- [Download and install](#download-and-install)
- [Feature details](#feature-details)
  - [Clipboard](#clipboard)
  - [Notes](#notes)
  - [Todo](#todo)
  - [AI assistant](#ai-assistant)
  - [Embedded browser](#embedded-browser)
  - [OCR and voice input](#ocr-and-voice-input)
  - [Shortcuts](#shortcuts)
- [Configuration](#configuration)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Development](#development)
- [Versioning and releases](#versioning-and-releases)
- [Code signing policy](#code-signing-policy)
  - [What is signed](#what-is-signed)
  - [Build and signing process](#build-and-signing-process)
  - [Team roles](#team-roles)
  - [Privacy](#privacy)
  - [System changes during installation](#system-changes-during-installation)
  - [Uninstalling](#uninstalling)
  - [How users verify a download](#how-users-verify-a-download)
- [Related documents](#related-documents)
- [Feedback and contributions](#feedback-and-contributions)
- [License](#license)

---

## Feature overview

| Module | Capability |
| --- | --- |
| **Clipboard** | Background capture of text and images, pinning, marking as important, full-text search, code highlighting, one-click formatting, save as a note, add as a to-do, write to the memory index |
| **Notes** | Plain-file storage, 5 note types, folder tree, drag-and-drop move, rename, batch import, rich text editing, Excalidraw drawing, PDF reading |
| **Todo** | Three priority levels, optional due date and notes, image attachments, one-click completion |
| **AI assistant** | Floating panel, streaming output, image questions, agent tool loop, 13 built-in tools, conversation history with automatic compaction, skill templates, long-term memory, usage statistics |
| **Embedded browser** | Multiple tabs, bookmarks, AI sidebar reads the current page, AI can click, fill forms and navigate |
| **OCR** | Baidu OCR standard, high-precision and web image recognition; results can be written back to the record |
| **Voice input** | MiniMax ASR speech-to-text, summoned by a global hotkey (`F1` by default, changeable) |
| **Shortcuts** | Home tiles open apps and folders, drag to reorder, direct access from the system context menu |
| **Other** | Light and dark themes, pixel desktop pet, system tray, clipboard mini window (`Ctrl/⌘ + Shift + V`), data export and import, automatic updates |

---

## Screenshots

> Screenshots are pending — drop the images into `docs/images/` and uncomment the lines below.
>
> - **Home** — clipboard list, search, OCR and formatting toolbar
> - **Notes** — folder tree plus multi-type editors (text, drawing, web page, image, PDF)
> - **AI assistant** — a collapsed dot that expands into a card
> - **Embedded browser** — tab bar, bookmark bar and the AI sidebar

```markdown
<!-- <p align="center"><img src="docs/images/home.png" width="880" alt="Home" /></p> -->
<!-- <p align="center"><img src="docs/images/notes.png" width="880" alt="Notes" /></p> -->
<!-- <p align="center"><img src="docs/images/ai.png" width="880" alt="AI assistant" /></p> -->
```

---

## Download and install

The current distribution channel is **Windows**. Every release is produced by GitHub Actions in two forms.

### Installer (recommended)

- File name: `QNote-Setup-x.x.x.exe`
- Double-click to install, choose the directory, desktop and Start menu shortcuts are created for you
- **Automatic updates** — Settings → Data and development → App update walks through check, download and restart-and-install
- The update package is verified with SHA512 before it is installed, so a corrupted or tampered file never lands on disk

### Portable build

- File name: `QNote-x.x.x-portable.zip`
- Unpack it anywhere, double-click `QNote.exe` and run
- Handy on a USB stick, for temporary use, or for a green uninstall
- **No automatic updates** — a portable build has no installer and cannot overwrite itself, so upgrading means downloading the new version and replacing the folder

> Notes are stored in `%APPDATA%\qnote\notes` by default. Use "Change directory" on the Notes page to move them anywhere on your machine.

---

## Feature details

### Clipboard

The window opens on a list — whatever you copied is already there.

- **Captured in the background**: text and images go into the list the moment you copy them, and duplicates are collapsed.
- **Pinned and important**: pinned entries float to the top; entries marked as important survive a clear.
- **Full-text search**: type to filter, and the match can still be edited and saved in place.
- **Code highlighting**: snippets are rendered with Prism, and `JavaScript`, `TypeScript`, `JSON`, `HTML` and `CSS` can be formatted with one click.
- **Move it along**: any entry can become a note, a to-do, or an entry in the memory index.
- **Image recognition**: an image entry can be sent to Baidu OCR, and the result is written back to that entry.
- **Quick access**: `Ctrl/⌘ + Shift + V` opens a separate mini window, so you do not have to break up whatever you were doing.

### Notes

**Notes are plain files** — no proprietary database, no private format, the type is decided by the extension.

| Type | Extension | Notes |
| --- | --- | --- |
| Drawing | `.excalidraw` | Built-in Excalidraw, hand-drawn sketches and flowcharts |
| Text | `.md` / `.markdown` | TipTap rich text, written to disk as standard Markdown |
| Web page | `.html` / `.htm` | Single file, images extracted into `assets/` |
| Image | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg` | Screenshots and assets stored as they are |
| PDF | `.pdf` | Built-in reader with page navigation and zoom |

Around that:

- **Folder tree**: any depth, drag to move, rename, batch import (drop files in and they are indexed).
- **Asset directory**: images inside a rich text note are written into `assets/`, and the note body stays plain and readable.
- **Default directory**: `%APPDATA%\qnote\notes`, changeable to any path.
- **Writable by the AI**: the assistant can write into the notes directory (it appends a suffix instead of overwriting your version).

### Todo

Three priority levels, an optional due date and notes, and image attachments — when a to-do is created from the clipboard, the image and the OCR text come along.

To-dos can be created from the clipboard, the notes and the AI assistant.

### AI assistant

A dot rests in the corner; open it and it becomes a draggable card, with its position and expanded state shared across windows.

- **Streaming output**: the reply comes back word by word and can be interrupted at any time.
- **Agent mode**: the model runs a tool loop on its own, calling tools until the task is done.
- **Images**: paste, drag or pick a file into the input box, up to four images per question.
- **Many conversations**: history is grouped and can be revisited.
- **Automatic compaction**: long conversations are summarized once they pass a threshold, and the interface says so.
- **Skills**: frequently used prompts become templates with `{content}` and `{clipboard}` placeholders, and they can be imported from a remote URL.
- **Long-term memory**: the assistant can remember your preferences, facts and working agreements. It lives in `<userData>/ai-memory.json`, in plain text you can read and edit.
- **Usage statistics**: today's, this week's and the total token consumption, broken down by model and by date, visible in the settings.

**Built-in tools**

| Tool | Does | Type |
| --- | --- | --- |
| `list_notes` | Lists the notes directory | read |
| `read_note` | Reads one note by name | read |
| `save_note` | Writes a note (appends a suffix rather than overwriting) | write |
| `get_clipboard_history` | Reads the clipboard history | read |
| `get_todos` | Reads the to-do list | read |
| `get_app_info` | Reads the app version and data paths | read |
| `remember` / `recall` / `forget` | Writes, reads and deletes long-term memory | mixed |
| `browser_get_snapshot` | Reads the structure of the current page | read |
| `browser_click` / `browser_fill` / `browser_navigate` | Operates the embedded browser tab | write |

> Browser tools only ever act on **the one tab you are currently looking at**. They never open or close tabs, and every call is written to the application log. When a password, a verification code or a payment is involved, the model is explicitly told to stop and hand the step back to you.

**Connecting a provider**: fill in an API key, a model name and a base URL. Both the OpenAI and the Anthropic protocol are supported, so official endpoints, gateways, Ollama and LM Studio all work.

> Asking with images requires a vision-capable model (GPT-4o, Claude, a MiniMax vision model and similar). If the model does not support it, the upstream error is shown as it is — text-only questions are unaffected.

### Embedded browser

Multiple tabs, bookmarks, an address bar and back / forward / reload. A collapsible **AI sidebar** on the right lets the model read the current page and operate it.

Pages are hosted by the main process in a `WebContentsView`, and the interface layer only synchronizes the toolbar and the location, so page styles cannot bleed into the app.

### OCR and voice input

- **OCR**: three Baidu OCR modes — standard, high-precision and web image recognition. The API key and secret are entered in the settings; the source code only keeps empty defaults.
- **Voice input**: recordings are sent to MiniMax ASR (`asr-1.0`) and transcribed. `F1` summons it by default, the hotkey can be changed, and illegal combinations are rejected with an explanation.

### Shortcuts

Home tiles pin your favorite apps and folders so they open with one click, and you can drag to reorder them. Turn on the system context menu and right-clicking any file in Explorer offers "Add to QNote".

---

## Configuration

All keys and third-party settings are entered on the **settings page** and injected at runtime. The repository contains no credentials.

| Setting | Purpose | Where |
| --- | --- | --- |
| Notes directory | Where note files live | Notes page → Change directory |
| Baidu OCR key / secret | Image text recognition | Settings → Services and AI → OCR |
| AI provider / key / model / base URL | AI assistant and speech recognition | Settings → Services and AI → AI assistant |
| Voice hotkey | Global hotkey for voice input | Settings → Services and AI → Voice input |
| Theme | Light, dark or follow the system | Settings → Interface → Appearance |
| App updates | Check, download and install new versions | Settings → Data and development → App update |

**Where the data lives**

| Content | Path |
| --- | --- |
| Database | `%APPDATA%\qnote\db\clipboard.sqlite` |
| Default notes directory | `%APPDATA%\qnote\notes` |
| Logs | `%APPDATA%\qnote\app.log` / `app-error.log` |
| AI long-term memory | `%APPDATA%\qnote\ai-memory.json` |

> The database can be exported and imported with one click in the settings, so moving to a new machine is a copy.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop framework | Electron 33 |
| Interface | React 18 · Vite 5 · Tailwind CSS 3 · shadcn/ui · lucide-react |
| Editors | TipTap (rich text / Markdown) · Excalidraw · Prism · Prettier |
| Data | Knex · SQLite (sqlite3) |
| AI | LangChain (`@langchain/openai` / `@langchain/anthropic`) · in-house agent loop and memory layer |
| Language | TypeScript 5 |
| Build | electron-builder 25 (NSIS installer + portable ZIP) |

---

## Project structure

```text
qnote-elec/
├── src/
│   ├── main/                  # main process
│   │   ├── core/              # long-lived capabilities: tray, shortcuts, clipboard watcher, floating windows, auto update
│   │   ├── handlers/          # IPC handlers, one module per file
│   │   └── utils/             # AI / OCR / ASR / vector search / configuration
│   ├── preload.ts             # context bridge, the only entry point for system capabilities
│   ├── renderer/              # React interface
│   ├── shared/                # types shared by the main process and the renderer
│   └── database/              # Knex connection and migrations
├── build/                     # packaging and compilation config (electron-builder / tsconfig)
├── scripts/                   # build, release and commit hook scripts
├── docs/                      # additional documentation
├── DESIGN.md                  # design spec: color, density, component philosophy
└── AGENTS.md                  # development spec: commit messages, versioning, red lines
```

---

## Development

### Requirements

- **Node.js >= 18**
- **pnpm 10.32.0** (please do not use npm or yarn)

### Common commands

```bash
# install dependencies
pnpm install

# development mode: main process compile watcher + renderer hot reload + app launch, all three in parallel
pnpm run dev

# compile only the main process and preload
pnpm run build:electron

# build only the renderer
pnpm run build:react

# full build: clean → compile → package → post-process the portable build
pnpm run build

# build the portable version
pnpm run build-portable
```

### Commit convention

The repository enforces a commit message hook (Angular commit convention). Run this once after cloning:

```bash
pnpm run setup:hooks
```

Messages look like `feat(ocr): 增加百度 OCR 表格识别`. You can validate a single message with:

```bash
pnpm run verify:commit "feat(updater): 增加应用更新卡片"
```

> If the hook file does not have the right permissions on Windows it is silently skipped, and `setup:hooks` fixes that for you.

### Versioning and releases

The version number has a single source of truth: the `version` field in the root `package.json`. A release goes through exactly one path — tag the commit, CI builds it and creates the Release:

```bash
pnpm run release:patch     # 1.1.0 → 1.1.1
pnpm run release:minor     # 1.1.0 → 1.2.0
pnpm run release:major     # 1.1.0 → 2.0.0
```

The script checks that the working tree is clean, that the version number is valid and that **the release type matches what the commits since the last release actually contain** (a `feat` commit forces a minor release), then bumps the version, commits it, creates an annotated tag and pushes both. CI produces the installer, the portable build and `latest.yml`, and creates the GitHub Release.

Validate the version number with:

```bash
pnpm run verify:version
```

---

## Code signing policy

The code signing arrangement for this project: the Windows installer is signed with a certificate issued by [SignPath Foundation](https://signpath.org) under a public CA — the foundation vouches for open source projects that have been reviewed and meet its criteria, so the certificate chain is trusted by Windows and both SmartScreen and enterprise security scanners can see a verified publisher.

> Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

**Current status: the release artifacts are not signed.** The self-signed certificate used up to and including 1.4.0 was retired on 2026-10-28 — in practice it was worse than no signature at all, because a signed-but-untrusted publisher is an extra suspicion signal for security products. The free SignPath Foundation signing application has been submitted; once it is approved the installer will be signed with the foundation's certificate, and each release still needs a manual approval. Until then, verify the file with the `SHA256SUMS.txt` published in every Release.

### What is signed

| Artifact | Signed | Notes |
| --- | --- | --- |
| `QNote-Setup-<version>.exe` | Yes once SignPath is active<br>Currently: not signed | The installer users download |
| `QNote.exe` after installation | No | Not signed separately; handled like the third-party native modules described below |
| `QNote-<version>-portable.zip` | No | Secondary channel; verify it with `SHA256SUMS.txt` |
| `latest.yml` | n/a | Auto-update metadata; not signed, its integrity is checked through the installer hash |
| `SHA256SUMS.txt` | n/a | Hash manifest for manual verification |

Files *inside* the installer (the main executable `QNote.exe`, third-party native modules such as the SQLite `node_sqlite3.node`) are not signed individually; they are shipped as their upstream projects publish them. This is the normal practice for open source projects: the signature states "this installer was produced by this project's CI from the public source tree", not "every file inside has been audited one by one". The file a security scanner actually inspects is the downloaded installer, and that is the file the signature covers.

### Build and signing process

Once SignPath is active, the complete flow is:

1. The source is built by GitHub Actions on GitHub-hosted runners.
2. The build output is uploaded as a workflow artifact. SignPath verifies that the file really originates from this repository's CI build, then signs it.
3. A signing request is approved manually by this project's approver in the SignPath console.
4. After approval, SignPath applies an Authenticode signature using a public CA certificate, and the signed artifact is returned to the CI.
5. The CI recomputes the hashes in `latest.yml` and publishes the signed installer to the GitHub Release.

While SignPath is not active, steps 2 to 4 are skipped and the CI publishes the unsigned installer — the release flow is not blocked by the missing signature.

Private keys are held in SignPath's HSM. The repository holds no private key, and the CI does not need any certificate file. The publisher shown by Windows is **SignPath Foundation**, not the individual maintainer.

### Team roles

This project is maintained by a single maintainer, who also holds all three signing roles:

| Role | Member | Responsibility |
| --- | --- | --- |
| **Authors** (committers) | [Ruciazyt](https://github.com/Ruciazyt) | May modify the source tree in the repository without additional review |
| **Reviewers** | [Ruciazyt](https://github.com/Ruciazyt) | Reviews every pull request from outside contributors; outside pull requests are not merged without review |
| **Approvers** | [Ruciazyt](https://github.com/Ruciazyt) | Approves every signing request |

### Privacy

**This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.**

Every network request in QNote is triggered by the user:

| Feature | Destination | Trigger |
| --- | --- | --- |
| AI assistant | The AI endpoint the user entered in the settings page (OpenAI- or Anthropic-compatible protocol, Ollama, LM Studio, and similar) | The user sends a message |
| Voice input | MiniMax ASR | The user records and converts audio |
| OCR | Baidu OCR | The user clicks "recognize" |
| Embedded browser | The website the user opens | The user navigates to a page |
| Check for updates | GitHub Releases | The user clicks "check for updates" |

The user's own data (clipboard history, notes, todos, conversation history) is stored locally in `%APPDATA%\qnote` and is never uploaded for synchronization or analytics. API keys are entered by the user in the settings page and injected at runtime; the repository and the installer contain no credentials. If the user configures no AI or OCR service, QNote makes no network request other than "check for updates". The AI, OCR and speech-to-text services listed above are operated by third parties and are subject to their own privacy policies and terms of service.

### System changes during installation

The installer performs the following changes, all of which are removed again on uninstall:

- Installs into `%LOCALAPPDATA%\Programs\QNote` for the current user by default. The first page of the wizard lets the user choose "for all users" instead (which installs into `Program Files`), and the next page lets them choose any other directory.
- Creates a desktop shortcut and a Start menu shortcut.
- Registers three global hotkeys (system-wide, so they are taken while QNote runs and released when it exits): `Ctrl/⌘ + Shift + V` opens the clipboard popup, `Ctrl/⌘ + Enter` brings up the main window, and `F1` starts voice input. The voice hotkey can be changed to another combination in the settings page.
- Optional: registers an "Add to QNote" entry in the Windows Explorer context menu (disabled by default, enabled in the settings page). The entry is written under the current user's `HKCU\Software\Classes\*\shell`.

QNote adds no startup entry to the registry, installs no background service and installs no drivers.

### Uninstalling

- **Windows 11 / Windows 10**: Settings → Apps → Installed apps → QNote → Uninstall. The uninstaller removes the program directory and the shortcuts it created.
- The portable build has no installer: delete the extracted folder.
- User data (notes, clipboard history, todos, AI memory) stays in `%APPDATA%\qnote` after uninstalling and is not deleted automatically. Remove that folder to erase it, or export and import the data from within the app before uninstalling.

### How users verify a download

**For the current unsigned releases, check the SHA256 hash:**

```powershell
Get-FileHash .\QNote-Setup-<version>.exe -Algorithm SHA256
```

The expected hashes are published with every release in `SHA256SUMS.txt`, which can also be verified directly:

```bash
sha256sum -c SHA256SUMS.txt
```

Once SignPath is active, the installer additionally carries an Authenticode digital signature. Windows shows the signature information under "Properties → Digital Signatures", and it can be checked from the command line:

```powershell
Get-AuthenticodeSignature .\QNote-Setup-<version>.exe |
  Select-Object Status, StatusMessage, SignerCertificate
```

`Status` of `Valid` means the signature is intact and the certificate chain is trusted by the system. `SignerCertificate.Issuer` is the public CA that issued the certificate held by SignPath Foundation.

If a corporate security product blocks the download, the hash from `SHA256SUMS.txt` is what the IT team needs in order to allow-list the file.

---

## Related documents

| Document | Contents |
| --- | --- |
| [Portable build notes](docs/PORTABLE.md) | What the portable build is, its directory layout and how to move it |
| [Build guide](docs/BUILD.md) | Local packaging, artifact locations and common build problems |
| [Design spec](DESIGN.md) | Color system, visual density, components and interaction conventions |
| [Development spec](AGENTS.md) | Commit message and versioning conventions, the red line list |
| [Changelog](https://github.com/Ruciazyt/qnote-elec/releases) | The complete change log of every version |

---

## Feedback and contributions

- Found a bug or want a new feature → open an [issue](https://github.com/Ruciazyt/qnote-elec/issues)
- About to write code → read [AGENTS.md](AGENTS.md) (commit conventions and red lines) and [DESIGN.md](DESIGN.md) (interface conventions) first
- When you open an issue, include the version, the Windows version and the steps to reproduce; attaching the log (`%APPDATA%\qnote\app.log`) helps a lot

---

## License

[MIT](LICENSE) © Rucia zyt
