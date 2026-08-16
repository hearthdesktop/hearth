#!/bin/sh
set -e

docker build -t vkcapture-builder -f Dockerfile .

docker run --rm -v "$PWD":/src -w /src vkcapture-builder bash -c "
  set -e
  mkdir -p prebuilds

  echo '=== Building x64 ==='
  npx node-gyp rebuild --arch=x64
  mv build/Release/vkcapture.node prebuilds/vkcapture-x64.node

  echo '=== Building arm64 ==='
  export CXX=aarch64-linux-gnu-g++
  export PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
  npx node-gyp rebuild --arch=arm64
  mv build/Release/vkcapture.node prebuilds/vkcapture-arm64.node
"
