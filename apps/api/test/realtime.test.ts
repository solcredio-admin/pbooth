import { describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { base, call as rawCall, login as rawLogin, ORIGIN, type CallInit } from "./helpers.js";

const IP = "10.0.3.1";
const call = (path: string, init: CallInit = {}) => rawCall(path, { ip: IP, ...init });
const server = base?.replace(/\/api\/v1$/, "");

// Resolves with "connected" (and the socket) or "rejected" when the server kicks us out.
function connect(headers: Record<string, string>): Promise<{ result: "connected" | "rejected"; socket: Socket }> {
  return new Promise((resolve) => {
    const socket = io(server!, { path: "/socket.io", transports: ["websocket"], extraHeaders: headers, reconnection: false });
    socket.on("unauthorized", () => resolve({ result: "rejected", socket }));
    socket.on("disconnect", () => resolve({ result: "rejected", socket }));
    socket.on("connect", () => setTimeout(() => socket.connected && resolve({ result: "connected", socket }), 300));
    socket.on("connect_error", () => resolve({ result: "rejected", socket }));
  });
}

describe.skipIf(!base)("live updates (Socket.IO)", () => {
  it("rejects sockets without a session", async () => {
    const { result, socket } = await connect({ origin: ORIGIN });
    socket.close();
    expect(result).toBe("rejected");
  });

  it("rejects a valid session coming from another website", async () => {
    const cookie = await rawLogin(IP);
    const { result, socket } = await connect({ origin: "https://evil.example", cookie });
    socket.close();
    expect(result).toBe("rejected");
  });

  it("pushes booth changes to signed-in admins", async () => {
    const cookie = await rawLogin(IP);
    const { result, socket } = await connect({ origin: ORIGIN, cookie });
    expect(result).toBe("connected");
    const pushed = new Promise<{ booths: { name: string }[] }>((resolve) => socket.on("booths", resolve));
    await call("/booths", { method: "POST", body: { name: "Pushed Booth" }, cookie });
    const msg = await pushed;
    socket.close();
    expect(msg.booths[0].name).toBe("Pushed Booth");
  });
});
