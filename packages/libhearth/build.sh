#!/bin/sh
set -e

docker build -t libhearth-builder -f Dockerfile .

# pnpm hoists node-addon-api to the workspace root, outside the mounted package dir
DEPS="$(dirname "$(dirname "$(node -p "require.resolve('node-addon-api/package.json')")")")"

docker run --rm -v "$PWD":/src -v "$DEPS":/deps:ro -e NODE_PATH=/deps -w /src libhearth-builder bash -c "
  set -e

  echo '=== Building x64 ==='
  npx node-gyp rebuild --arch=x64
  mv build/Release/hearth.node prebuilds/libhearth-x64.node

  echo '=== Building arm64 ==='
  export CXX=aarch64-linux-gnu-g++
  npx node-gyp rebuild --arch=arm64
  mv build/Release/hearth.node prebuilds/libhearth-arm64.node
"