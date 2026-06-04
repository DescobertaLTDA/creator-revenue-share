import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Unescape common JSON/HTML encodings in a URL string */
function unescapeUrl(s: string): string {
  return s
    .replace(/\\u0026/g, "&")
    .replace(/\\u003F/g, "?")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

/** Score an Instagram CDN URL: higher = better (larger, less cropped).
 *  We prefer URLs whose stp param contains a portrait/landscape ratio
 *  over square crops (s{n}x{n} where both dims match).
 */
function scoreInstagramUrl(url: string): number {
  // Penalise square crops like s1080x1080, s640x640
  if (/s(\d+)x\1(?:&|_|$)/.test(url)) return 0;
  // Boost if height > width (portrait), e.g. 1080x1350 in stp param
  const dimMatch = url.match(/[._](\d+)[\._](\d+)[a_]/);
  if (dimMatch) {
    const [, w, h] = dimMatch;
    const score = parseInt(w) * parseInt(h);
    return score > 0 ? score : 1;
  }
  // Generic CDN URL with no known crop params — OK fallback
  return 1;
}

/**
 * Try to extract the best (least-cropped) image URL from Instagram HTML.
 *
 * Strategy (in priority order):
 * 1. JSON-LD image objects — sometimes contain the full image URL.
 * 2. All Instagram CDN URLs found in the raw HTML — pick the highest-scoring
 *    (non-square) one.
 * 3. og:image meta tag — always present but usually a square crop.
 */
function extractBestImage(html: string): string | null {
  // ── 1. JSON-LD ──────────────────────────────────────────────────────────
  const ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatches) {
    for (const tag of ldMatches) {
      try {
        const jsonStr = tag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
        const data: Record<string, unknown> = JSON.parse(jsonStr);
        const candidates: unknown[] = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          const obj = c as Record<string, unknown>;
          // Check image, thumbnailUrl, contentUrl
          for (const key of ["image", "thumbnailUrl", "contentUrl"]) {
            const val = obj[key];
            const urlStr = typeof val === "string"
              ? val
              : (val as Record<string, unknown> | null)?.url as string | undefined;
            if (urlStr && urlStr.includes("fbcdn.net") && !(/s(\d+)x\1/.test(urlStr))) {
              return unescapeUrl(urlStr);
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // ── 2. All Instagram CDN URLs in HTML ───────────────────────────────────
  // Instagram CDN URLs appear in script tags as JSON strings (often \/-escaped)
  const cdnPattern = /https:\\?\/\\?\/instagram\.[a-z0-9-]+\.fna\.fbcdn\.net\\?\/v\\?\/[^\s"'<>]+/g;
  const cdnMatches = [...html.matchAll(cdnPattern)].map((m) => unescapeUrl(m[0]));

  if (cdnMatches.length > 0) {
    // Sort by score descending; skip score-0 (confirmed square crops)
    const scored = cdnMatches
      .map((u) => ({ u, s: scoreInstagramUrl(u) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (scored.length > 0) return scored[0].u;
    // All are square crops — return first anyway rather than failing
    return cdnMatches[0];
  }

  // ── 3. og:image fallback ─────────────────────────────────────────────────
  const ogPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']og:image["']/i,
  ];
  for (const p of ogPatterns) {
    const m = html.match(p);
    if (m?.[1]) return unescapeUrl(m[1]);
  }

  return null;
}

/** Detect whether the URL points directly to an image file (not a web page). */
function isDirectImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif|avif)$/.test(path);
  } catch {
    return false;
  }
}

/**
 * Search Google Custom Search Images for the best image matching the given query.
 * Returns the first image URL found, or null if nothing found / API not configured.
 */
async function searchGoogleImages(query: string): Promise<string | null> {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  const engineId = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
  if (!apiKey || !engineId) return null;

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx: engineId,
      q: query,
      searchType: "image",
      num: "5",
      imgSize: "large",
    });

    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const items: Array<{ link: string; image?: { width: number; height: number } }> = data.items ?? [];

    if (items.length === 0) return null;

    // Prefer larger images (portrait or square, at least 500px wide)
    const sorted = items
      .filter((item) => item.link && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item.link))
      .sort((a, b) => {
        const aArea = (a.image?.width ?? 0) * (a.image?.height ?? 0);
        const bArea = (b.image?.width ?? 0) * (b.image?.height ?? 0);
        return bArea - aArea;
      });

    return sorted[0]?.link ?? items[0]?.link ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── 1. Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    // ── 2. Parse body ────────────────────────────────────────────────────────
    let url: string, postId: string;
    try {
      ({ url, postId } = await req.json());
    } catch {
      return json({ error: "Body JSON inválido" }, 400);
    }
    if (!postId) return json({ error: "postId é obrigatório" }, 400);

    // ── 3. Supabase clients ──────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's JWT is valid
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Não autenticado" }, 401);

    // ── 4. Fetch post metadata for Google search ─────────────────────────────
    const { data: postData } = await supabaseAdmin
      .from("posts")
      .select("id, title, description, platform")
      .eq("id", postId)
      .single();

    // ── 5. Resolve image URL ─────────────────────────────────────────────────
    let imageUrl: string | null = null;

    if (url && isDirectImageUrl(url)) {
      // User pasted a direct image URL (e.g. CDN URL from browser DevTools)
      imageUrl = url;

    } else {
      // ── 5a. Try Google Images first (automatic, best quality) ──────────────
      if (postData) {
        // Build search query from post content
        const platform = postData.platform ?? "";
        const searchText = postData.title?.trim() || postData.description?.trim() || "";
        if (searchText.length > 5) {
          const siteHint = platform === "instagram" ? "instagram.com" : "facebook.com";
          const googleUrl = await searchGoogleImages(`${searchText} site:${siteHint}`);
          if (googleUrl) imageUrl = googleUrl;

          // If nothing found on specific platform, try both
          if (!imageUrl) {
            const fallbackUrl = await searchGoogleImages(searchText);
            if (fallbackUrl) imageUrl = fallbackUrl;
          }
        }
      }

      // ── 5b. If Google found nothing and user gave a post URL, scrape og:image
      if (!imageUrl && url) {
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
          redirect: "follow",
        });

        if (pageRes.ok) {
          const html = await pageRes.text();
          imageUrl = extractBestImage(html);
        }
      }
    }

    if (!imageUrl) {
      return json({ error: "Nenhuma imagem encontrada. Tente colar a URL direta da imagem." }, 422);
    }

    // ── 5. Download the image ────────────────────────────────────────────────
    const imgRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Referer": url ?? "https://www.google.com",
      },
    });
    if (!imgRes.ok) {
      return json({ error: `Falha ao baixar imagem (HTTP ${imgRes.status})` }, 422);
    }

    const imgBuffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

    // ── 6. Upload to storage ─────────────────────────────────────────────────
    const fileName = `post-${postId}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("post-thumbnails")
      .upload(fileName, imgBuffer, { contentType, upsert: true });

    if (uploadError) return json({ error: `Upload falhou: ${uploadError.message}` }, 500);

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("post-thumbnails")
      .getPublicUrl(fileName);

    // ── 7. Find siblings (same title or description on any platform) ──────────
    const post = postData;

    const siblingIds = new Set<string>();
    const keys = new Set<string>();
    if (post?.title && post.title.trim().length > 5) keys.add(post.title.trim());
    if (post?.description && post.description.trim().length > 10) keys.add(post.description.trim());

    await Promise.all(
      Array.from(keys).flatMap((key) => [
        supabaseAdmin
          .from("posts").select("id").eq("title", key).neq("id", postId)
          .then(({ data }) => { for (const r of (data ?? [])) siblingIds.add(r.id); }),
        supabaseAdmin
          .from("posts").select("id").eq("description", key).neq("id", postId)
          .then(({ data }) => { for (const r of (data ?? [])) siblingIds.add(r.id); }),
      ])
    );

    const allIds = [postId, ...Array.from(siblingIds)];

    // ── 8. Update all posts with the new thumbnail ────────────────────────────
    const { error: updateError } = await supabaseAdmin
      .from("posts")
      .update({ thumbnail_url: publicUrl })
      .in("id", allIds);

    if (updateError) return json({ error: `Atualização falhou: ${updateError.message}` }, 500);

    return json({ publicUrl, updatedCount: allIds.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
