import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify caller is authenticated and is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Não autenticado" }, 401);

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return json({ error: "Acesso negado. Apenas administradores." }, 403);
    }

    const body = await req.json();
    const { action } = body;

    // ── CREATE ──────────────────────────────────────────────
    if (action === "create") {
      const { email, password, nome, role } = body;
      if (!email || !password || !nome) {
        return json({ error: "email, password e nome são obrigatórios" }, 400);
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { nome },
      });
      if (error) return json({ error: error.message }, 400);

      await supabaseAdmin.from("profiles").upsert({
        id: data.user.id,
        nome,
        email: email.trim().toLowerCase(),
        role: role === "admin" ? "admin" : "colaborador",
      });

      return json({ user: { id: data.user.id, email: data.user.email } });
    }

    // ── DELETE ──────────────────────────────────────────────
    if (action === "delete") {
      const { userId } = body;
      if (!userId) return json({ error: "userId obrigatório" }, 400);
      if (userId === caller.id) {
        return json({ error: "Não é possível deletar sua própria conta" }, 400);
      }

      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);

      return json({ ok: true });
    }

    // ── UPDATE ROLE ─────────────────────────────────────────
    if (action === "update_role") {
      const { userId, role } = body;
      if (!userId || !role) return json({ error: "userId e role obrigatórios" }, 400);
      if (userId === caller.id) return json({ error: "Não é possível alterar sua própria função" }, 400);

      await supabaseAdmin
        .from("profiles")
        .update({ role: role === "admin" ? "admin" : "colaborador" })
        .eq("id", userId);

      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Erro desconhecido" }, 500);
  }
});
