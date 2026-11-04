export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = ["https://cpame.sh", "https://www.cpame.sh"];
  const isAllowed = allowedOrigins.includes(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": isAllowed ? origin : "",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  if (origin && !isAllowed) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

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
      "Access-Control-Allow-Origin": isAllowed ? origin : ""
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
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": isAllowed ? origin : "" } }
    );
  }
}
