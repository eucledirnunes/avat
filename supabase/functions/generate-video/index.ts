import {
  db,
  DEFAULT_ORG_ID,
  estimateSeconds,
  guard,
  heygenCreateVideo,
  json,
  videoCost,
} from "../_shared/common.ts";

// Body: { avatar_id (uuid interno), script, ratio? }
// Fluxo: valida avatar da org -> debita créditos -> chama HeyGen -> salva vídeo.
// Se o HeyGen recusar, estorna os créditos.
Deno.serve(async (req) => {
  const stop = guard(req);
  if (stop) return stop;

  const { avatar_id, script, ratio } = await req.json().catch(() => ({}));
  if (!avatar_id || !script?.trim()) {
    return json({ error: "avatar_id e script são obrigatórios" }, 400);
  }
  const videoRatio = ratio === "16:9" ? "16:9" : "9:16";

  const client = db();
  const voiceId = Deno.env.get("HEYGEN_VOICE_ID");
  if (!voiceId) return json({ error: "HEYGEN_VOICE_ID não configurado" }, 500);

  const { data: avatar } = await client.from("avatars")
    .select("id, heygen_avatar_id")
    .eq("id", avatar_id)
    .eq("organization_id", DEFAULT_ORG_ID)
    .eq("status", "ready")
    .maybeSingle();
  if (!avatar) return json({ error: "avatar não encontrado" }, 404);

  const seconds = estimateSeconds(script);
  const cost = await videoCost(client, seconds);

  const { data: video, error: insErr } = await client.from("videos").insert({
    organization_id: DEFAULT_ORG_ID,
    avatar_id: avatar.id,
    script,
    ratio: videoRatio,
    credits_used: cost,
  }).select("id").single();
  if (insErr) return json({ error: insErr.message }, 500);

  const { data: balance, error: debitErr } = await client.rpc("apply_credit", {
    p_org: DEFAULT_ORG_ID,
    p_type: "video",
    p_amount: -cost,
    p_description: `Vídeo ~${seconds}s`,
    p_reference: video.id,
  });
  if (debitErr) {
    await client.from("videos").delete().eq("id", video.id);
    const insufficient = debitErr.message.includes("insufficient_credits");
    return json(
      { error: insufficient ? "créditos insuficientes" : debitErr.message, cost },
      insufficient ? 402 : 500,
    );
  }

  const res = await heygenCreateVideo({
    avatarId: avatar.heygen_avatar_id,
    voiceId,
    script,
    ratio: videoRatio,
  });
  const heygenVideoId = res?.data?.video_id;

  if (res?.error || !heygenVideoId) {
    const message = JSON.stringify(res?.error ?? res);
    await client.rpc("apply_credit", {
      p_org: DEFAULT_ORG_ID,
      p_type: "refund",
      p_amount: cost,
      p_description: "Estorno: HeyGen recusou o vídeo",
      p_reference: video.id,
    });
    await client.from("videos").update({ status: "failed", refunded: true, error_message: message })
      .eq("id", video.id);
    return json({ error: "falha ao criar vídeo no HeyGen", detail: message }, 502);
  }

  await client.from("videos").update({ heygen_video_id: heygenVideoId }).eq("id", video.id);
  return json({ video_id: video.id, status: "processing", cost, credits_balance: balance }, 202);
});
