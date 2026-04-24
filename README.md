# Rateio Creator

SaaS de gestão de receita por post (CSV do Facebook) — MVP.

## Stack
- Frontend: React + TypeScript + Vite + TanStack Router + Tailwind
- Backend: Lovable Cloud (Supabase) — Auth, Postgres, Storage, RLS
- PDF: jsPDF + jspdf-autotable
- CSV: PapaParse
- Idioma: pt-BR · Moeda: BRL · Timezone: America/Sao_Paulo

## Perfis
- `admin`: acesso total
- `colaborador`: só vê seus próprios dados (RLS)

## Rotas
- `/login` · `/admin/dashboard` · `/admin/importacoes` · `/admin/importacoes/:id`
- `/admin/posts` · `/admin/regras-split` · `/admin/fechamentos` · `/admin/fechamentos/:id`
- `/admin/colaboradores` · `/colaborador/dashboard`

## Primeiro acesso
1. Crie um usuário em **Cloud → Users** e marque-o como admin:
   `UPDATE public.profiles SET role = 'admin' WHERE email = 'seu@email.com';`
2. Faça login em `/login`.
3. Importe um CSV do Facebook em `/admin/importacoes`.

## Status do MVP
✅ Schema + RLS + Storage (13 tabelas, buckets `csv-uploads` e `receipts`)
✅ Auth com guards por perfil · seed de páginas/colaboradores/regras
✅ Parser CSV (PT/EN, datas dd/MM/yyyy e MM/dd/yyyy, números pt-BR/en-US, dedupe, idempotente)
✅ Upload CSV com histórico, detalhe e erros por linha
✅ Dashboards admin/colaborador · CRUD colaboradores · CRUD regras de split
🚧 Próxima iteração: criação de fechamento com snapshot, marcação de pago fora, geração de PDF de comprovante, edição de autor por post, convite de colaborador por e-mail
