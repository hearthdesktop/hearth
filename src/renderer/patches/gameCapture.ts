/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { MediaEngineStore } from "@vencord/types/webpack/common";
import { waitForVirtmicDevice } from "renderer/utils";

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

const ADAPT_INTERVAL_MS = 2000;
const MIN_HEIGHT = 180;

function fitToPixels(pixels: number, max: { width: number; height: number }) {
    const aspect = max.width / max.height;
    let height = Math.round(Math.sqrt(Math.max(pixels, 1) / aspect));
    height = Math.min(Math.max(height, MIN_HEIGHT), max.height);
    height -= height % 4;
    let width = Math.min(Math.round(height * aspect), max.width);
    width -= width % 8;
    return { width, height };
}

async function limitationReason(conn: any): Promise<string> {
    let reason = "none";
    try {
        const stats = await conn.pc?.getStats?.();
        stats?.forEach((r: any) => {
            if (r.type === "outbound-rtp" && r.kind === "video") reason = r.qualityLimitationReason ?? "none";
        });
    } catch {}
    return reason;
}

/**
 * WebRTC normally tells a source to produce smaller frames when the viewer is
 * windowed or the encoder is struggling. A MediaStreamTrackGenerator has no
 * source to push back on, so those wants land nowhere and Discord ends up
 * encoding full resolution for a thumbnail. Forward them to the capture instead.
 */
function startAdaptation(track: MediaStreamTrack, max: { width: number; height: number; fps: number }) {
    let applied = { ...max };
    let cpuStrikes = 0;
    let healthyTicks = 0;

    const timer = setInterval(async () => {
        if (track.readyState !== "live") {
            clearInterval(timer);
            return;
        }

        // the vencord types don't describe the sink wants discord keeps here
        const conn = [...MediaEngineStore.getMediaEngine().connections].find((c: any) => c.context === "stream") as any;
        if (!conn) return;

        const counts = Object.values(conn.remoteVideoSinkWants?.pixelCounts ?? {}) as number[];
        const wanted = counts.length ? Math.max(...counts) : 0;
        const reason = await limitationReason(conn);

        // nobody is watching yet, so stay small rather than encoding for no one
        const idlePixels = MIN_HEIGHT * MIN_HEIGHT * (max.width / max.height);
        const target = fitToPixels(wanted > 0 ? wanted : idlePixels, max);

        cpuStrikes = reason === "cpu" ? cpuStrikes + 1 : 0;
        healthyTicks = reason === "none" ? healthyTicks + 1 : 0;

        let { fps } = applied;
        if (cpuStrikes >= 2 && fps > 30) fps = 30;
        else if (healthyTicks >= 3 && fps < max.fps) fps = max.fps;

        const heightChange = Math.abs(target.height - applied.height) / applied.height;
        if (heightChange < 0.2 && fps === applied.fps) return;

        applied = { ...target, fps };
        logger.info(
            `adapting capture to ${applied.width}x${applied.height}@${applied.fps} (viewer wants ${wanted}px, limited by ${reason})`
        );
        VesktopNative.gameCapture.reconfigure(applied);
    }, ADAPT_INTERVAL_MS);

    track.addEventListener("ended", () => clearInterval(timer));
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
    startAdaptation(generator, { width: opts.width, height: opts.height, fps: opts.fps });

    // mirror the audio behaviour of the normal screenshare path
    if (opts.audio === false) return stream;

    try {
        const virtmic = await waitForVirtmicDevice();
        if (!virtmic) {
            logger.warn("virtmic device never appeared, sharing without audio");
        } else {
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
        logger.warn("could not attach screenshare audio", err);
    }

    return stream;
}
