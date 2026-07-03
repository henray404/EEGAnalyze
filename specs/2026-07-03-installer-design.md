# Cross-platform single-file installer for EEG Analysis Tool

**Date:** 2026-07-03
**Status:** approved (design), pending implementation plan
**Owner:** Henry

## Problem

New collaborators need to set up this project (clone repo, create Python venv,
install backend deps, know how to start both the backend and frontend
servers) with zero prior knowledge of the codebase. Today that requires
manually following the `Development Commands` section of `CLAUDE.md` —
git clone, `python -m venv`, `pip install -r requirements.txt`, run uvicorn,
run a static server in a second terminal, remember two ports. Error-prone
for non-technical users (per `CLAUDE.md`, target users include "dokter,
mahasiswa, dan publik umum").

## Goal

One file a brand-new user can download (no git required yet) and double-click
(or `python install.py`), that:

1. Clones this repo to a folder the user picks.
2. Sets up the backend Python venv and installs dependencies.
3. Generates `start.bat` / `start.sh` in the cloned repo that launch both
   servers and open the browser.
4. Creates OS-appropriate shortcuts (Start Menu + Desktop on Windows, a
   double-clickable launcher on Mac, a `.desktop` file on Linux) pointing at
   the start script.

## Non-goals

- Auto-installing `git` or `python3` themselves if missing — too fragile
  across 3 OSes and frequently needs admin/sudo. Installer detects and tells
  the user what to install instead.
- Fully automated taskbar/Dock pinning. Windows 10/11 blocks scripted
  taskbar pinning (Microsoft removed the API); Linux taskbar behavior
  differs per desktop environment (GNOME/KDE/XFCE/etc). The installer
  creates a proper shortcut and tells the user to pin it themselves
  (one manual right-click) rather than silently failing at "automatic"
  pinning on some machines.
- A compiled/native executable (PyInstaller `.exe`, `.app`, AppImage).
  Would need separate builds + CI per OS. Out of scope for a lab/research
  tool with a handful of users — revisit only if this becomes a public
  distribution with many non-technical end users.

## Approach

Single file: `install.py` at the repo root. Uses Python's stdlib
`tkinter` (ships with standard CPython on Windows/Mac; on some minimal
Linux installs needs the `python3-tk` system package — installer detects
this at startup and shows an actionable error rather than crashing with a
raw `ImportError`).

**Why this over a native installer:** the project already hard-requires
Python to run the backend at all, so requiring Python to run the
*installer* adds no new dependency. It keeps the whole thing to one file,
no build pipeline, no per-OS binaries to maintain.

**Distribution:** `install.py` lives at repo root so it can be downloaded
directly via GitHub's raw-file URL before the user has cloned anything
(`Save As` on the raw link, or a direct download link we can hand out).

## GUI flow

Single Tkinter window, sequential steps shown as one panel that updates
in place (not separate windows):

1. **Prerequisite check** (runs automatically on launch)
   - `shutil.which("git")` — if missing, show install instructions
     (link to git-scm.com) and disable further steps.
   - `sys.version_info` — warn if Python < 3.9 (align with whatever
     `backend/requirements.txt` / existing venv setup assumes; confirm
     exact floor during implementation by checking `requirements.txt`).
   - If both OK, enable the next step.

2. **Destination + repo URL**
   - Folder picker (`tkinter.filedialog.askdirectory`), default suggestion
     `~/EEGAnalyze`.
   - Repo URL text field, pre-filled `https://github.com/henray404/EEGAnalyze.git`,
     editable (for forks).
   - "Install" button.

3. **Clone + setup** (runs on a background thread so the GUI doesn't
   freeze; all subprocess stdout/stderr streamed live into a scrollable
   text widget in the window)
   - `git clone <url> <dest>`
   - `python -m venv <dest>/backend/.venv`
   - `<venv>/bin/pip install -r <dest>/backend/requirements.txt`
     (platform-correct venv path: `Scripts\pip.exe` on Windows,
     `bin/pip` on Mac/Linux)
   - Any non-zero exit code: stop, show the actual captured stderr in the
     log box (not swallowed/summarized), leave window open so the user can
     screenshot/report it. Do not auto-retry.

4. **Generate scripts + shortcuts**
   - Write `start.bat` (Windows) and `start.sh` (Mac/Linux) into the
     cloned repo root (write both regardless of host OS, so the repo is
     portable if shared/copied to another machine).
   - Both scripts: activate the venv, launch backend
     (`uvicorn app.main:app --port 8000`) and frontend
     (`python -m http.server 5173` from `frontend_v2/`) concurrently,
     wait ~1-2s, then open the default browser to `http://localhost:5173`.
   - Shortcuts:
     - **Windows:** `.lnk` in Start Menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs`)
       and on Desktop, both pointing at `start.bat`, via `pywin32` if
       available or a small VBScript/PowerShell fallback (`pywin32` isn't
       stdlib — implementation plan needs to pick one approach; note this
       as an open implementation decision, not blocking the design).
     - **Mac:** write a `.command` file (double-clickable in Finder) next
       to `start.sh` that just execs it; tell user they can drag it to the
       Dock.
     - **Linux:** write a `.desktop` file to
       `~/.local/share/applications/` and copy to `~/Desktop` if that
       exists, `Exec=` pointing at `start.sh`.
   - Manual-step note ("right-click this shortcut and choose Pin to
     taskbar/Dock/Favorites") shown as static text — not an automated
     step, see Non-goals.

5. **Done screen**
   - Summary of what was created and where.
   - "Launch now" button that runs the freshly-created start script.

## Error handling

- Every subprocess call checked for return code; failure shows real
  stderr text in the GUI log, not a generic "something went wrong".
- GUI never silently closes on error — user always sees what happened
  and can copy the log text out.
- Folder-exists check before clone: if destination is non-empty, warn and
  ask for confirmation or a different folder rather than letting `git
  clone` fail with a cryptic error.

## Testing

- **Windows:** fully testable in this environment — will actually run
  `install.py` end to end against a throwaway destination folder and
  verify clone, venv, pip install, generated `start.bat` actually starts
  both servers and opens the browser, and that shortcuts are created.
- **Mac/Linux:** cannot execute locally (Windows dev machine). Will write
  these code paths carefully against documented `subprocess`/`tkinter`/
  filesystem behavior for each OS, but this is **not** executed/verified
  here — flagged explicitly rather than claimed as tested. Recommend the
  user (or a collaborator with Mac/Linux access) do a real run-through
  before relying on it for onboarding.

## Open implementation decisions (for the plan, not blocking design approval)

- Exact mechanism for Windows shortcut `.lnk` creation (pywin32 vs.
  PowerShell subprocess call vs. plain `.bat` shortcut instead of a true
  `.lnk`).
- Exact Python version floor to check for (read from
  `backend/requirements.txt` / existing docs during implementation).
- Whether `install.py` needs to also be copied into the cloned repo (so
  it's available for e.g. re-running setup later) — leaning yes, trivial
  to include.
