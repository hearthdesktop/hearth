{
  description = "Hearth, a custom Discord desktop app with Vencord preinstalled";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    {
      packages = forAllSystems (system: {
        hearth = nixpkgs.legacyPackages.${system}.callPackage ./packaging/nix/package.nix { };
        default = self.packages.${system}.hearth;
      });

      overlays.default = final: _prev: {
        hearth = final.callPackage ./packaging/nix/package.nix { };
      };
    };
}
