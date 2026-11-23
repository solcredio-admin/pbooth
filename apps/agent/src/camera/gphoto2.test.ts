import { describe, expect, it } from "vitest";
import { explain, JpegSplitter, parseAutoDetect, parseConfig, parseSaved } from "./gphoto2.js";
import { compatibilityFor } from "./registry.js";

describe("gphoto2 output parsing", () => {
  it("reads --auto-detect", () => {
    const out = "Model                          Port\n----------------------------------------------------------\nCanon EOS R50                  usb:001,004\nNikon DSC D3500                usb:002,007\n";
    expect(parseAutoDetect(out)).toEqual([
      { name: "Canon EOS R50", id: "usb:001,004", provider: "gphoto2" },
      { name: "Nikon DSC D3500", id: "usb:002,007", provider: "gphoto2" },
    ]);
    expect(parseAutoDetect("Model   Port\n-----\n")).toEqual([]);
  });

  it("finds the saved file, preferring JPEG over RAW", () => {
    const out = "New file is in location /capt0000.cr3 on the camera\nSaving file as /tmp/p/capture-1.cr3\nNew file is in location /capt0001.jpg on the camera\nSaving file as /tmp/p/capture-1.jpg\n";
    expect(parseSaved(out)[0]).toBe("/tmp/p/capture-1.jpg");
  });

  it("reads a config value", () => {
    expect(parseConfig("Label: ISO Speed\nReadonly: 0\nType: RADIO\nCurrent: 400\nChoice: 0 Auto\nChoice: 1 100\nChoice: 2 400\nEND\n"))
      .toEqual({ current: "400", choices: ["Auto", "100", "400"] });
    expect(parseConfig("*** Error: not found ***")).toBeNull();
  });

  it("explains common failures in plain words", () => {
    expect(explain("*** Error (-53: 'Could not claim the USB device') ***")).toMatch(process.platform === "darwin" ? /Photos or Image Capture/ : /gio mount -s gphoto2/);
    expect(explain("*** Error: No camera found. ***")).toMatch(/No camera found/);
  });

  it("splits a stream of JPEGs into frames, across chunk boundaries", () => {
    const frames: number[] = [];
    const s = new JpegSplitter((f) => frames.push(f.length));
    const a = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const b = Buffer.from([0xff, 0xd8, 9, 9, 0xff, 0xd9]);
    const all = Buffer.concat([Buffer.from([0]), a, b]);
    s.push(all.subarray(0, 5)); s.push(all.subarray(5, 10)); s.push(all.subarray(10));
    expect(frames).toEqual([7, 6]);
  });
});

describe("compatibility registry", () => {
  it("never calls anything tested yet", () => {
    expect(compatibilityFor("Canon EOS R50", "linux").tested).toBe("untested");
    expect(compatibilityFor("Some Unknown Cam", "linux").tested).toBe("untested");
    expect(compatibilityFor("Canon EOS R50", "windows").tested).toBe("unsupported");
  });
});
