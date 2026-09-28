/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { openGameCapturePicker } from "renderer/components/GameCapturePicker";
import { currentSettings, openScreenSharePicker } from "renderer/components/ScreenSharePicker";
import { createGameCaptureStream } from "renderer/patches/gameCapture";
import { State } from "renderer/settings";
import { isLinux, waitForVirtmicDevice } from "renderer/utils";

const logger = new Logger("VesktopStreamFixes");

if (isLinux) {
    const original = navigator.mediaDevices.getDisplayMedia;

    async function getVirtmic() {
        try {
            const audioDevice = await waitForVirtmicDevice();
            if (!audioDevice) logger.warn("virtmic device never appeared, sharing without audio");
            return audioDevice?.deviceId;
        } catch (error) {
            return null;
        }
    }

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        // Offer game capture first, but only when a game is actually running with
        // the capture layer loaded - otherwise nothing about this flow changes.
        const games = await VesktopNative.gameCapture.list().catch(() => []);
        if (games.length) {
            const pick = await openGameCapturePicker(games).catch(() => null);
            if (!pick) {
                VesktopNative.gameCapture.stop();
                throw new DOMException("Permission denied", "NotAllowedError");
            }
            if (pick.type === "desktop") VesktopNative.gameCapture.stop();

            if (pick.type === "game") {
                // a small live capture drives the preview while the settings modal is
                // open; the real one starts from scratch once the user commits
                const preview = await createGameCaptureStream({
                    exe: pick.exe,
                    width: 960,
                    height: 540,
                    fps: 30,
                    audio: false
                }).catch(err => {
                    logger.error("game preview failed", err);
                    return null;
                });

                // reuse Hearth's own settings step, so quality, content hint and
                // the venmic audio sources all behave exactly as they do normally
                let streamSettings: Awaited<ReturnType<typeof openScreenSharePicker>> | null = null;
                try {
                    streamSettings = await openScreenSharePicker(
                        [
                            {
                                id: `vesktop-game:${pick.exe}`,
                                name: pick.exe,
                                url: "",
                                stream: preview ?? undefined,
                                audioHint: pick.exe
                            }
                        ],
                        true,
                        `Share ${pick.exe}`
                    );
                } catch {
                    streamSettings = null;
                } finally {
                    // stop() on a generator track doesn't necessarily fire "ended",
                    // so tell the capture host directly rather than relying on it
                    preview?.getTracks().forEach(t => t.stop());
                    if (preview) VesktopNative.gameCapture.stop();
                }

                if (!streamSettings) {
                    VesktopNative.gameCapture.stop();
                    throw new DOMException("Permission denied", "NotAllowedError");
                }

                const height = Number(State.store.screenshareQuality?.resolution ?? 720);
                return createGameCaptureStream({
                    exe: pick.exe,
                    width: Math.round(height * (16 / 9)),
                    height,
                    fps: Number(State.store.screenshareQuality?.frameRate ?? 30),
                    audio: streamSettings.audio,
                    contentHint: streamSettings.contentHint
                });
            }
        }

        const stream = await original.call(this, opts);
        const id = await getVirtmic();

        const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 30);
        const height = Number(State.store.screenshareQuality?.resolution ?? 720);
        const width = Math.round(height * (16 / 9));
        const track = stream.getVideoTracks()[0];

        track.contentHint = String(currentSettings?.contentHint);

        const constraints = {
            ...track.getConstraints(),
            frameRate: { min: frameRate, ideal: frameRate },
            width: { min: 640, ideal: width, max: width },
            height: { min: 480, ideal: height, max: height },
            advanced: [{ width: width, height: height }],
            resizeMode: "none"
        };

        track
            .applyConstraints(constraints)
            .then(() => {
                logger.info("Applied constraints successfully. New constraints: ", track.getConstraints());
            })
            .catch(e => logger.error("Failed to apply constraints.", e));

        if (id) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: {
                        exact: id
                    },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    sampleSize: 16
                }
            });

            stream.getAudioTracks().forEach(t => stream.removeTrack(t));
            stream.addTrack(audio.getAudioTracks()[0]);
        }

        return stream;
    };
}
