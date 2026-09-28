<img src="build/icon.svg" alt="" width="96" align="right" />

# Hearth

Hearth is a custom Discord desktop app, forked from [Vesktop](https://github.com/Vencord/Vesktop).

**Main features**:
- Vencord preinstalled
- Much more lightweight and faster than the official Discord app
- Linux Screenshare with sound & wayland
- Game capture on Linux: share a fullscreen game without losing direct scanout
- Much better privacy, since Discord has no access to your system

**Not yet supported**:
- Global Keybinds

## Installing

Download the latest build for your system from the [releases page](https://github.com/hearthdesktop/hearth/releases).

Coming from Vesktop? On its first launch Hearth copies your Vesktop data over, so you stay logged in and keep your
settings. Your Vesktop install is left untouched.

## Building from Source

You need to have the following dependencies installed:
- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download)
- pnpm: `npm install --global pnpm`

Packaging will create builds in the dist/ folder

```sh
git clone https://github.com/hearthdesktop/hearth
cd hearth

# Install Dependencies
pnpm i

# Either run it without packaging
pnpm start

# Or package (will build packages for your OS)
pnpm package

# Or only build the Linux Pacman package
pnpm package --linux pacman

# Or package to a directory only
pnpm package:dir
```

## Building LibVesktop from Source

This is a small C++ helper library Hearth uses on Linux to emit D-Bus events. It keeps its upstream name. By default,
prebuilt binaries for x64 and arm64 are used.

If you want to build it from source:
1. Install build dependencies:
    - Debian/Ubuntu: `apt install build-essential python3 curl pkg-config libglib2.0-dev`
    - Fedora: `dnf install @c-development @development-tools python3 curl pkgconf-pkg-config glib2-devel`
2. Run `pnpm buildLibVesktop`
3. From now on, building Hearth will use your own build

## Game Capture (Linux)

Sharing your screen normally goes through the desktop portal, which makes the compositor
composite and copy every frame. On a fullscreen game that costs you direct scanout, and the
framerate drop is often severe.

Game capture instead reads frames from the game's own swapchain, so the compositor is never
involved. It needs [obs-vkcapture](https://github.com/nowrep/obs-vkcapture) installed and the
game started with the capture layer loaded:

- Steam launch options: `OBS_VKCAPTURE=1 %command%`
- Anything else: `obs-gamecapture <program>`

Once a game is running that way, hitting Go Live offers it as a source alongside the usual
screens and windows. The layer only loads at process start, so a game that was already running
has to be restarted to show up.

Only one program can consume the capture socket at a time. Hearth only holds it while you're
picking a source or actively sharing, and lets go shortly afterwards, so OBS can capture normally
the rest of the time. While a Hearth game share is running, OBS' own Game Capture won't find
anything, and vice versa. Turning off Settings -> Game Capture releases it outright.

### Building vkcapture from Source

Prebuilt binaries for x64 and arm64 are used by default. To build it yourself:
1. Install build dependencies:
    - Debian/Ubuntu: `apt install build-essential python3 curl pkg-config libegl1-mesa-dev libgles2-mesa-dev`
    - Fedora: `dnf install @c-development @development-tools python3 curl pkgconf-pkg-config mesa-libEGL-devel mesa-libGLES-devel`
2. Run `pnpm buildVkCapture`
3. From now on, building Hearth will use your own build

## License

Hearth is licensed under the GNU General Public License v3.0 or later, like Vesktop. See [LICENSE](LICENSE).
