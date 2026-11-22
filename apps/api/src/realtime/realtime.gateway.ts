import { Inject, Logger } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service.js";
import { SESSION_COOKIE } from "../auth/tokens.js";
import { CONFIG, type Config } from "../config.js";

const ADMINS = "admins";

const cookieValue = (header: string | undefined, name: string) =>
  header?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];

// Pushes booth changes to open admin pages. Only signed-in admins may connect, and only from
// our own site: the Origin check stops another website from opening a socket with the cookie.
// addTrailingSlash: false also matches "/socket.io?…": the Next rewrite drops the slash.
@WebSocketGateway({ path: "/socket.io", serveClient: false, addTrailingSlash: false })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger("Realtime");

  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly cfg: Config) {}

  async handleConnection(client: Socket) {
    const { origin, cookie } = client.handshake.headers;
    // Browsers always send Origin on cross-site WebSocket/XHR handshakes, but not on same-origin
    // polling GETs. So: refuse a foreign Origin; no Origin means same-site (or not a browser).
    const sameSite = origin === undefined || origin === this.cfg.APP_ORIGIN;
    const admin = sameSite ? await this.auth.resolve(cookieValue(cookie, SESSION_COOKIE)) : null;
    if (!admin) {
      client.emit("unauthorized");
      client.disconnect(true);
      return;
    }
    await client.join(ADMINS);
  }

  /** Something about these booths changed; admins re-read them. */
  boothsChanged(payload: unknown) {
    try {
      this.server?.to(ADMINS).emit("booths", payload);
    } catch (e) {
      this.log.warn(`emit failed: ${(e as Error).message}`);
    }
  }
}
