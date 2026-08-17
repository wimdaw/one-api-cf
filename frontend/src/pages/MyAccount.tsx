import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { copyToClipboard } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { Plus, Copy, Trash2, KeyRound, Wallet, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MyUsage { quota: number; used_quota: number; balance: number; total_usage: number; }

export function MyAccount() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [pwd, setPwd] = useState("");
  const [displayName, setDisplayName] = useState(currentUser?.display_name || "");

  const { data: tokens, isLoading } = useQuery({
    queryKey: ["my-tokens"],
    queryFn: async () => (await apiClient.myTokens()).data?.tokens ?? [],
  });

  const { data: usage } = useQuery({
    queryKey: ["my-usage"],
    queryFn: async () => (await apiClient.myUsage()).data as MyUsage,
  });

  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["my-tokens"] }); queryClient.invalidateQueries({ queryKey: ["my-usage"] }); };

  const createMutation = useMutation({
    mutationFn: () => apiClient.createMyToken({ name: newName, total_quota: -1 }),
    onSuccess: () => { invalidate(); setShowCreate(false); setNewName(""); addToast(t("account.created"), "success"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => apiClient.deleteMyToken(key),
    onSuccess: () => { invalidate(); addToast(t("account.deleted"), "success"); },
  });

  const updateProfile = useMutation({
    mutationFn: () => apiClient.updateMyProfile({ display_name: displayName, password: pwd || undefined }),
    onSuccess: () => { setPwd(""); addToast(t("account.updated"), "success"); },
  });

  const balance = usage?.balance ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 余额卡片 */}
      <Card className="border-0 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{t("account.balance")}</div>
            <div className="text-3xl font-bold">{balance.toFixed(2)}</div>
          </div>
          <div className="ml-auto text-right text-sm text-muted-foreground">
            <div>{t("account.username")}: {currentUser?.username}</div>
            <div>{t("account.role")}: {currentUser?.role === 100 ? t("account.roleRoot") : currentUser?.role === 10 ? t("account.roleAdmin") : t("account.roleUser")}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 我的令牌 */}
        <Card className="border-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" />{t("account.myTokens")}</h2>
              <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-3.5 w-3.5 mr-1" />{t("account.create")}</Button>
            </div>
            {isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              : tokens?.length === 0 ? <p className="text-sm text-muted-foreground">{t("account.noTokens")}</p>
              : (
                <ul className="space-y-2">
                  {(tokens || []).map((tok) => (
                    <li key={tok.key} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{tok.name}</div>
                        <div className="text-xs text-muted-foreground truncate font-mono">{tok.key.slice(0, 24)}...</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { copyToClipboard(tok.key); addToast(t("account.copied"), "success"); }} title={t("account.copy")}><Copy className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(tok.key)} title={t("account.delete")}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            {showCreate && (
              <div className="mt-3 flex gap-2">
                <Input placeholder={t("account.tokenName")} value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Button size="sm" onClick={() => createMutation.mutate()} disabled={!newName || createMutation.isPending}>{t("account.save")}</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 个人资料 */}
        <Card className="border-0">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold flex items-center gap-2"><UserIcon className="h-4 w-4" />{t("account.profile")}</h2>
            <div className="space-y-2">
              <Label>{t("account.displayName")}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("account.newPassword")}</Label>
              <Input type="password" placeholder={t("account.leaveBlank")} value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending}>{t("account.saveProfile")}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}