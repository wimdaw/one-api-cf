import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Copy, Trash2, Ticket, CopyPlus, Gift } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { RedemptionItem } from "@/types";

// 邀请码管理区块: 后台生成邀请码, 用户注册时填写
function InviteCodesSection() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [quota, setQuota] = useState("100");
  const [count, setCount] = useState("1");
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invite-codes"],
    queryFn: async () => (await apiClient.listInviteCodes()).data?.inviteCodes ?? [],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["invite-codes"] });

  const createMutation = useMutation({
    mutationFn: () => apiClient.createInviteCodes({ quota: Number(quota) || 0, count: Number(count) || 1 }),
    onSuccess: (res) => {
      invalidate();
      const codes = res?.data?.codes ?? [];
      addToast(`${t("redemptions.created")}: ${codes.length}`, "success");
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteInviteCode(id),
    onSuccess: () => { invalidate(); addToast(t("redemptions.deleted"), "success"); },
  });

  return (
    <Card className="border-0">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Gift className="h-4 w-4" />{t("dashboard.inviteCodes")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t("dashboard.inviteCodeVerification")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />{t("dashboard.generateInviteCode")}
          </Button>
        </div>

        {showCreate && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("dashboard.inviteQuota")}</Label>
                <Input type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("dashboard.inviteCount")}</Label>
                <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                <Plus className="h-4 w-4 mr-1" />{t("dashboard.generateInviteCode")}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-muted-foreground py-6">{t("common.loading")}</div>
        ) : !data?.length ? (
          <div className="text-center text-muted-foreground py-6">{t("redemptions.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">{t("redemptions.code")}</th>
                  <th className="text-left py-2 pr-4 font-medium">{t("dashboard.inviteQuota")}</th>
                  <th className="text-left py-2 pr-4 font-medium">{t("dashboard.inviteUsed")}</th>
                  <th className="text-left py-2 pr-4 font-medium">{t("redemptions.status")}</th>
                  <th className="text-right py-2 font-medium">{t("redemptions.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((c) => (
                  <tr key={c.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 pr-4">
                      <span className="font-mono font-medium">{c.code}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-1"
                        onClick={() => { copyToClipboard(c.code); addToast(t("redemptions.copied"), "success"); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </td>
                    <td className="py-2 pr-4">{c.quota}</td>
                    <td className="py-2 pr-4">{c.used_count}/{c.count}</td>
                    <td className="py-2 pr-4"><Badge variant={c.status === 1 ? "success" : "destructive"}>{t(`redemptions.${c.status === 1 ? "active" : "inactive"}`)}</Badge></td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Redemptions() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [quota, setQuota] = useState("100");
  const [count, setCount] = useState("1");
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["redemptions"],
    queryFn: async () => (await apiClient.listRedemptions()).data?.redemptions ?? [],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["redemptions"] });

  const createMutation = useMutation({
    mutationFn: () => apiClient.createRedemptions({ quota: Number(quota) || 0, count: Number(count) || 1 }),
    onSuccess: (res) => {
      invalidate();
      const codes = res?.data?.codes ?? [];
      addToast(`${t("redemptions.created")}: ${codes.length}`, "success");
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteRedemption(id),
    onSuccess: () => { invalidate(); addToast(t("redemptions.deleted"), "success"); },
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <InviteCodesSection />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            {t("redemptions.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("redemptions.description")}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t("redemptions.generate")}
        </Button>
      </div>

      {showCreate && (
        <Card className="border-0">
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("redemptions.quota")}</Label>
                <Input type="number" value={quota} onChange={(e) => setQuota(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("redemptions.count")}</Label>
                <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                <CopyPlus className="h-4 w-4 mr-1" />
                {t("redemptions.generate")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-0">
        <CardContent className="p-4">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-10">{t("common.loading")}</div>
          ) : !data?.length ? (
            <div className="text-center text-muted-foreground py-10">{t("redemptions.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">{t("redemptions.code")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("redemptions.quota")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("redemptions.redeemed")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("redemptions.status")}</th>
                    <th className="text-right py-2 font-medium">{t("redemptions.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data || []).map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 pr-4">
                        <span className="font-mono font-medium">{r.code}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 ml-1"
                          onClick={() => { copyToClipboard(r.code); addToast(t("redemptions.copied"), "success"); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </td>
                      <td className="py-2 pr-4">{r.quota}</td>
                      <td className="py-2 pr-4">{r.redeemed_count}/{r.count}</td>
                      <td className="py-2 pr-4">{r.status === 1 ? t("redemptions.active") : t("redemptions.disabled")}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          onClick={() => deleteMutation.mutate(r.id)} title={t("redemptions.delete")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}