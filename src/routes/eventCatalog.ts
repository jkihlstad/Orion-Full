// GET /v1/contracts/eventCatalog
// Serves EventCatalog.json with caching

import catalogJson from "../../assets/EventCatalog.json";

function etagForString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `"${hash.toString(16)}"`;
}

export async function eventCatalog(req: Request): Promise<Response> {
  const bodyStr = JSON.stringify(catalogJson);
  const etag = etagForString(bodyStr);

  const inm = req.headers.get("if-none-match");
  if (inm && inm === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=3600" }
    });
  }

  return new Response(bodyStr, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": "public, max-age=3600"
    }
  });
}
