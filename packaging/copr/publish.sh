#!/usr/bin/env bash
# Builds a source RPM for released version $1 and submits it to COPR (needs COPR_CONFIG and COPR_PROJECT)
set -euo pipefail

version="$1"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
top="$(mktemp -d)"

mkdir -p "$top/SPECS" "$top/SOURCES" ~/.config
sed "s|@VERSION@|${version}|" "$here/hearth.spec.in" > "$top/SPECS/hearth.spec"
spectool -g -C "$top/SOURCES" "$top/SPECS/hearth.spec"
rpmbuild -bs --define "_topdir $top" "$top/SPECS/hearth.spec"

printf '%s\n' "$COPR_CONFIG" > ~/.config/copr
copr-cli build "$COPR_PROJECT" "$top"/SRPMS/hearth-*.src.rpm --nowait
