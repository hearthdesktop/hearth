export interface CaptureClient {
    /** Executable name the game reported, e.g. "osu!" or "hl2.exe" */
    exe: string;
}

export interface CaptureOptions {
    /** Capture the client with this exe name; empty means the first one that connects */
    exe?: string;
    /** Rounded down to a multiple of 8 */
    width?: number;
    /** Rounded down to a multiple of 4 */
    height?: number;
    fps?: number;
}

export interface FrameMeta {
    width: number;
    height: number;
    timestampUs: number;
}

/** Bind the capture socket and bring up EGL. Throws if another consumer holds the socket. */
export function open(): void;
/** Games currently connected, whether or not they are being captured. */
export function clients(): CaptureClient[];
/** Begin delivering I420 frames. Calls open() implicitly. */
export function start(options: CaptureOptions, onFrame: (data: Buffer, meta: FrameMeta) => void): void;
/** Change output size or framerate without restarting the session. */
export function reconfigure(options: CaptureOptions): void;
export function stop(): void;
export function close(): void;
