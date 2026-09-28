#!/usr/bin/env bash
# Pushes the PKGBUILD for released version $1 to the hearth-bin AUR package (needs AUR_SSH_PRIVATE_KEY)
set -euo pipefail

version="$1"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_url="https://github.com/hearthdesktop/hearth/releases/download/v${version}"
maintainer="$(jq -r .author "$here/../../package.json")"

sha_of() {
    curl -fsSL "$repo_url/$1" | sha256sum | cut -d' ' -f1
}

work="$(mktemp -d)"
sed -e "s|@VERSION@|${version}|" \
    -e "s|@MAINTAINER@|${maintainer}|" \
    -e "s|@SHA256_X86_64@|$(sha_of "hearth_${version}_amd64.deb")|" \
    -e "s|@SHA256_AARCH64@|$(sha_of "hearth_${version}_arm64.deb")|" \
    "$here/PKGBUILD.in" > "$work/PKGBUILD"

# makepkg refuses to run as root
useradd -m builder
chown -R builder "$work"
su builder -c "cd '$work' && makepkg --printsrcinfo > .SRCINFO"

install -d -m 700 ~/.ssh
printf '%s\n' "$AUR_SSH_PRIVATE_KEY" > ~/.ssh/aur
chmod 600 ~/.ssh/aur
ssh-keyscan -t ed25519 aur.archlinux.org >> ~/.ssh/known_hosts 2>/dev/null
export GIT_SSH_COMMAND="ssh -i ~/.ssh/aur -o IdentitiesOnly=yes"

git clone ssh://aur@aur.archlinux.org/hearth-bin.git "$work/aur"
cp "$work/PKGBUILD" "$work/.SRCINFO" "$work/aur/"
cd "$work/aur"
git config user.name "${maintainer% <*}"
git config user.email "$(sed -E 's/.*<(.*)>.*/\1/' <<< "$maintainer")"
git add PKGBUILD .SRCINFO
if git diff --cached --quiet; then
    echo "hearth-bin is already at ${version}"
    exit 0
fi
git commit -m "Update to ${version}"
git push origin HEAD:master
