import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import { HandCoins, Loader2, Plus } from "lucide-react";

type DistributionMode = "views" | "revenue" | "hybrid";

interface ManualBonusRow {
  id: string;
  bonus_date: string;
  amount_usd: number | string;
  amount_brl: number | string | null;
  distribution_mode: DistributionMode;
  note: string | null;
  active: boolean;
  created_at: string;
}

export const Route = createFileRoute("/admin/bonus-manual")({
  head: () => ({ meta: [{ title: "Bonus Manual - Rateio Creator" }] }),
  component: AdminManualBonusPage,
});

function toNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0) || 0;
}

function modeLabel(mode: DistributionMode): string {
  if (mode === "views") return "Por views";
  if (mode === "revenue") return "Por receita";
  return "Misto (views + receita)";
}

function AdminManualBonusPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ManualBonusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [bonusDate, setBonusDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amountUsd, setAmountUsd] = useState("");
  const [amountBrl, setAmountBrl] = useState("");
  const [mode, setMode] = useState<DistributionMode>("hybrid");
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("manual_bonus_entries")
      .select("id, bonus_date, amount_usd, amount_brl, distribution_mode, note, active, created_at")
      .order("bonus_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      const message = String(error.message || "");
      if (message.includes("manual_bonus_entries")) {
        toast.error("Tabela de bonus manual ainda nao existe", {
          description: "Rode a migration SQL para habilitar os lancamentos manuais.",
        });
        setRows([]);
      } else {
        toast.error("Erro ao carregar bonus manual", { description: error.message });
      }
      setLoading(false);
      return;
    }

    setRows((data ?? []) as ManualBonusRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();

    const channel = supabase
      .channel("admin-bonus-manual")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_bonus_entries" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const totals = useMemo(() => {
    let usd = 0;
    let brl = 0;
    for (const row of rows) {
      if (!row.active) continue;
      usd += toNumber(row.amount_usd);
      brl += toNumber(row.amount_brl);
    }
    return { usd, brl };
  }, [rows]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const usd = Number(amountUsd);
    const brl = amountBrl.trim() === "" ? null : Number(amountBrl);

    if (!bonusDate) {
      toast.error("Informe a data");
      return;
    }
    if (!Number.isFinite(usd) || usd <= 0) {
      toast.error("Informe um valor USD valido");
      return;
    }
    if (amountBrl.trim() !== "" && (!Number.isFinite(brl) || (brl ?? 0) < 0)) {
      toast.error("Valor BRL invalido");
      return;
    }

    setSaving(true);
    const { error } = await (supabase as any).from("manual_bonus_entries").insert({
      bonus_date: bonusDate,
      amount_usd: usd,
      amount_brl: brl,
      distribution_mode: mode,
      note: note.trim() || null,
      active: true,
      created_by: profile?.id ?? null,
    });

    if (error) {
      toast.error("Erro ao salvar bonus", { description: error.message });
      setSaving(false);
      return;
    }

    setAmountUsd("");
    setAmountBrl("");
    setMode("hybrid");
    setNote("");
    setSaving(false);
    toast.success("Bonus manual salvo");
    load();
  };

  const toggleActive = async (row: ManualBonusRow) => {
    const { error } = await (supabase as any)
      .from("manual_bonus_entries")
      .update({ active: !row.active })
      .eq("id", row.id);
    if (error) {
      toast.error("Erro ao atualizar bonus", { description: error.message });
      return;
    }
    toast.success(row.active ? "Bonus desativado" : "Bonus ativado");
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bonus Manual"
        description="Lance ganhos extras diarios (fora do CSV). O dashboard rateia por views, receita ou modo misto."
      />

      <form onSubmit={onSubmit} className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label>Data</Label>
            <Input type="date" value={bonusDate} onChange={(e) => setBonusDate(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Valor extra (USD)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="15.61"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Valor em BRL (opcional)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="78.10"
              value={amountBrl}
              onChange={(e) => setAmountBrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rateio</Label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as DistributionMode)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="hybrid">Misto (views + receita)</option>
              <option value="views">Apenas views</option>
              <option value="revenue">Apenas receita</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Observacao</Label>
            <Input
              placeholder="Bonus global Facebook"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Salvar bonus
          </Button>
        </div>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Total ativo (USD)</p>
          <p className="text-2xl font-bold mt-1">${totals.usd.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">Total ativo (BRL informado)</p>
          <p className="text-2xl font-bold mt-1">{formatBRL(totals.brl)}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={HandCoins}
              title="Nenhum bonus manual cadastrado"
              description="Cadastre bonus extras para o rateio mensal por desempenho."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Data</th>
                  <th className="text-right px-5 py-3 font-medium">USD</th>
                  <th className="text-right px-5 py-3 font-medium">BRL</th>
                  <th className="text-left px-5 py-3 font-medium">Rateio</th>
                  <th className="text-left px-5 py-3 font-medium">Observacao</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">{row.bonus_date.split("-").reverse().join("/")}</td>
                    <td className="px-5 py-3 text-right tabular-nums">${toNumber(row.amount_usd).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {row.amount_brl == null ? "-" : formatBRL(toNumber(row.amount_brl))}
                    </td>
                    <td className="px-5 py-3">{modeLabel(row.distribution_mode)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{row.note ?? "-"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          row.active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {row.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleActive(row)}
                        className="text-sm text-primary hover:underline"
                      >
                        {row.active ? "Desativar" : "Ativar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

