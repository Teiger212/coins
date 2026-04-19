// Minimal Webflow Data API v2 client. Only the surface we need: find + upsert
// + archive a single CMS item in the "courses" collection, keyed on the
// course_uuid field.
//
// Docs: https://developers.webflow.com/data/reference/cms/collection-items
// Auth: Bearer site token.

export interface WebflowConfig {
  apiToken: string;
  siteId: string;
  collectionId: string;
}

export class WebflowError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "WebflowError";
  }
}

export interface CourseFieldData {
  name: string;
  slug: string;
  "course-uuid"?: string;
  description?: string;
  about?: string;
  published?: boolean;
}

interface WebflowItem {
  id: string;
  cmsLocaleId?: string;
  lastPublished?: string | null;
  isArchived?: boolean;
  fieldData: Record<string, unknown>;
}

interface ItemsListResponse {
  items: WebflowItem[];
  pagination: { limit: number; offset: number; total: number };
}

export class WebflowClient {
  private readonly base = "https://api.webflow.com/v2";

  constructor(private readonly cfg: WebflowConfig) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.cfg.apiToken}`,
      "Content-Type": "application/json",
      "accept-version": "2.0.0",
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new WebflowError(`${method} ${path} failed`, res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Find the course item by its course_uuid field. */
  async findByCourseUuid(courseUuid: string): Promise<WebflowItem | null> {
    // v2 list endpoint doesn't filter by field value directly; we page
    // through items. For a small site (few dozen courses) this is fine;
    // if it grows we'd add a cache. 100 per page is the max.
    const limit = 100;
    let offset = 0;
    while (true) {
      const path = `/collections/${this.cfg.collectionId}/items?limit=${limit}&offset=${offset}`;
      const page = await this.req<ItemsListResponse>("GET", path);
      for (const item of page.items) {
        if (item.fieldData["course-uuid"] === courseUuid) return item;
      }
      offset += limit;
      if (offset >= page.pagination.total) return null;
    }
  }

  async createItem(fieldData: CourseFieldData): Promise<WebflowItem> {
    const path = `/collections/${this.cfg.collectionId}/items`;
    const body = { isArchived: false, isDraft: false, fieldData };
    return this.req<WebflowItem>("POST", path, body);
  }

  async updateItem(itemId: string, fieldData: Partial<CourseFieldData>): Promise<WebflowItem> {
    const path = `/collections/${this.cfg.collectionId}/items/${itemId}`;
    const body = { fieldData };
    return this.req<WebflowItem>("PATCH", path, body);
  }

  async archiveItem(itemId: string): Promise<WebflowItem> {
    const path = `/collections/${this.cfg.collectionId}/items/${itemId}`;
    return this.req<WebflowItem>("PATCH", path, {
      isArchived: true,
      fieldData: {},
    });
  }

  /** POST /sites/{site_id}/publish — push live so CMS changes are visible. */
  async publishSite(): Promise<void> {
    await this.req<unknown>("POST", `/sites/${this.cfg.siteId}/publish`, {
      publishToWebflowSubdomain: true,
    });
  }
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks (Hebrew + Latin both)
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "course"
  );
}
