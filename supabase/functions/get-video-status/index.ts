import { db, DEFAULT_ORG_ID, guard, heygenVideoStatus, json } from "../_shared/common.ts";

// Body ou query: { video_id (uuid interno) }
// Consulta o HeyGen, atualiza a linha e estorna créditos (uma única vez) se falhou.
Deno.serve(async (req) => {
  const stop = guard(req);
  if (stop) return stop;

  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const videoId = body.video_id ?? url.searchParams.get("video_id");
  if (!videoId) return json({ error: "video_id é obrigatório" }, 400);

  const client = db();
  const { data: video } = await client.from("videos")
    .select("id, status, video_url, heygen_video_id, credits_used, refunded, error_message, created_at")
    .eq("id", videoId)
    .eq("organization_id", DEFAULT_ORG_ID)
    .maybeSingle();
  if (!video) return json({ error: "vídeo não encontrado" }, 404);

  if (video.status === "processing" && video.heygen_video_id) {
    const res = await heygenVideoStatus(video.heygen_video_id);
    const status = res?.data?.status;

    if (status === "completed") {
      video.status = "completed";
      video.video_url = res.data.video_url;
      await client.from("videos").update({ status: "completed", video_url: video.video_url })
        .eq("id", video.id);
    } else if (status === "failed") {
      const message = res.data?.error?.message ?? "erro desconhecido";
      video.status = "failed";
      video.error_message = message;
      if (!video.refunded) {
        // update condicional evita estorno duplicado em chamadas concorrentes
        const { data: claimed } = await client.from("videos")
          .update({ status: "failed", refunded: true, error_message: message })
          .eq("id", video.id).eq("refunded", false).select("id");
        if (claimed?.length) {
          await client.rpc("apply_credit", {
            p_org: DEFAULT_ORG_ID,
            p_type: "refund",
            p_amount: video.credits_used,
            p_description: "Estorno: renderização falhou",
            p_reference: video.id,
          });
          video.refunded = true;
        }
      }
    }
  }

  // heygen_video_id não sai do backend
  const { heygen_video_id: _omit, ...safe } = video;
  return json({ video: safe });
});
