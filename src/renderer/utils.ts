/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord deletes this from the window so we need to capture it in a variable
export const { localStorage } = window;

export const isFirstRun = (() => {
    const key = "VCD_FIRST_RUN";
    if (localStorage.getItem(key) !== null) return false;
    localStorage.setItem(key, "false");
    return true;
})();

const { platform } = navigator;

export const isWindows = platform.startsWith("Win");
export const isMac = platform.startsWith("Mac");
export const isLinux = platform.startsWith("Linux");

export const VIRTMIC_LABEL = "vencord-screen-share";

/**
 * venmic creates its node when the stream is submitted, and chromium only
 * exposes it on the next devicechange - enumerating right away finds nothing,
 * which silently costs you the audio track.
 */
export function waitForVirtmicDevice(timeoutMs = 3000): Promise<MediaDeviceInfo | null> {
    const find = async () =>
        (await navigator.mediaDevices.enumerateDevices()).find(d => d.label === VIRTMIC_LABEL) ?? null;

    return new Promise(resolve => {
        const onChange = async () => {
            const device = await find();
            if (!device) return;
            cleanup();
            resolve(device);
        };

        const cleanup = () => {
            clearTimeout(timer);
            navigator.mediaDevices.removeEventListener("devicechange", onChange);
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve(null);
        }, timeoutMs);

        navigator.mediaDevices.addEventListener("devicechange", onChange);

        find().then(device => {
            if (!device) return;
            cleanup();
            resolve(device);
        });
    });
}
