import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { AdminUser } from "@/types";
import { formatUsd } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, KeyRound, UserCog, Ban, CheckCircle2, Coins, Users2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBillingConfig } from "@/hooks/use-billing-config";

const ROLE_USER = 1;
const ROLE_ADMIN = 10;
const ROLE_ROOT = 100;
const STATUS_ENABLED = 1;
const STATUS_DISABLED = 2;

export function Users() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: billingConfig } = useBillingConfig();
  const displayDecimals = billingConfig?.displayDecimals ?? 6;
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ username: "", password: "", email: "", quota: "0" });
  const [topUpTarget, setTopUpTarget] = useState<AdminUser | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("10");
  const [topUpRemark, setTopUpRemark] = useState("");
  const [groupTarget, setGroupTarget] = useState<AdminUser | null>(null);
  const [groupValue, setGroupValue] = useState("default");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await apiClient.listUsers();
      return res.data?.users ?? [];
    },
  });

  const users = (data ?? []).filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMutation = useMutation({
    mutationFn: () => apiClient.createUser({
      username: form.username,
      password: form.password,
      email: form.email,
      quota: Number(form.quota) || 0,
    }),
    onSuccess: () => { invalidate(); setShowCreate(false); resetForm(); addToast(t("users.created"), "success"); },
  });

  const updateMutation = useMutation({
    mutationFn: (id: number) => apiClient.updateUser(id, {
      email: form.email,
      password: form.password || undefined,
      quota: form.quota !== "" ? Number(form.quota) : undefined,
    }),
    onSuccess: () => { invalidate(); setEditing(null); resetForm(); addToast(t("users.updated"), "success"); },
  });

  const toggleRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: number }) =>
      apiClient.updateUser(id, { role: role >= ROLE_ADMIN ? ROLE_USER : ROLE_ADMIN }),
    onSuccess: () => { invalidate(); addToast(t("users.updated"), "success"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteUser(id),
    onSuccess: () => { invalidate(); addToast(t("users.deleted"), "success"); },
  });

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await apiClient.listGroups();
      const raw = res.data as unknown as { groups?: Array<{ name: string }> } | null;
      return raw?.groups ?? [];
    },
  });

  const manageMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "disable" | "enable" | "promote" | "demote" }) =>
      apiClient.manageUser({ user_id: id, action }),
    onSuccess: () => { invalidate(); addToast(t("users.updated"), "success"); },
  });

  const topUpMutation = useMutation({
    mutationFn: () => {
      if (!topUpTarget) throw new Error("no target");
      return apiClient.adminTopUp({
        user_id: topUpTarget.id,
        quota: Number(topUpAmount) || 0,
        remark: topUpRemark || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      setTopUpTarget(null);
      setTopUpAmount("10");
      setTopUpRemark("");
      addToast(t("users.topUpSuccess"), "success");
    },
  });

  const setGroupMutation = useMutation({
    mutationFn: () => {
      if (!groupTarget) throw new Error("no target");
      return apiClient.setUserGroup({ user_id: groupTarget.id, group: groupValue });
    },
    onSuccess: () => {
      invalidate();
      setGroupTarget(null);
      addToast(t("users.groupUpdated"), "success");
    },
  });

  const resetForm = () => setForm({ username: "", password: "", email: "", quota: "0" });

  const resetPassword = (u: AdminUser) => {
    const pwd = window.prompt(t("users.resetPasswordPrompt"));
    if (!pwd) return;
    apiClient.updateUser(u.id, { password: pwd }).then(() => {
      invalidate(); addToast(t("users.updated"), "success");
    });
  };

  const roleLabel = (role: number) => {
    if (role >= ROLE_ROOT) return t("users.roleRoot");
    if (role >= ROLE_ADMIN) return t("users.roleAdmin");
    return t("users.roleUser");
  };

  const statusLabel = (status: number) => status === STATUS_ENABLED ? t("users.statusEnabled") : t("users.statusDisabled");

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            {t("users.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("users.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-1" />
            {t("users.create")}
          </Button>
        </div>
      </div>

      <Card className="border-0">
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("users.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="text-center text-muted-foreground py-10">{t("common.loading")}</div>
          ) : users.length === 0 ? (
            <div className="text-center text-muted-foreground py-10">{t("users.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">ID</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("users.username")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("users.email")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("users.role")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("users.status")}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t("users.group")}</th>
                    <th className="text-right py-2 pr-4 font-medium">{t("users.balance")}</th>
                    <th className="text-right py-2 font-medium">{t("users.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 pr-4">{u.id}</td>
                      <td className="py-2 pr-4 font-medium">{u.username}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{u.email || "-"}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={u.role >= ROLE_ADMIN ? "default" : "secondary"}>{roleLabel(u.role)}</Badge>
                          {u.role < ROLE_ROOT && (
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => toggleRoleMutation.mutate({ id: u.id, role: u.role })}
                              title={t("users.toggleRoleTitle")}>
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={u.status === STATUS_ENABLED ? "success" : "destructive"}>{statusLabel(u.status)}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {(u as unknown as { user_group?: string }).user_group || "default"}
                      </td>
                      <td className="py-2 pr-4 text-right">{u.balance < 0 ? t("common.unlimited") : formatUsd(u.balance, displayDecimals)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {u.status === STATUS_ENABLED ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            onClick={() => manageMutation.mutate({ id: u.id, action: "disable" })}
                            title={t("users.disable")}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600"
                            onClick={() => manageMutation.mutate({ id: u.id, action: "enable" })}
                            title={t("users.enable")}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setTopUpTarget(u); setTopUpAmount("10"); setTopUpRemark(""); }}
                          title={t("users.topUp")}>
                          <Coins className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setGroupTarget(u); setGroupValue((u as unknown as { user_group?: string }).user_group || "default"); }}
                          title={t("users.setGroup")}>
                          <Users2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setEditing(u); setForm({ username: u.username, password: "", email: u.email || "", quota: String(u.quota) }); }}
                          title={t("users.edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => resetPassword(u)} title={t("users.resetPassword")}>
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          onClick={() => {
                            if (window.confirm(t("users.deleteConfirm"))) deleteMutation.mutate(u.id);
                          }}
                          title={t("users.delete")}>
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

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.create")}</DialogTitle>
            <DialogDescription>{t("users.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("users.username")}</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.password")}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <Label>{t("users.quota")}</Label>
              <Input type="number" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.username || !form.password || createMutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.editUser", { username: editing?.username ?? "" })}</DialogTitle>
            <DialogDescription>{t("users.editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("users.email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <Label>{t("users.newPassword")}</Label>
              <Input type="password" placeholder={t("users.leaveBlank")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.quota")}</Label>
              <Input type="number" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => editing && updateMutation.mutate(editing.id)} disabled={updateMutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top Up Dialog */}
      <Dialog open={topUpTarget !== null} onOpenChange={(o) => !o && setTopUpTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.topUpTitle", { username: topUpTarget?.username ?? "" })}</DialogTitle>
            <DialogDescription>{t("users.topUpDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("users.topUpAmount")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("users.topUpAmountHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("users.topUpRemark")}</Label>
              <Input value={topUpRemark} onChange={(e) => setTopUpRemark(e.target.value)} placeholder={t("users.topUpRemarkPlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => topUpMutation.mutate()} disabled={!topUpAmount || Number(topUpAmount) <= 0 || topUpMutation.isPending}>
              {t("users.topUpConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Dialog */}
      <Dialog open={groupTarget !== null} onOpenChange={(o) => !o && setGroupTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.setGroupTitle", { username: groupTarget?.username ?? "" })}</DialogTitle>
            <DialogDescription>{t("users.setGroupDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t("users.group")}</Label>
            <div className="flex flex-wrap gap-2">
              {(groups && groups.length > 0 ? groups : [{ name: "default" }]).map((g) => (
                <Button
                  key={g.name}
                  type="button"
                  variant={groupValue === g.name ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGroupValue(g.name)}
                >
                  {g.name}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupTarget(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => setGroupMutation.mutate()} disabled={setGroupMutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}