/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs in a utilityProcess: the renderer is sandboxed and cannot load native
// modules or open sockets, so the capture lives here and frames are posted to
// the renderer over a MessagePort.

import { join } from "path";
import { STATIC_DIR } from "shared/paths";
import type { CaptureClient, CaptureOptions, FrameMeta } from "vkcapture";

type VkCapture = {
    open(): void;
    clients(): CaptureClient[];
    start(options: CaptureOptions, onFrame: (data: Buffer, meta: FrameMeta) => void): void;
    stop(): void;
    close(): void;
};

let vkcapture: VkCapture | null = null;
let loadError: string | null = null;

function load() {
    if (vkcapture || loadError) return;
    try {
        vkcapture = require(join(STATIC_DIR, `dist/vkcapture-${process.arch}.node`));
    } catch (e) {
        loadError = String(e);
        console.error("[gameCapture] failed to load vkcapture:", e);
    }
}

let socketOpen = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The layer only retries its connection about once a second, so a freshly bound
 * socket looks empty for up to that long. Wait it out on the first open only.
 */
async function collectClients(): Promise<CaptureClient[]> {
    if (!vkcapture) return [];

    const wasOpen = socketOpen;
    vkcapture.open();
    socketOpen = true;

    let clients = vkcapture.clients();
    if (clients.length || wasOpen) return clients;

    for (let waited = 0; waited < 1500 && !clients.length; waited += 100) {
        await sleep(100);
        clients = vkcapture.clients();
    }
    return clients;
}

process.parentPort.on("message", async e => {
    const msg = e.data;

    if (msg?.type === "list") {
        load();
        let clients: CaptureClient[] = [];
        let error = loadError;
        try {
            clients = await collectClients();
        } catch (err) {
            error = String(err);
        }
        process.parentPort.postMessage({ type: "clients", clients, error });
        return;
    }

    if (msg?.type === "start") {
        load();
        const port = e.ports[0];
        if (!vkcapture || !port) {
            process.parentPort.postMessage({ type: "started", ok: false, error: loadError ?? "no port" });
            return;
        }

        try {
            vkcapture.start({ exe: msg.exe, width: msg.width, height: msg.height, fps: msg.fps }, (data, meta) => {
                // MessagePortMain cannot transfer ArrayBuffers, so this is a copy;
                // measured at ~80 MB/s for 720p60, which is affordable
                port.postMessage({ data, meta });
            });
            port.start();
            process.parentPort.postMessage({ type: "started", ok: true });
        } catch (err) {
            process.parentPort.postMessage({ type: "started", ok: false, error: String(err) });
        }
        return;
    }

    if (msg?.type === "stop") {
        // keep the socket bound: dropping it makes every game reconnect, and
        // they only retry once a second, so the next list would come up empty
        vkcapture?.stop();
        return;
    }

    if (msg?.type === "release") {
        // full teardown, so OBS can take the socket back
        vkcapture?.stop();
        vkcapture?.close();
        socketOpen = false;
    }
});
