{
  lib,
  stdenv,
  fetchurl,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  autoPatchelfHook,
  electron_44,
  pipewire,
  libpulseaudio,
  libglvnd,
  pkg-config,
  node-gyp,
  python3,
  pnpm_11,
  fetchPnpmDeps,
  pnpmConfigHook,
  nodejs,
}:
let
  electron = electron_44;
  packageJson = lib.importJSON ../../package.json;

  # vkcapture's own dependencies aren't part of the root pnpm install
  nodeAddonApi = fetchurl {
    url = "https://registry.npmjs.org/node-addon-api/-/node-addon-api-8.9.0.tgz";
    hash = "sha256-Gbh+LOOnf+wBIayX19sIiq4oqs//SBratQ1fYbcOaPQ=";
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "hearth";
  inherit (packageJson) version;

  # packaging changes shouldn't invalidate the pnpm deps hash
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.difference ../.. (
      lib.fileset.unions [
        ../../packaging
        ../../flake.nix
        (lib.fileset.maybeMissing ../../flake.lock)
        (lib.fileset.maybeMissing ../../node_modules)
        (lib.fileset.maybeMissing ../../dist)
      ]
    );
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_11;
    fetcherVersion = 4;
    hash = "sha256-xfBQTFtkyDB9TicELtq02scxzrD+pUc27//T8W2qEYk=";
  };

  nativeBuildInputs = [
    nodejs
    pnpmConfigHook
    pnpm_11
    autoPatchelfHook
    copyDesktopItems
    makeWrapper
    pkg-config
    node-gyp
    python3
  ];

  buildInputs = [
    libpulseaudio
    pipewire
    libglvnd
    (lib.getLib stdenv.cc.cc)
  ];

  env.ELECTRON_SKIP_BINARY_DOWNLOAD = 1;

  preBuild = ''
    # electron-builder needs a writable electron
    cp -r ${electron.dist} electron-dist
    chmod -R u+w electron-dist

    mkdir -p packages/vkcapture/node_modules/node-addon-api
    tar -xzf ${nodeAddonApi} -C packages/vkcapture/node_modules/node-addon-api --strip-components=1
    (cd packages/vkcapture && node-gyp rebuild --nodedir=${nodejs})
  '';

  buildPhase = ''
    runHook preBuild

    pnpm build
    pnpm exec electron-builder \
      --dir \
      -c.asarUnpack="**/*.node" \
      -c.electronDist=electron-dist \
      -c.electronVersion=${electron.version}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/opt/Hearth
    cp -r dist/*unpacked/resources $out/opt/Hearth/
    install -Dm644 build/icon.svg $out/share/icons/hicolor/scalable/apps/hearth.svg

    runHook postInstall
  '';

  postFixup = ''
    makeWrapper ${electron}/bin/electron $out/bin/hearth \
      --add-flags $out/opt/Hearth/resources/app.asar \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "hearth";
      desktopName = "Hearth";
      exec = "hearth %U";
      icon = "hearth";
      startupWMClass = "hearth";
      genericName = "Internet Messenger";
      comment = packageJson.description;
      keywords = [
        "discord"
        "vencord"
        "hearth"
        "electron"
        "chat"
      ];
      categories = [
        "Network"
        "InstantMessaging"
        "Chat"
      ];
      mimeTypes = [ "x-scheme-handler/discord" ];
    })
  ];

  meta = {
    description = packageJson.description;
    homepage = "https://github.com/hearthdesktop/hearth";
    license = lib.licenses.gpl3Plus;
    mainProgram = "hearth";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})
