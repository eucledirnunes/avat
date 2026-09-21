# Plataforma de avatares (HeyGen como motor)

Backend multi-tenant em Supabase. O HeyGen só recebe ordens do backend; o navegador nunca vê
`heygen_avatar_id`, `heygen_video_id` nem a API key.

## Estrutura

- `supabase/migrations/` — schema (organizations, avatars, videos, credit_transactions, credit_costs) e `apply_credit()` atômica.
- `supabase/functions/` — `list-avatars`, `register-avatar`, `generate-video`, `get-video-status`.

## Modo sem login (temporário)

RLS está ligado sem policies: só as Edge Functions (service role) acessam o banco. Tudo roda na
organização padrão `00000000-0000-0000-0000-000000000001`. As funções exigem o header `x-app-key`
(`APP_ACCESS_KEY`). Quando o login entrar: criar `organization_members` + policies e trocar
`DEFAULT_ORG_ID` pela organização do usuário.

## Deploy

```bash
supabase login
supabase link --project-ref wuwhzoxowotvktyrxxmp
supabase db push
cp .env.example .env   # preencha HEYGEN_API_KEY, HEYGEN_VOICE_ID, APP_ACCESS_KEY
supabase secrets set --env-file .env
supabase functions deploy
```

## Créditos de teste

```sql
select apply_credit('00000000-0000-0000-0000-000000000001', 'adjustment', 1000, 'Crédito de teste');
```

## Custos (tabela `credit_costs`)

Vídeo ≤30s = 80, ≤60s = 150, +150 por minuto extra. Duração estimada a 2,5 palavras/s.
