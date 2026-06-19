<div align="center">

<img src="icons/hicolor/scalable/apps/medialine.svg" alt="Medialine" width="128" height="128" />

# Medialine

A GNOME Shell extension that shows the currently playing media track in the top bar in a elegant minimal way.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46%E2%80%9350-4A86CF?logo=gnome&logoColor=white)](https://www.gnome.org/)
[![GNOME Extensions installs](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fextensions.gnome.org%2Fextension-info%2F%3Fuuid%3Dmedialine%40funinkina.co.in&query=%24.downloads&label=installs&logo=gnome&logoColor=white&color=4A86CF)](https://extensions.gnome.org/extension/10076/medialine/)
[![GitHub stars](https://img.shields.io/github/stars/funinkina/medialine?style=flat&logo=github)](https://github.com/funinkina/medialine/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/funinkina/medialine?logo=github)](https://github.com/funinkina/medialine/issues)
[![Language](https://img.shields.io/badge/JavaScript-GJS-F7DF1E?logo=javascript&logoColor=black)](https://gjs.guide/)

<a href="https://extensions.gnome.org/extension/10076/medialine/">
  <img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=false" alt="Get it on GNOME Extensions" height="140" />
</a>

</div>

## Screenshots
|                                                                                                                                         |                                                                                                                                         |
| :-------------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------: |
| <img alt="Screenshot From 2026-06-02 10-22-17" src="https://github.com/user-attachments/assets/460737c5-4ec3-4202-8fef-49bba5e78b64" /> | <img alt="Screenshot From 2026-06-02 10-27-36" src="https://github.com/user-attachments/assets/3acbe21f-6bd7-4b4b-9ad0-f44aa2c7556f" /> |

## Features

### Panel Indicator
- Displays track info (title, artist, album) inline in the top bar
- Three icon modes: **album art**, **app icon**, or **playback status icon**
- Auto-hides when no media is playing or playback is stopped
- Configurable icon size, spacing, text separator, and max label width

### Popup
Click the indicator to open a rich media popup with:
- Album art preserving the original aspect ratio (works for square album covers and 16:9 video thumbnails like YouTube) — falls back to a generic icon if unavailable
- Track title, artist, and album name
- Live **progress bar** with elapsed and total time (updates every second)
- **Click or drag** anywhere on the progress bar to seek to that position (a thumb appears on hover when the player supports seeking)
- **Playback controls** — shuffle, previous, play/pause, next, repeat (off / track / playlist) — with greyed-out state when unavailable

### Mouse Button Actions
Each mouse button (left, middle, right) can be independently configured to:
- Do nothing
- Open the popup
- Play / Pause
- Open extension settings
- Skip to next track
- Skip to previous track
- Volume up / Volume down (via `pactl`)

### Panel Placement
- Place the indicator in the **left**, **center**, or **right** section of the top bar
- Set a position index to control ordering within that section

### MPRIS Auto-detection
- Automatically detects all running MPRIS-compatible media players
- Prefers actively **Playing** sources; falls back to **Paused** ones
- Reacts instantly when players start, stop, or change tracks

## Requirements

- GNOME Shell 45 – 50
- An MPRIS-compatible media player (Spotify, VLC, Firefox, Rhythmbox, mpv, etc.)
- `pactl` (PipeWire/PulseAudio) — only required if using volume up/down click actions

## Installation

### From extensions.gnome.org
Install directly from [extensions.gnome.org/medialine](https://extensions.gnome.org/extension/10076/medialine/).

### From GitHub Releases
Download the latest `medialine@funinkina.co.in.zip` from the [Releases page](https://github.com/funinkina/medialine/releases/latest), then install it:

```bash
gnome-extensions install --force medialine@funinkina.co.in.zip
gnome-extensions enable medialine@funinkina.co.in
```

Log out and back in (or restart GNOME Shell on X11 with `Alt+F2` → `r`) for the extension to appear.

### Manual
```bash
git clone https://github.com/funinkina/medialine
cd medialine
make install
make enable
```

Then log out and back in (or restart GNOME Shell on X11 with `Alt+F2` → `r`).

#### Other make targets

| Command          | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `make`           | Compile GSettings schemas only                                                 |
| `make install`   | Compile schemas and copy extension to `~/.local/share/gnome-shell/extensions/` |
| `make uninstall` | Remove the extension from the install directory                                |
| `make enable`    | Enable the extension via `gnome-extensions`                                    |
| `make disable`   | Disable the extension via `gnome-extensions`                                   |
| `make pack`      | Create a distributable zip in `dist/` for extensions.gnome.org                 |
| `make clean`     | Remove compiled schema and `dist/`                                             |

## Configuration

Open the extension preferences via:
- GNOME Extensions app
- Right-clicking the indicator → **Settings**
- Configuring a mouse button to **Open settings** and clicking

### Display tab
| Setting                     | Description                                |
| --------------------------- | ------------------------------------------ |
| Icon source                 | Album art / App icon / Playing status      |
| Icon size                   | Size in pixels (8–64)                      |
| Icon spacing                | Gap between icon and text (0–32 px)        |
| Separator                   | String placed between title, artist, album |
| Max text width              | Clip long labels (0 = unlimited)           |
| Show title / artist / album | Toggle each field independently            |

### Panel tab
| Setting        | Description                          |
| -------------- | ------------------------------------ |
| Panel section  | Left, Center, or Right               |
| Position index | Order within the section (0 = first) |

### Mouse tab
Assign an action to left, middle, and right click individually.

## License

MIT — see [LICENSE](LICENSE).
