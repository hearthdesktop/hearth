// Usage: node test.js [exeFilter] [outFile.ppm]
// Launch a game with OBS_VKCAPTURE=1 first, e.g. `OBS_VKCAPTURE=1 vkcube`.
const vk = require("./index.js");
const fs = require("fs");

const want = process.argv[2] ?? "vkcube";
const out = process.argv[3] ?? "/tmp/vkcapture-test.ppm";
const W = 1280,
    H = 720;

function i420ToPpm(buf, w, h, path) {
    const ySize = w * h,
        cSize = (w >> 1) * (h >> 1);
    const rgb = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const Y = buf[y * w + x] - 16;
            const U = buf[ySize + (y >> 1) * (w >> 1) + (x >> 1)] - 128;
            const V = buf[ySize + cSize + (y >> 1) * (w >> 1) + (x >> 1)] - 128;
            const i = (y * w + x) * 3;
            rgb[i] = Math.min(255, Math.max(0, 1.164 * Y + 1.596 * V));
            rgb[i + 1] = Math.min(255, Math.max(0, 1.164 * Y - 0.813 * V - 0.391 * U));
            rgb[i + 2] = Math.min(255, Math.max(0, 1.164 * Y + 2.018 * U));
        }
    }
    fs.writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), rgb]));
}

vk.open();
console.log("listening for game capture clients...");

let started = false;
let frames = 0,
    firstAt = 0,
    last = null;

const scan = setInterval(() => {
    const clients = vk.clients();
    if (clients.length) console.log("clients:", clients.map(c => c.exe).join(", "));
    if (started) return;
    if (!clients.some(c => c.exe.includes(want))) return;

    const target = clients.find(c => c.exe.includes(want));
    started = true;
    console.log(`capturing "${target.exe}" at ${W}x${H}`);

    vk.start({ exe: target.exe, width: W, height: H, fps: 60 }, (data, meta) => {
        if (!frames) {
            firstAt = Date.now();
            console.log("first frame:", data.length, "bytes", meta);
        }
        frames++;
        last = data;
    });

    setTimeout(() => {
        clearInterval(scan);
        const secs = (Date.now() - firstAt) / 1000;
        console.log(`${frames} frames in ${secs.toFixed(2)}s = ${(frames / secs).toFixed(1)} fps`);
        if (last) {
            i420ToPpm(last, W, H, out);
            console.log("wrote", out);
        }
        vk.stop();
        vk.close();
        process.exit(frames > 0 ? 0 : 1);
    }, 6000);
}, 500);

setTimeout(() => {
    console.error(`no client matching "${want}" appeared`);
    vk.close();
    process.exit(1);
}, 30000);
