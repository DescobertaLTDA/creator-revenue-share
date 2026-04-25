import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPct, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Percent, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/regras-split")({
  head: () => ({ meta: [{ title: "Regras de Split — Rateio Creator" }] }),
  component: RulesPage,
});

interface Rule { id: string; page_id: string; effective_from: string; collaborator_pct: number; page_pct: number; team_pct: number; active: boolean; pages: { nome: string } | null; }
interface Page { id: string; nome: string }

function RulesPage() {
  const { profile } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pageId, setPageId] = useState("");
  const [colPct, setColPct] = useState(50);
  const [pgPct, setPgPct] = useState(30);
  const [tmPct, setTmPct] = useState(20);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("split_rules").select("id, page_id, effective_from, collaborator_pct, page_pct, team_pct, active, pages(nome)").order("effective_from", { ascending: false }),
      supabase.from("pages").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    setRules((r as unknown as Rule[]) ?? []);
    setPages((p as Page[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (colPct + pgPct + tmPct !== 100) { toast.error("Percentuais devem somar 100%"); return; }
    if (!pageId) { toast.error("Selecione uma página"); return; }
    const { error } = await supabase.from("split_rules").insert({
      page_id: pageId, collaborator_pct: colPct, page_pct: pgPct, team_pct: tmPct,
      created_by: profile?.id, active: true,
    });
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success("Regra criada");
    setShowForm(false);
    await load();
  };

  return (
    <div>
      <PageHeader title="Regras de Split" description="Divisão de receita por página: colaborador / página / equipe. Soma deve ser 100%."
        actions={<Button onClick={() => setShowForm(v => !v)}><Plus className="h-4 w-4 mr-2"/>Nova regra</Button>} />

      {showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-xl p-4 sm:p-5 mb-6 space-y-4">
          <h3 className="font-semibold text-sm">Nova regra de split</h3>
          <div className="flex flex-col gap-1.5">
            <Label>Página</Label>
            <select value={pageId} onChange={e => setPageId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">Selecione…</option>
              {pages.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>% Colab</Label><Input type="number" min={0} max={100} value={colPct} onChange={e => setColPct(Number(e.target.value))} className="h-11 rounded-xl mt-1"/></div>
            <div><Label>% Página</Label><Input type="number" min={0} max={100} value={pgPct} onChange={e => setPgPct(Number(e.target.value))} className="h-11 rounded-xl mt-1"/></div>
            <div><Label>% Equipe</Label><Input type="number" min={0} max={100} value={tmPct} onChange={e => setTmPct(Number(e.target.value))} className="h-11 rounded-xl mt-1"/></div>
          </div>
          <p className={`text-xs font-medium ${colPct+pgPct+tmPct === 100 ? "text-[#16a34a]" : "text-destructive"}`}>
            Soma: {colPct+pgPct+tmPct}% {colPct+pgPct+tmPct === 100 ? "✓" : "(deve ser 100%)"}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-11">Cancelar</Button>
            <Button type="submit" className="flex-1 h-11">Salvar regra</Button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div>
        ) : rules.length === 0 ? (
          <div className="p-6"><EmptyState icon={Percent} title="Nenhuma regra cadastrada" description="Cadastre regras de divisão por página."/></div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {rules.map(r => (
                <div key={r.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.pages?.nome ?? "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Vigente desde {formatDate(r.effective_from)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {[
                      { label: "Colaborador", value: formatPct(r.collaborator_pct) },
                      { label: "Página", value: formatPct(r.page_pct) },
                      { label: "Equipe", value: formatPct(r.team_pct) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-muted/30 rounded-lg px-3 py-2 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
                        <p className="font-bold tabular-nums mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <table className="hidden sm:table w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Página</th>
                  <th className="text-left px-5 py-3 font-medium">Vigente desde</th>
                  <th className="text-right px-5 py-3 font-medium">Colab</th>
                  <th className="text-right px-5 py-3 font-medium">Página</th>
                  <th className="text-right px-5 py-3 font-medium">Equipe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.map(r => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 font-medium">{r.pages?.nome ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.effective_from)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPct(r.collaborator_pct)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPct(r.page_pct)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPct(r.team_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
