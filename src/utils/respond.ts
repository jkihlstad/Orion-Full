const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id, X-Admin-Key, X-Req-Signature",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

export function text(msg: string, status = 200) {
  return new Response(msg, { status, headers: corsHeaders });
}

export function corsOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
