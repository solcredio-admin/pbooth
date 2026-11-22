"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CameraSettings {
  provider: "webcam" | "gphoto2";
  deviceName: string | null;
  resolution: "auto" | "720p" | "1080p" | "4k";
  orientation: "landscape" | "portrait";
  mirrorPreview: boolean;
}

export type CamStatus = "idle" | "starting" | "connected" | "disconnected" | "permission-denied" | "error" | "insecure";
export interface CamState { status: CamStatus; name?: string; resolution?: string; error?: string }

// Resolutions are requests ("ideal"), never demands: browsers pick the closest the camera has.
const SIZES = { "720p": [1280, 720], "1080p": [1920, 1080], "4k": [3840, 2160], auto: [3840, 2160] } as const;
const RETRY_MS = 3000;

type ImageCaptureCtor = new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };

/**
 * A USB webcam through the browser's camera APIs: choose the configured device, start it,
 * detect unplugging, reconnect by itself, and capture full-size stills.
 */
export function useWebcam(cfg: CameraSettings | null, enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<CamState>({ status: "idle" });
  const [cameras, setCameras] = useState<{ id: string; name: string }[]>([]);
  const want = cfg && enabled && cfg.provider === "webcam";
  const key = want ? `${cfg.deviceName}|${cfg.resolution}` : "off";

  const stop = useCallback(() => {
    clearTimeout(retryRef.current);
    streamRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    streamRef.current = null;
  }, []);

  const listCameras = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    // Labels are only visible after camera permission is granted.
    const list = all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}` }));
    setCameras(list);
    return list;
  }, []);

  const start = useCallback(async () => {
    if (!cfg) return;
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState({ status: "insecure", error: "The camera needs HTTPS (or localhost)." });
      return;
    }
    setState((s) => ({ ...s, status: "starting" }));
    const [width, height] = SIZES[cfg.resolution];
    const pick = cfg.deviceName ? (await listCameras()).find((c) => c.name === cfg.deviceName) : undefined;
    const attempt = (deviceId?: string) => navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: width }, height: { ideal: height } },
    });
    try {
      let stream: MediaStream;
      try {
        stream = await attempt(pick?.id);
      } catch (e) {
        // The chosen camera vanished or can't do it: fall back to any camera rather than none.
        if (pick && ["NotFoundError", "OverconstrainedError"].includes((e as DOMException).name)) stream = await attempt();
        else throw e;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track.onended = () => { setState((s) => ({ ...s, status: "disconnected", error: "Camera disconnected" })); retryRef.current = setTimeout(start, RETRY_MS); };
      const s = track.getSettings();
      setState({ status: "connected", name: track.label || "Camera", resolution: s.width && s.height ? `${s.width}x${s.height}` : undefined });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      await listCameras();
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState({ status: "permission-denied", error: "Camera permission denied" });
        return; // a person has to fix this; retrying would just fail again
      }
      const error = name === "NotReadableError" ? "The camera is in use by another app" : name === "NotFoundError" ? "No camera found" : `Camera error (${name || "unknown"})`;
      setState({ status: name === "NotFoundError" ? "disconnected" : "error", error });
      retryRef.current = setTimeout(start, RETRY_MS);
    }
  }, [cfg, listCameras, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!want) { stop(); setState({ status: "idle" }); return; }
    start();
    // Plugging a camera back in: try again straight away instead of waiting for the retry.
    const onChange = () => { listCameras().catch(() => undefined); if (streamRef.current?.getVideoTracks()[0]?.readyState !== "live") start(); };
    navigator.mediaDevices?.addEventListener("devicechange", onChange);
    return () => { navigator.mediaDevices?.removeEventListener("devicechange", onChange); stop(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-attach the stream when the <video> element is re-mounted by a screen change.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as { current: HTMLVideoElement | null }).current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => undefined);
    }
  }, []);

  /** A full-resolution still as JPEG, cropped to the booth's orientation. Never mirrored. */
  const capture = useCallback(async (): Promise<Blob> => {
    const track = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || track.readyState !== "live" || !video) throw new Error("Camera not ready");
    let source: CanvasImageSource = video;
    let sw = video.videoWidth, sh = video.videoHeight;
    const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    if (IC) {
      try {
        // Chromium can return a still at the sensor's full resolution, sharper than a video frame.
        const bmp = await createImageBitmap(await new IC(track).takePhoto());
        source = bmp; sw = bmp.width; sh = bmp.height;
      } catch { /* some cameras refuse takePhoto(): use the video frame */ }
    }
    let cw = sw, ch = sh, sx = 0, sy = 0;
    const portrait = cfg?.orientation === "portrait";
    if (portrait && sw > sh) { cw = Math.round(sh * 2 / 3); sx = Math.round((sw - cw) / 2); }
    if (!portrait && sh > sw) { ch = Math.round(sw * 2 / 3); sy = Math.round((sh - ch) / 2); }
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d")!.drawImage(source, sx, sy, cw, ch, 0, 0, cw, ch);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/jpeg", 0.92));
  }, [cfg?.orientation]);

  return { attach, state, cameras, capture, retry: start };
}
