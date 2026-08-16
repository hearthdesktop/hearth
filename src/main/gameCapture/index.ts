/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageChannelMain, UtilityProcess, utilityProcess } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "../mainWindow";
import { handle } from "../utils/ipcWrappers";

export interface GameCaptureClient {
    exe: string;
}

let child: UtilityProcess | null = null;
let childReady: Promise<void> | null = null;

function ensureChild() {
    if (child) return childReady!;

    child = utilityProcess.fork(join(__dirname, "gameCaptureHost.js"), [], {
        serviceName: "vesktop-game-capture"
    });

    childReady = new Promise<void>(resolve => {
        child!.once("spawn", () => resolve());
    });

    child.on("exit", () => {
        child = null;
        childReady = null;
    });

    return childReady;
}

function request<T>(message: any, expect: string, timeoutMs = 3000): Promise<T> {
    return ensureChild().then(
        () =>
            new Promise<T>(resolve => {
                const timer = setTimeout(() => {
                    child?.off("message", onMessage);
                    resolve({} as T);
                }, timeoutMs);

                const onMessage = (msg: any) => {
                    if (msg?.type !== expect) return;
                    clearTimeout(timer);
                    child?.off("message", onMessage);
                    resolve(msg as T);
                };

                child!.on("message", onMessage);
                child!.postMessage(message);
            })
    );
}

export async function listGameCaptureClients(): Promise<GameCaptureClient[]> {
    const res = await request<{ clients?: GameCaptureClient[]; error?: string }>({ type: "list" }, "clients");
    if (res.error) console.error("[gameCapture]", res.error);
    return res.clients ?? [];
}

export async function startGameCapture(opts: { exe: string; width: number; height: number; fps: number }) {
    await ensureChild();

    // one port to the capture host, its twin handed to the renderer
    const { port1, port2 } = new MessageChannelMain();
    child!.postMessage({ type: "start", ...opts }, [port1]);
    mainWin.webContents.postMessage(IpcEvents.GAME_CAPTURE_PORT, null, [port2]);

    const res = await new Promise<{ ok?: boolean; error?: string }>(resolve => {
        const onMessage = (msg: any) => {
            if (msg?.type !== "started") return;
            child?.off("message", onMessage);
            resolve(msg);
        };
        child!.on("message", onMessage);
        setTimeout(() => resolve({ ok: false, error: "capture host did not respond" }), 5000);
    });

    if (!res.ok) throw new Error(res.error ?? "failed to start game capture");
}

export function stopGameCapture() {
    child?.postMessage({ type: "stop" });
}

export function registerGameCaptureHandlers() {
    if (process.platform !== "linux") return;

    handle(IpcEvents.GAME_CAPTURE_LIST, () => listGameCaptureClients());
    handle(IpcEvents.GAME_CAPTURE_START, (_e, opts) => startGameCapture(opts));
    handle(IpcEvents.GAME_CAPTURE_STOP, () => stopGameCapture());
}
