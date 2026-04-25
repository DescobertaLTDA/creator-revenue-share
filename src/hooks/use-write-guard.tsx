import { useState } from "react";
import { useAuth } from "./use-auth";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock } from "lucide-react";

export function useWriteGuard() {
  const { profile } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const isAdmin = profile?.role === "admin";

  function guard<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => {
      if (!isAdmin) {
        setBlocked(true);
        return;
      }
      return fn(...args);
    }) as T;
  }

  function guardSubmit(fn: (e: React.FormEvent) => void) {
    return (e: React.FormEvent) => {
      e.preventDefault();
      if (!isAdmin) {
        setBlocked(true);
        return;
      }
      fn(e);
    };
  }

  function WriteGuardDialog() {
    return (
      <AlertDialog open={blocked} onOpenChange={setBlocked}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <AlertDialogTitle>Acesso restrito</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              Seu perfil tem permissão apenas de <strong>leitura</strong>. Para criar ou editar dados, fale com o administrador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlocked(false)}>
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return { isAdmin, guard, guardSubmit, WriteGuardDialog };
}
