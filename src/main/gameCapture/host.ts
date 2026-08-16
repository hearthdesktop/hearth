/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
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

process.parentPort.on("message", e => {
    const msg = e.data;

    if (msg?.type === "list") {
        load();
        let clients: CaptureClient[] = [];
        let error = loadError;
        if (vkcapture) {
            try {
                vkcapture.open();
                clients = vkcapture.clients();
            } catch (err) {
                error = String(err);
            }
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
        // also drops the socket, so OBS can take it back while we're idle
        vkcapture?.stop();
        vkcapture?.close();
        return;
    }

    if (msg?.type === "close") {
        vkcapture?.close();
        vkcapture = null;
    }
});
