import { db, DEFAULT_ORG_ID, guard, json } from "../_shared/common.ts";

// Lista só os avatares da organização. heygen_* nunca é devolvido ao front.
Deno.serve(async (req) => {
  const stop = guard(req);
  if (stop) return stop;

  const client = db();
  const [avatars, org] = await Promise.all([
    client.from("avatars")
      .select("id, name, preview_image_url, visibility, status, created_at")
      .eq("organization_id", DEFAULT_ORG_ID)
      .order("created_at", { ascending: false }),
    client.from("organizations").select("credits_balance").eq("id", DEFAULT_ORG_ID).single(),
  ]);

  if (avatars.error) return json({ error: avatars.error.message }, 500);
  return json({ credits_balance: org.data?.credits_balance ?? 0, avatars: avatars.data });
});
