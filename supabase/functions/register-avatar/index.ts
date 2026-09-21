import { db, DEFAULT_ORG_ID, guard, json } from "../_shared/common.ts";

// Vincula um avatar que já existe no HeyGen à organização (sem cobrar créditos).
// Body: { heygen_avatar_id, name, preview_image_url?, visibility? }
Deno.serve(async (req) => {
  const stop = guard(req);
  if (stop) return stop;

  const body = await req.json().catch(() => ({}));
  const { heygen_avatar_id, name, preview_image_url, visibility } = body;
  if (!heygen_avatar_id || !name) {
    return json({ error: "heygen_avatar_id e name são obrigatórios" }, 400);
  }

  const { data, error } = await db().from("avatars").insert({
    organization_id: DEFAULT_ORG_ID,
    heygen_avatar_id,
    name,
    preview_image_url: preview_image_url ?? null,
    visibility: visibility === "private" ? "private" : "team",
  }).select("id, name, preview_image_url, visibility, status, created_at").single();

  if (error) return json({ error: error.message }, error.code === "23505" ? 409 : 500);
  return json({ avatar: data }, 201);
});
