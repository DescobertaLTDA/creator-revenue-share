import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/criador")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/posts", replace: true });
  },
  component: () => null,
});
