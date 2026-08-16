# Vesktop

Vesktop is a custom Discord desktop app

**Main features**:
- Vencord preinstalled
- Much more lightweight and faster than the official Discord app
- Linux Screenshare with sound & wayland
- Much better privacy, since Discord has no access to your system

**Not yet supported**:
- Global Keybinds
- see the [Roadmap](https://github.com/Vencord/Vesktop/issues/324)

![](https://github.com/Vencord/Vesktop/assets/45497981/8608a899-96a9-4027-9725-2cb02ba189fd)
![](https://github.com/Vencord/Vesktop/assets/45497981/8701e5de-52c4-4346-a990-719cb971642e)

## Installing

Visit https://vesktop.dev/install

## Building from Source

You need to have the following dependencies installed:
- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download)
- pnpm: `npm install --global pnpm`

Packaging will create builds in the dist/ folder

```sh
git clone https://github.com/Vencord/Vesktop
cd Vesktop

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

This is a small C++ helper library Vesktop uses on Linux to emit D-Bus events. By default, prebuilt binaries for x64 and arm64 are used.

If you want to build it from source:
1. Install build dependencies:
    - Debian/Ubuntu: `apt install build-essential python3 curl pkg-config libglib2.0-dev`
    - Fedora: `dnf install @c-development @development-tools python3 curl pkgconf-pkg-config glib2-devel`
2. Run `pnpm buildLibVesktop`
3. From now on, building Vesktop will use your own build

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

Only one program can consume the capture socket at a time — if OBS is open with a Game Capture
source, Vesktop can't capture until you close it, and vice versa.

### Building vkcapture from Source

Prebuilt binaries for x64 and arm64 are used by default. To build it yourself:
1. Install build dependencies:
    - Debian/Ubuntu: `apt install build-essential python3 curl pkg-config libegl1-mesa-dev libgles2-mesa-dev`
    - Fedora: `dnf install @c-development @development-tools python3 curl pkgconf-pkg-config mesa-libEGL-devel mesa-libGLES-devel`
2. Run `pnpm buildVkCapture`
3. From now on, building Vesktop will use your own build