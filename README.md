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

<details>
<summary>Preview</summary>

<img width="650" height="350" alt="joined" src="https://github.com/user-attachments/assets/571e4f8d-a7db-4af4-8d88-f4f2355a1964" />
</details>


## Features

### Panel Indicator
- Displays track info (title, artist, album) inline in the top bar
- Four icon modes: **album art**, **app icon**, **playback status icon**, or **custom image**
- Auto-hides when no media is playing or playback is stopped
- Configurable icon size, spacing, text separator, and max label width

### Rich Popup
Click the indicator to open a media popup with:
- Album art preserving the original aspect ratio (square album covers and 16:9 video thumbnails like YouTube) — click to **raise/focus the player window**
- **App icon badge** overlaid on the album art, toggleable in settings
- Track title, artist, and album name
- Live **progress bar** with elapsed and total time (updates every second)
- **Click or drag** anywhere on the progress bar to seek (a thumb appears on hover when the player supports seeking)
- **Playback controls** — shuffle, previous, play/pause, next, repeat (off / track / playlist) — with greyed-out state when unavailable
- Customizable popup colors (primary text, secondary accent, and background)
- **Dynamic background** — optionally extract the dominant color from album art and use it as the popup background, with adjustable intensity to control brightness

### Multi-Source View
When multiple media players are active, the popup switches to a **compact list view** showing each player with:
- Album art thumbnail (click to focus the player)
- Track title and artist/album
- Per-source play/pause and next-track controls

### Mouse & Scroll Actions
Each mouse button (left, middle, right) and scroll direction (up, down) can be independently configured to:
- Do nothing
- Open the popup
- Play / Pause
- Open extension settings
- Skip to next track / previous track
- Raise the player window
- Volume up / Volume down (scroll only, via Gvc mixer)

### Panel Placement
- Place the indicator in the **left**, **center**, or **right** section of the top bar
- Set a position index to control ordering within that section

### Default Notification Hiding
- Optionally suppress GNOME's built-in media notification while the panel indicator is shown

### MPRIS Auto-detection
- Automatically detects all running MPRIS-compatible media players
- Prefers actively **Playing** sources; falls back to **Paused** ones
- Reacts instantly when players start, stop, or change tracks

## Requirements

- GNOME Shell 45 – 50
- An MPRIS-compatible media player (Spotify, VLC, Firefox, Rhythmbox, mpv, etc.)

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

| Command          | Description                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `make`           | Compile GSettings schemas and translation files                                              |
| `make install`   | Compile schemas and translations, copy extension to `~/.local/share/gnome-shell/extensions/` |
| `make uninstall` | Remove the extension from the install directory                                              |
| `make enable`    | Enable the extension via `gnome-extensions`                                                  |
| `make disable`   | Disable the extension via `gnome-extensions`                                                 |
| `make pack`      | Create a distributable zip in `dist/` for extensions.gnome.org                               |
| `make clean`     | Remove compiled schema, translations, and `dist/`                                            |
| `make pot`       | Regenerate the `.pot` translation template from source files                                 |
| `make update-po` | Merge new strings from `.pot` into all existing `.po` files                                  |
| `make locale`    | Compile all `.po` translation files to binary `.mo` files                                    |

## Configuration

Open the extension preferences via:
- GNOME Extensions app
- Right-clicking the indicator → **Settings**
- Configuring a mouse button to **Open settings** and clicking

### Appearance tab
| Setting                     | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| Icon source                 | Album art / App icon / Playing status / Custom image |
| Custom image                | File picker for a custom PNG/SVG icon                |
| Icon size                   | Size in pixels (8–64)                                |
| Icon spacing                | Gap between icon and text (0–32 px)                  |
| Separator                   | String placed between title, artist, album           |
| Max text width              | Clip long labels (0 = unlimited)                     |
| Show title / artist / album | Toggle each field independently                      |

### Panel tab
| Setting                   | Description                                  |
| ------------------------- | -------------------------------------------- |
| Panel section             | Left, Center, or Right                       |
| Position index            | Order within the section (0 = first)         |
| Hide default notification | Suppress GNOME's built-in media notification |

### Mouse tab
Assign an action to left, middle, right click, and scroll up/down individually.

### Popup tab
| Setting                    | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| Primary color              | Text and control color in the popup (with reset)                           |
| Secondary color            | Background and accent color in the popup (with reset)                      |
| Background color           | Custom background for the popup (with reset)                               |
| Dynamic background         | Extract the dominant color from album art as the popup background          |
| Intensity                  | How bright or dark the dynamic background appears (0 = dark, 100 = bright) |
| Show app icon on album art | Overlay the player's app icon badge on the art                             |

## License

MIT — see [LICENSE](LICENSE).
