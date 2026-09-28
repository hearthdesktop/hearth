/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BuildContext, BuildOptions, context } from "esbuild";
import { copyFile } from "fs/promises";

import vencordDep from "./vencordDep.mjs";
import { includeDirPlugin } from "./includeDirPlugin.mts";

const isDev = process.argv.includes("--dev");

const CommonOpts: BuildOptions = {
    minify: !isDev,
    bundle: true,
    sourcemap: "linked",
    logLevel: "info"
};

const NodeCommonOpts: BuildOptions = {
    ...CommonOpts,
    format: "cjs",
    platform: "node",
    external: ["electron"],
    target: ["esnext"],
    loader: {
        ".node": "file"
    },
    define: {
        IS_DEV: JSON.stringify(isDev)
    }
};

const contexts = [] as BuildContext[];
async function createContext(options: BuildOptions) {
    contexts.push(await context(options));
}

async function copyVenmic() {
    if (process.platform !== "linux") return;

    return Promise.all([
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-x64/node-napi-v7.node",
            "./static/dist/venmic-x64.node"
        ),
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-arm64/node-napi-v7.node",
            "./static/dist/venmic-arm64.node"
        )
    ]).catch(() => console.warn("Failed to copy venmic. Building without venmic support"));
}

async function copyLibHearth() {
    if (process.platform !== "linux") return;

    try {
        await copyFile(
            "./packages/libhearth/build/Release/hearth.node",
            `./static/dist/libhearth-${process.arch}.node`
        );
        console.log("Using local libhearth build");
    } catch {
        console.log(
            "Using prebuilt libhearth binaries. Run `pnpm buildLibHearth` and build again to build from source - see README.md for more details"
        );
        return Promise.all([
            copyFile("./packages/libhearth/prebuilds/libhearth-x64.node", "./static/dist/libhearth-x64.node"),
            copyFile("./packages/libhearth/prebuilds/libhearth-arm64.node", "./static/dist/libhearth-arm64.node")
        ]).catch(() => console.warn("Failed to copy libhearth. Building without libhearth support"));
    }
}

async function copyVkCapture() {
    if (process.platform !== "linux") return;

    try {
        await copyFile(
            "./packages/vkcapture/build/Release/vkcapture.node",
            `./static/dist/vkcapture-${process.arch}.node`
        );
        console.log("Using local vkcapture build");
    } catch {
        return Promise.all([
            copyFile("./packages/vkcapture/prebuilds/vkcapture-x64.node", "./static/dist/vkcapture-x64.node"),
            copyFile("./packages/vkcapture/prebuilds/vkcapture-arm64.node", "./static/dist/vkcapture-arm64.node")
        ]).catch(() => console.warn("Failed to copy vkcapture. Building without game capture support"));
    }
}

await Promise.all([
    copyVenmic(),
    copyLibHearth(),
    copyVkCapture(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=HearthMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/gameCapture/host.ts"],
        outfile: "dist/js/gameCaptureHost.js"
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/arrpc/worker.ts"],
        outfile: "dist/js/arRpcWorker.js",
        footer: { js: "//# sourceURL=HearthArRpcWorker" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js",
        footer: { js: "//# sourceURL=HearthPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/splash.ts"],
        outfile: "dist/js/splashPreload.js",
        footer: { js: "//# sourceURL=HearthSplashPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/updater.ts"],
        outfile: "dist/js/updaterPreload.js",
        footer: { js: "//# sourceURL=HearthUpdaterPreload" }
    }),
    createContext({
        ...CommonOpts,
        globalName: "Hearth",
        entryPoints: ["src/renderer/index.ts"],
        outfile: "dist/js/renderer.js",
        format: "iife",
        inject: ["./scripts/build/injectReact.mjs"],
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        external: ["@vencord/types/*"],
        plugins: [vencordDep, includeDirPlugin("patches", "src/renderer/patches")],
        footer: { js: "window.Vesktop = Hearth;\n//# sourceURL=HearthRenderer" }
    })
]);

const watch = process.argv.includes("--watch");

if (watch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
} else {
    await Promise.all(
        contexts.map(async ctx => {
            await ctx.rebuild();
            await ctx.dispose();
        })
    );
}
