/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { join } from "path";
import { STATIC_DIR } from "shared/paths";

let libHearth: typeof import("libhearth") | null = null;

function loadLibHearth() {
    try {
        if (!libHearth) {
            libHearth = require(join(STATIC_DIR, `dist/libhearth-${process.arch}.node`));
        }
    } catch (e) {
        console.error("Failed to load libhearth:", e);
    }

    return libHearth;
}

export function getAccentColor() {
    return loadLibHearth()?.getAccentColor() ?? null;
}

export function updateUnityLauncherCount(count: number) {
    const libHearth = loadLibHearth();
    if (!libHearth) {
        return app.setBadgeCount(count);
    }

    return libHearth.updateUnityLauncherCount(count);
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibHearth()?.requestBackground(autoStart, commandLine) ?? false;
}
