export interface MailchimpConfig {
  apiKey: string;
  listId: string;
  serverPrefix: string;
}

export class MailchimpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "MailchimpError";
  }
}

export function parseServerPrefix(apiKey: string): string {
  const idx = apiKey.lastIndexOf("-");
  if (idx === -1) throw new Error("Mailchimp API key must end with -<dc> (e.g. us21)");
  return apiKey.slice(idx + 1);
}

export class MailchimpClient {
  private readonly base: string;

  constructor(private readonly cfg: MailchimpConfig) {
    this.base = `https://${cfg.serverPrefix}.api.mailchimp.com/3.0`;
  }

  private headers(): HeadersInit {
    const token = Buffer.from(`anystring:${this.cfg.apiKey}`).toString("base64");
    return {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    };
  }

  /** Subscriber hashes are MD5 of the lowercased email. */
  private async memberHash(email: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(email.toLowerCase());
    return hasher.digest("hex");
  }

  /**
   * PUT /lists/{list_id}/members/{subscriber_hash} — upserts a subscriber.
   * Using PUT + the hash makes this idempotent: safe to retry on webhook replay.
   */
  async upsertMember(args: {
    email: string;
    firstName?: string;
    lastName?: string;
    tags?: string[];
    status?: "subscribed" | "pending";
  }): Promise<void> {
    const hash = await this.memberHash(args.email);
    const url = `${this.base}/lists/${this.cfg.listId}/members/${hash}`;
    const body = {
      email_address: args.email,
      status_if_new: args.status ?? "subscribed",
      merge_fields: {
        ...(args.firstName ? { FNAME: args.firstName } : {}),
        ...(args.lastName ? { LNAME: args.lastName } : {}),
      },
      ...(args.tags ? { tags: args.tags } : {}),
    };
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new MailchimpError(`upsertMember failed`, res.status, text);
    }
  }

  /** POST /lists/{list_id}/members/{subscriber_hash}/tags — add tags without replacing existing. */
  async addTags(args: { email: string; tags: string[] }): Promise<void> {
    const hash = await this.memberHash(args.email);
    const url = `${this.base}/lists/${this.cfg.listId}/members/${hash}/tags`;
    const body = {
      tags: args.tags.map((name) => ({ name, status: "active" })),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new MailchimpError(`addTags failed`, res.status, text);
    }
  }
}
