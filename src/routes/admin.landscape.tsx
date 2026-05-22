import { createFileRoute } from "@tanstack/react-router";
import LivingAnalyticsChart from "@/components/LivingAnalyticsChart";

export const Route = createFileRoute("/admin/landscape")({
  head: () => ({ meta: [{ title: "Landscape — Splash Creators" }] }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Landscape</h1>
        <p className="text-sm text-muted-foreground mt-1">Interactive analytics landscape. Drag to explore. Move your mouse near the birds.</p>
      </div>
      <LivingAnalyticsChart />
    </div>
  );
}
