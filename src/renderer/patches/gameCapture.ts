/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";

const logger = new Logger("VesktopGameCapture");

interface FrameMessage {
    data: Uint8Array;
    meta: { width: number; height: number; timestampUs: number };
}

// The port arrives from the preload, which relays it out of the isolated world
let pendingPort: MessagePort | null = null;
const portResolvers: ((port: MessagePort) => void)[] = [];

window.addEventListener("message", e => {
    if (e.source !== window || e.data?.type !== "VESKTOP_GAME_CAPTURE_PORT") return;
    const port = e.ports[0];
    const waiting = portResolvers.splice(0);
    if (waiting.length) waiting.forEach(r => r(port));
    else pendingPort = port;
});

/**
 * Every start() posts a fresh port, so a leftover one from a previous session
 * (the preview grab, say) has to be dropped rather than handed out again.
 */
function awaitPort(timeoutMs = 5000): Promise<MessagePort> {
    pendingPort?.close();
    pendingPort = null;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("capture port never arrived")), timeoutMs);
        portResolvers.push(port => {
            clearTimeout(timer);
            resolve(port);
        });
    });
}

export interface GameCaptureOptions {
    exe: string;
    width: number;
    height: number;
    fps: number;
    audio?: boolean;
    contentHint?: string;
}

/**
 * Frames come from the game's own swapchain rather than the compositor, so a
 * fullscreen game keeps direct scanout while sharing.
 */
export async function createGameCaptureStream(opts: GameCaptureOptions): Promise<MediaStream> {
    if (typeof MediaStreamTrackGenerator === "undefined")
        throw new Error("this build of Electron has no MediaStreamTrackGenerator");

    const portArrival = awaitPort();
    await VesktopNative.gameCapture.start({
        exe: opts.exe,
        width: opts.width,
        height: opts.height,
        fps: opts.fps
    });
    const port = await portArrival;

    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    generator.contentHint = opts.contentHint ?? "motion";
    const writer = generator.writable.getWriter();

    let base = 0;
    let dropped = 0;
    let written = 0;

    port.onmessage = (e: MessageEvent<FrameMessage>) => {
        const { data, meta } = e.data;
        if (generator.readyState !== "live") return;

        // never queue: a late frame is worth less than a fresh one
        if (writer.desiredSize !== null && writer.desiredSize <= 0) {
            dropped++;
            return;
        }

        if (!base) base = meta.timestampUs;

        try {
            const frame = new VideoFrame(data, {
                format: "I420",
                codedWidth: meta.width,
                codedHeight: meta.height,
                timestamp: meta.timestampUs - base
            });
            writer.write(frame).catch(() => frame.close());
            written++;
        } catch (err) {
            logger.error("failed to build VideoFrame", err);
        }
    };
    port.start();

    generator.addEventListener("ended", () => {
        logger.info(`capture ended after ${written} frames (${dropped} dropped for backpressure)`);
        port.close();
        VesktopNative.gameCapture.stop();
    });

    const stream = new MediaStream([generator]);

    // mirror the audio behaviour of the normal screenshare path
    if (opts.audio === false) return stream;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const virtmic = devices.find(({ label }) => label === "vencord-screen-share");
        if (virtmic) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: virtmic.deviceId },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    sampleSize: 16
                }
            });
            audio.getAudioTracks().forEach(t => stream.addTrack(t));
        }
    } catch (err) {
        logger.warn("no screenshare audio source", err);
    }

    return stream;
}
