import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function db(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Sem login por enquanto: uma organização padrão + chave simples de app.
export const DEFAULT_ORG_ID = Deno.env.get("DEFAULT_ORG_ID") ?? "00000000-0000-0000-0000-000000000001";

/** Responde ao preflight e valida x-app-key. Retorna uma Response se a requisição deve parar aqui. */
export function guard(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const expected = Deno.env.get("APP_ACCESS_KEY");
  if (expected && req.headers.get("x-app-key") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

// ---------- HeyGen (a API key só existe aqui, nunca vai pro navegador) ----------
const HEYGEN_BASE = "https://api.heygen.com";

async function heygen(path: string, init: RequestInit = {}) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": Deno.env.get("HEYGEN_API_KEY")!,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}

export async function heygenCreateVideo(opts: {
  avatarId: string;
  voiceId: string;
  script: string;
  ratio: "9:16" | "16:9";
}) {
  const [width, height] = opts.ratio === "16:9" ? [1920, 1080] : [1080, 1920];
  return heygen("/v2/video/generate", {
    method: "POST",
    body: JSON.stringify({
      video_inputs: [{
        character: { type: "avatar", avatar_id: opts.avatarId, avatar_style: "normal" },
        voice: { type: "text", input_text: opts.script, voice_id: opts.voiceId },
        background: { type: "color", value: "#008000" },
      }],
      dimension: { width, height },
    }),
  });
}

export function heygenVideoStatus(videoId: string) {
  return heygen(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
}

// ---------- Custo em créditos (sua moeda interna) ----------
// ~2,5 palavras por segundo em pt-BR (150 palavras ≈ 60 s).
export function estimateSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 2.5);
}

export async function videoCost(client: SupabaseClient, seconds: number): Promise<number> {
  const { data, error } = await client.from("credit_costs").select("operation, credits");
  if (error) throw error;
  const c = Object.fromEntries((data ?? []).map((r) => [r.operation, r.credits]));
  if (seconds <= 30) return c.video_30s;
  if (seconds <= 60) return c.video_60s;
  return c.video_60s + Math.ceil((seconds - 60) / 60) * c.video_extra_minute;
}
