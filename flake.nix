{
  description = "mc-physics: Euler integration and AABB collision resolution for the nerima-games Minecraft-clone rebuild, with the foot-origin/body-centre Y convention made explicit in the type system. No external physics engine.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # flake.lock is pinned to revision 624af665 (oxlint 1.75.0) rather than
    # whatever nixos-unstable resolves to today: revisions from 2026-08-28
    # onward ship oxlint >=1.79.0, whose `no-redeclare` rule false-positives
    # on the `type X … & Brand` + `const X = Brand.refined(...)` declaration-
    # merge idiom this package uses (verified A/B on an identical tree:
    # 1.75.0 -> 0 warnings, 1.79.0 -> 59). Re-check on the next bump.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 24 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is intentionally supplied by Nix rather than package.json.
          # This keeps the lint executable in the dev shell and CI on one
          # pinned toolchain while package.json remains the source of truth for
          # the Node runtime and package manager.
          #
          # ast-grep covers what oxlint cannot: no-restricted-syntax,
          # no-restricted-properties and no-restricted-globals are unimplemented
          # by the Nix-provided oxlint, so `.ast-grep/rules/` holds the
          # structural gates that a textual lint rule cannot express.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-physics-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}
