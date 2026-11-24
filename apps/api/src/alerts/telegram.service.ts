import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type Config } from "../config.js";

/** The Telegram bot. Errors never include the URL: the bot's token is in it. */
@Injectable()
export class TelegramService {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  get enabled() { return !!this.cfg.TELEGRAM_BOT_TOKEN; }

  private async call<T>(method: string, body: unknown = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.TELEGRAM_API_BASE}/bot${this.cfg.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Couldn't reach Telegram");
    }
    const json = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) throw new Error((json?.description ?? `Telegram answered ${res.status}`).slice(0, 200));
    return json.result as T;
  }

  // plain text on purpose: event and booth names can't turn into formatting or links
  send(chatId: string, text: string) { return this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }); }

  async me() { return (await this.call<{ username: string }>("getMe")).username; }

  /** Chats that recently wrote to the bot, so the owner can pick one instead of hunting for its id. */
  async recentChats() {
    type Chat = { id: number; title?: string; username?: string; first_name?: string; type: string };
    const updates = await this.call<{ message?: { chat: Chat }; my_chat_member?: { chat: Chat } }[]>("getUpdates", { limit: 100 });
    const chats = new Map<string, { chatId: string; label: string }>();
    for (const u of updates) {
      const c = u.message?.chat ?? u.my_chat_member?.chat;
      if (c) chats.set(String(c.id), { chatId: String(c.id), label: c.title ?? c.first_name ?? c.username ?? c.type });
    }
    return [...chats.values()];
  }
}
