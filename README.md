# Medialine

A GNOME Shell extension that shows the currently playing media track in the top bar via MPRIS.

## Features

### Panel Indicator
- Displays track info (title, artist, album) inline in the top bar
- Three icon modes: **album art**, **app icon**, or **playback status icon**
- Auto-hides when no media is playing or playback is stopped
- Configurable icon size, spacing, text separator, and max label width

### Popup
Click the indicator to open a rich media popup with:
- Album art (falls back to a generic icon if unavailable)
- Track title, artist, and album name
- Live **progress bar** with elapsed and total time (updates every second)
- **Playback controls** — previous, play/pause, next — with greyed-out state when unavailable

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
Install directly from [extensions.gnome.org](https://extensions.gnome.org) (search for **Medialine**).

### Manual
```bash
git clone https://github.com/funinkina/medialine
cd medialine
make install
make enable
```

Then log out and back in (or restart GNOME Shell on X11 with `Alt+F2` → `r`).

#### Other make targets

| Command | Description |
|---|---|
| `make` | Compile GSettings schemas only |
| `make install` | Compile schemas and copy extension to `~/.local/share/gnome-shell/extensions/` |
| `make uninstall` | Remove the extension from the install directory |
| `make enable` | Enable the extension via `gnome-extensions` |
| `make disable` | Disable the extension via `gnome-extensions` |
| `make pack` | Create a distributable zip in `dist/` for extensions.gnome.org |
| `make clean` | Remove compiled schema and `dist/` |

## Configuration

Open the extension preferences via:
- GNOME Extensions app
- Right-clicking the indicator → **Settings**
- Configuring a mouse button to **Open settings** and clicking

### Display tab
| Setting | Description |
|---|---|
| Icon source | Album art / App icon / Playing status |
| Icon size | Size in pixels (8–64) |
| Icon spacing | Gap between icon and text (0–32 px) |
| Separator | String placed between title, artist, album |
| Max text width | Clip long labels (0 = unlimited) |
| Show title / artist / album | Toggle each field independently |

### Panel tab
| Setting | Description |
|---|---|
| Panel section | Left, Center, or Right |
| Position index | Order within the section (0 = first) |

### Mouse tab
Assign an action to left, middle, and right click individually.

## License

MIT — see [LICENSE](LICENSE).
