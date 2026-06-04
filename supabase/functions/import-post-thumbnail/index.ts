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
    if (!url || !postId) return json({ error: "url e postId são obrigatórios" }, 400);

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

    // ── 4. Fetch the post page to extract og:image ───────────────────────────
    const pageRes = await fetch(url, {
      headers: {
        // Googlebot UA is accepted by most social platforms and returns og tags
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!pageRes.ok) {
      return json({ error: `Falha ao acessar URL (HTTP ${pageRes.status})` }, 422);
    }

    const html = await pageRes.text();
    const imageUrl = extractBestImage(html);
    if (!imageUrl) return json({ error: "Nenhuma imagem encontrada na URL fornecida" }, 422);

    // ── 5. Download the image ────────────────────────────────────────────────
    const imgRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Referer": url,
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
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("id, title, description")
      .eq("id", postId)
      .single();

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
