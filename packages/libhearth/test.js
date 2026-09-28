/**
 * @type {typeof import(".")}
 */
const libHearth = require(".");
const test = require("node:test");
const assert = require("node:assert/strict");

test("getAccentColor should return a number", () => {
    const color = libHearth.getAccentColor();
    assert.strictEqual(typeof color, "number");
});

test("updateUnityLauncherCount should return true (success)", () => {
    assert.strictEqual(libHearth.updateUnityLauncherCount(5), true);
    assert.strictEqual(libHearth.updateUnityLauncherCount(0), true);
    assert.strictEqual(libHearth.updateUnityLauncherCount(10), true);
});

test("requestBackground should return true (success)", () => {
    assert.strictEqual(libHearth.requestBackground(true, ["bash"]), true);
    assert.strictEqual(libHearth.requestBackground(false, []), true);
});
