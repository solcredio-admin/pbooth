import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG, type Config } from "../config.js";
import { ApiError } from "../common/errors.js";

/**
 * PayMongo QR Ph, server side only (the secret key never reaches a booth). A QR is a payment intent
 * that allows "qrph", with a qrph payment method attached; whether it's paid is always read back from
 * PayMongo (the intent's status and amount), never taken from a webhook body or a kiosk.
 */
@Injectable()
export class PaymongoService {
  private readonly log = new Logger("PayMongo");
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  get enabled() { return !!this.cfg.PAYMONGO_SECRET_KEY; }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.cfg.PAYMONGO_SECRET_KEY) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "QR_NOT_CONFIGURED", "QR payment isn't set up on the server");
    const res = await fetch(`${this.cfg.PAYMONGO_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.PAYMONGO_SECRET_KEY}:`).toString("base64")}`,
        "content-type": "application/json", accept: "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => { throw new ApiError(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_DOWN", `Couldn't reach PayMongo (${e.name})`); });
    const json = await res.json().catch(() => null) as { data?: unknown; errors?: { detail?: string }[] } | null;
    if (!res.ok) {
      this.log.warn(`${method} ${path} → ${res.status} ${json?.errors?.[0]?.detail ?? ""}`);
      // 5xx: it may or may not have happened. 4xx: it definitely didn't.
      if (res.status >= 500) throw new ApiError(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_DOWN", "PayMongo had a problem; try again");
      throw new ApiError(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", `PayMongo refused the request${json?.errors?.[0]?.detail ? `: ${json.errors[0].detail.slice(0, 200)}` : ""}`);
    }
    return json as T;
  }

  /** A QR for exactly `amountCentavos`, valid for the configured time. */
  async createQr(amountCentavos: number, description: string) {
    type Intent = { data: { id: string; attributes: { client_key?: string; next_action?: { code?: { image_url?: string } } } } };
    const intent = await this.call<Intent>("POST", "/payment_intents", {
      data: { attributes: { amount: amountCentavos, currency: "PHP", payment_method_allowed: ["qrph"], capture_type: "automatic", description } },
    });
    const method = await this.call<{ data: { id: string } }>("POST", "/payment_methods", {
      data: { attributes: { type: "qrph", expiry_seconds: this.cfg.PAYMONGO_QR_SECONDS } },
    });
    const attached = await this.call<Intent>("POST", `/payment_intents/${intent.data.id}/attach`, {
      data: { attributes: { payment_method: method.data.id, client_key: intent.data.attributes.client_key } },
    });
    const img = attached.data.attributes.next_action?.code?.image_url;
    if (!img) throw new ApiError(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "PayMongo didn't return a QR code");
    return {
      intentId: intent.data.id,
      qr: img.startsWith("data:") ? img : `data:image/png;base64,${img}`, // docs: a Base64 string, sometimes already a data URI
      expiresAt: new Date(Date.now() + this.cfg.PAYMONGO_QR_SECONDS * 1000),
    };
  }

  /** The intent as PayMongo has it now: "succeeded" means paid. */
  async status(intentId: string) {
    const r = await this.call<{ data: { attributes: { status: string; amount: number; currency: string } } }>("GET", `/payment_intents/${encodeURIComponent(intentId)}`);
    return r.data.attributes;
  }

  /**
   * Sends a full refund. Safe to repeat with the same key (PayMongo's Idempotency-Key), and PayMongo
   * never refunds more than was paid. A QR Ph refund comes with a link the guest opens to get the money.
   */
  async refund(intentId: string, amountCentavos: number, key: string) {
    const intent = await this.call<{ data: { attributes: { payments?: { id: string; attributes?: { status?: string } }[] } } }>("GET", `/payment_intents/${encodeURIComponent(intentId)}`);
    const pays = intent.data.attributes.payments ?? [];
    const pay = pays.find((p) => p.attributes?.status === "paid") ?? pays[0];
    if (!pay) throw new ApiError(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "PayMongo has no payment to refund");
    const r = await this.call<RefundReply>("POST", "/refunds", { data: { attributes: { amount: amountCentavos, payment_id: pay.id, reason: "others" } } }, key);
    return this.readRefund(r);
  }

  async refundStatus(refundId: string) {
    return this.readRefund(await this.call<RefundReply>("GET", `/refunds/${encodeURIComponent(refundId)}`));
  }

  private readRefund(r: RefundReply) {
    const link = r.data.attributes.transfer_link;
    // only an https link is ever shown to a guest
    return { id: r.data.id, status: r.data.attributes.status, link: link?.startsWith("https://") ? link : null };
  }
}

interface RefundReply { data: { id: string; attributes: { status: string; transfer_link?: string | null } } }
