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
import { Plus, Copy, Trash2, KeyRound, Wallet, User as UserIcon, Gift, BarChart3 } from "lucide-react";
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
  const [oldPwd, setOldPwd] = useState("");
  const [displayName, setDisplayName] = useState(currentUser?.display_name || "");

  const { data: tokens, isLoading } = useQuery({
    queryKey: ["my-tokens"],
    queryFn: async () => (await apiClient.myTokens()).data?.tokens ?? [],
  });

  const { data: usage } = useQuery({
    queryKey: ["my-usage"],
    queryFn: async () => (await apiClient.myUsage()).data as MyUsage,
  });

  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => (await apiClient.getUserProfile()).data as { aff_code?: string },
  });

  const { data: dashboard } = useQuery({
    queryKey: ["my-dashboard"],
    queryFn: async () => (await apiClient.myAnalytics("7d", "model")).data,
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
    mutationFn: () => apiClient.updateMyProfile({ display_name: displayName, password: pwd || undefined, old_password: pwd ? oldPwd : undefined }),
    onSuccess: () => { setPwd(""); setOldPwd(""); addToast(t("account.updated"), "success"); },
  });

  const [redeemCode, setRedeemCode] = useState("");
  const redeemMutation = useMutation({
    mutationFn: () => apiClient.redeemCode(redeemCode),
    onSuccess: (res) => {
      setRedeemCode("");
      queryClient.invalidateQueries({ queryKey: ["my-usage"] });
      addToast(`${t("account.redeemed")}: +${res?.data?.added_quota ?? 0}`, "success");
    },
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
            <div className="text-3xl font-bold">{balance < 0 ? t("common.unlimited") : balance.toFixed(2)}</div>
          </div>
          <div className="ml-auto text-right text-sm text-muted-foreground">
            <div>{t("account.username")}: {currentUser?.username}</div>
            <div>{t("account.role")}: {currentUser?.role === 100 ? t("account.roleRoot") : currentUser?.role === 10 ? t("account.roleAdmin") : t("account.roleUser")}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardContent className="p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" />{t("account.myUsageStats")}</h2>
          {dashboard ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">{t("account.reqTotal")}</div>
                  <div className="text-xl font-bold">{dashboard.overview?.totals?.requests ?? 0}</div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">{t("account.reqSuccess")}</div>
                  <div className="text-xl font-bold">{dashboard.overview?.totals?.successes ?? 0}</div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">{t("account.tokensUsed")}</div>
                  <div className="text-xl font-bold">{dashboard.overview?.totals?.totalTokens ?? 0}</div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">{t("account.costTotal")}</div>
                  <div className="text-xl font-bold">{(dashboard.overview?.totals?.totalCost ?? 0).toFixed(4)}</div>
                </div>
              </div>
              {dashboard.breakdown?.items && dashboard.breakdown.items.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("account.byModel")}</div>
                  {dashboard.breakdown.items.slice(0, 8).map((m) => (
                    <div key={m.label} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate">{m.label}</span>
                      <span className="shrink-0">{m.requests} · {m.totalTokens}t</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardContent className="p-5 flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label className="flex items-center gap-1.5"><Gift className="h-4 w-4" />{t("account.redeemTitle")}</Label>
            <Input
              placeholder={t("account.redeemPlaceholder")}
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && redeemMutation.mutate()}
            />
          </div>
          <Button onClick={() => redeemMutation.mutate()} disabled={!redeemCode || redeemMutation.isPending}>
            {t("account.redeem")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardContent className="p-5 space-y-3">
          <Label className="flex items-center gap-1.5"><Gift className="h-4 w-4" />{t("account.inviteTitle")}</Label>
          <p className="text-sm text-muted-foreground">{t("account.inviteDesc")}</p>
          {profile?.aff_code ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-md bg-muted font-mono text-sm">{profile.aff_code}</code>
              <Button variant="outline" size="sm" onClick={() => {
                copyToClipboard(profile.aff_code || "");
                addToast(t("account.copied"), "success");
              }}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                {t("account.copy")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("account.inviteNone")}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
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
              <Label>{t("account.oldPassword")}</Label>
              <Input type="password" placeholder={t("account.oldPasswordPlaceholder")} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
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