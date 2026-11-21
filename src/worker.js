const GUIDE_DOC_ID = "1ZVx55BXqSLXx6rvfMXpPVS4fmolYSdBblVW0kNGaquw";
const GUIDE_TTL = 300;

const escapeHtml = (t) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const decodeEntities = (t) =>
  t
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");

// Turn Google's exported HTML into minimal, safe HTML (no styles, classes or scripts).
function sanitizeDocHtml(html) {
  const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || "";
  const boldC = new Set(), italicC = new Set();
  for (const m of css.matchAll(/\.([\w-]+)\{([^}]*)\}/g)) {
    if (/font-weight:\s*(700|bold)/.test(m[2])) boldC.add(m[1]);
    if (/font-style:\s*italic/.test(m[2])) italicC.add(m[1]);
  }
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];

  const inline = (src) => {
    let out = "";
    const re = /<span([^>]*)>([\s\S]*?)<\/span>|<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<img\s[^>]*src="([^"]*)"[^>]*>|<br\s*\/?>/gi;
    let last = 0, m;
    const plain = (t) => escapeHtml(decodeEntities(t.replace(/<[^>]+>/g, "")));
    while ((m = re.exec(src))) {
      out += plain(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[0].toLowerCase().startsWith("<br")) out += "<br>";
      else if (m[0].toLowerCase().startsWith("<img")) {
        if (/^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(m[5]))
          out += `<img src="${escapeHtml(decodeEntities(m[5]))}" alt="">`;
      } else if (m[3] !== undefined) {
        let href = decodeEntities(m[3]);
        const q = href.match(/^https:\/\/www\.google\.com\/url\?q=([^&]+)/);
        if (q) href = decodeURIComponent(q[1]);
        if (/^(https?:|mailto:)/i.test(href))
          out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${plain(m[4])}</a>`;
        else out += plain(m[4]);
      } else {
        const cls = ((m[1].match(/class="([^"]*)"/) || [])[1] || "").split(/\s+/);
        let inner = m[2].includes("<img") || m[2].includes("<a ") ? inline(m[2]) : plain(m[2]);
        if (!inner.trim() && !inner.includes("<img")) { out += inner; continue; }
        if (cls.some((c) => boldC.has(c))) inner = `<strong>${inner}</strong>`;
        if (cls.some((c) => italicC.has(c))) inner = `<em>${inner}</em>`;
        out += inner;
      }
    }
    return out + plain(src.slice(last));
  };

  let title = "";
  const parts = [];
  let list = null;
  const closeList = () => { if (list) { parts.push(`</${list}>`); list = null; } };
  const re = /<(ul|ol)\b[^>]*>|<\/(ul|ol)>|<(p|h[1-6]|li)\b([^>]*)>([\s\S]*?)<\/\3>/gi;
  let m;
  while ((m = re.exec(body))) {
    if (m[1]) { closeList(); list = m[1].toLowerCase(); parts.push(`<${list}>`); continue; }
    if (m[2]) { closeList(); continue; }
    const tag = m[3].toLowerCase();
    const raw = m[5];
    const text = decodeEntities(raw.replace(/<[^>]+>/g, "")).replace(/\u00a0/g, " ").trim();
    const hasImg = /<img\b/i.test(raw);
    if (!text && !hasImg) continue;
    if (tag === "li") { parts.push(`<li>${inline(raw)}</li>`); continue; }
    closeList();
    if (!title && (/class="[^"]*\btitle\b/.test(m[4]) || tag.startsWith("h") || parts.length === 0)) {
      title = text;
      continue;
    }
    if (tag.startsWith("h")) { parts.push(`<${tag}>${inline(raw)}</${tag}>`); continue; }
    if (!hasImg && /^region(\s|$)\S*/i.test(text) && text.split(/\s+/).length > 1)
      parts.push(`<pre><code>${escapeHtml(text)}</code></pre>`);
    else parts.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  return { title, html: parts.join("\n") };
}

async function handleGuide(ctx, corsHeaders) {
  const cache = caches.default;
  const cacheKey = new Request(`https://cpame.sh/__cache/guide/${GUIDE_DOC_ID}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }
  try {
    const docRes = await fetch(
      `https://docs.google.com/document/d/${GUIDE_DOC_ID}/export?format=html`,
      { cf: { cacheTtl: GUIDE_TTL, cacheEverything: true } }
    );
    if (!docRes.ok) throw new Error("doc " + docRes.status);
    const { title, html } = sanitizeDocHtml(await docRes.text());
    if (!html) throw new Error("empty");
    const res = new Response(
      JSON.stringify({ title, html, source: `https://docs.google.com/document/d/${GUIDE_DOC_ID}/edit`, fetchedAt: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${GUIDE_TTL}` } }
    );
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Guide unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = ["https://cpame.sh", "https://www.cpame.sh"];
    const isAllowed = allowedOrigins.includes(origin);

    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowed ? origin : "",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (origin && !isAllowed) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Old guide URL now lives at /regions
    if (url.pathname === "/repeater-regions" || url.pathname === "/repeater-regions/") {
      return Response.redirect(url.origin + "/regions", 301);
    }

    // Live guide from Google Docs
    if (url.pathname === "/api/guide/repeater-regions") {
      return handleGuide(ctx, corsHeaders);
    }

    // Repeaters proxy
    if (url.pathname === "/api/repeaters") {
      try {
        const apiRes = await fetch("https://sce.meshmapper.net/get_repeaters.php", {
          headers: {
            "X-API-Key": env.MESHMAPPER_API_KEY,
            "Accept-Encoding": "gzip"
          }
        });

        const headers = {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
          ...corsHeaders
        };

        if (!apiRes.ok) {
          return new Response(
            JSON.stringify({ error: "MeshMapper error", status: apiRes.status }),
            { status: apiRes.status, headers }
          );
        }

        const data = await apiRes.json();
        return new Response(JSON.stringify(data), { headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Proxy failed" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Coverage proxy
    if (url.pathname === "/api/coverage") {
      try {
        const apiRes = await fetch("https://meshmapper.net/coverage.php", {
          headers: {
            "X-API-Key": env.MESHMAPPER_API_KEY,
            "Accept-Encoding": "gzip"
          }
        });

        const headers = {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=600",
          ...corsHeaders
        };

        if (!apiRes.ok) {
          return new Response(
            JSON.stringify({ error: "MeshMapper coverage error", status: apiRes.status }),
            { status: apiRes.status, headers }
          );
        }

        const data = await apiRes.json();
        return new Response(JSON.stringify(data), { headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Coverage proxy failed" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Serve the static Astro site
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Assets not available", { status: 500 });
  }
};
