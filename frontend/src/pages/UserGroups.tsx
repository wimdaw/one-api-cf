import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Channel } from "@/types";
import { PageContainer } from "@/components/ui/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Users2, Link2, UserPlus, Link2Off, UserMinus, ShieldCheck, Plus, Trash2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

type GroupInfo = {
  name: string;
  member_count: number;
  channel_count: number;
};

const parseChannelConfig = (channel: Channel): { name: string; groups?: string[] } => {
  if (typeof channel.value !== "string") {
    return channel.value as { name: string; groups?: string[] };
  }
  try {
    return JSON.parse(channel.value) as { name: string; groups?: string[] };
  } catch {
    return { name: channel.key };
  }
};

export function UserGroups() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);
  const [addUserTo, setAddUserTo] = useState<GroupInfo | null>(null);
  const [addChannelTo, setAddChannelTo] = useState<GroupInfo | null>(null);
  const [pendingUser, setPendingUser] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["groups"] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
    queryClient.invalidateQueries({ queryKey: ["channels"] });
  };

  const { data: groups, refetch: refetchGroups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await apiClient.listGroups();
      return (res.data as unknown as { groups?: GroupInfo[] })?.groups ?? [];
    },
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await apiClient.listUsers()).data?.users ?? [],
  });

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await apiClient.getChannels()).data as Channel[] ?? [],
  });

  const setUserGroupMutation = useMutation({
    mutationFn: ({ userId, group }: { userId: number; group: string }) =>
      apiClient.setUserGroup({ user_id: userId, group }),
    onSuccess: () => {
      invalidate();
      addToast(t("userGroups.userGroupUpdated"), "success");
    },
    onError: (error: Error) => addToast(error.message, "error"),
  });

  const setChannelGroupMutation = useMutation({
    mutationFn: ({ key, groups }: { key: string; groups: string[] }) =>
      apiClient.setChannelGroup({ key, groups }),
    onSuccess: () => {
      invalidate();
      addToast(t("userGroups.channelGroupUpdated"), "success");
    },
    onError: (error: Error) => addToast(error.message, "error"),
  });

  const createGroupMutation = useMutation({
    mutationFn: () => apiClient.createGroup({ name: newGroupName.trim(), description: newGroupDesc.trim() || undefined }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setNewGroupName("");
      setNewGroupDesc("");
      addToast(t("userGroups.groupCreated"), "success");
    },
    onError: (error: Error) => addToast(error.message, "error"),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (name: string) => apiClient.deleteGroup(name),
    onSuccess: () => {
      invalidate();
      setSelectedGroup(null);
      addToast(t("userGroups.groupDeleted"), "success");
    },
    onError: (error: Error) => addToast(error.message, "error"),
  });

  // 组内用户
  const groupUsers = useMemo(() => {
    if (!selectedGroup || !users) return [];
    return users.filter((u) => (u as unknown as { user_group?: string }).user_group === selectedGroup.name);
  }, [selectedGroup, users]);

  // 组内渠道 (渠道 groups 包含该组或为空=所有组可用)
  const groupChannels = useMemo(() => {
    if (!selectedGroup || !channels) return [];
    return channels.filter((ch) => {
      const cfg = parseChannelConfig(ch);
      const gs = cfg.groups;
      if (!gs || gs.length === 0) return true; // 空 = 所有组
      return gs.includes(selectedGroup.name);
    });
  }, [selectedGroup, channels]);

  // 可加入该组的用户 (当前不在该组)
  const availableUsers = useMemo(() => {
    if (!addUserTo || !users) return [];
    return users.filter((u) => (u as unknown as { user_group?: string }).user_group !== addUserTo.name);
  }, [addUserTo, users]);

  // 可加入该组的渠道 (当前 groups 不含该组)
  const availableChannels = useMemo(() => {
    if (!addChannelTo || !channels) return [];
    return channels.filter((ch) => {
      const cfg = parseChannelConfig(ch);
      const gs = cfg.groups;
      return gs && gs.length > 0 && !gs.includes(addChannelTo.name);
    });
  }, [addChannelTo, channels]);

  const toggleChannelGroup = (channel: Channel, groupName: string, remove: boolean) => {
    const cfg = parseChannelConfig(channel);
    const current = cfg.groups && cfg.groups.length > 0 ? [...cfg.groups] : [];
    const next = remove
      ? current.filter((g) => g !== groupName)
      : [...new Set([...current, groupName])];
    setChannelGroupMutation.mutate({ key: channel.key, groups: next });
  };

  const stats = useMemo(() => {
    const totalUsers = users?.length ?? 0;
    const totalChannels = channels?.length ?? 0;
    const totalGroups = groups?.length ?? 0;
    const defaultGroupUsers = users?.filter(
      (u) => !(u as unknown as { user_group?: string }).user_group
        || (u as unknown as { user_group?: string }).user_group === "default"
    ).length ?? 0;
    return { totalUsers, totalChannels, totalGroups, defaultGroupUsers };
  }, [users, channels, groups]);

  return (
    <PageContainer
      title={t("userGroups.title")}
      description={t("userGroups.description")}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchGroups()}>
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">{t("common.refresh")}</span>
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">{t("userGroups.createGroup")}</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 统计卡 */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-0">
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{t("userGroups.statGroups")}</div>
              <div className="mt-1 text-2xl font-semibold">{stats.totalGroups}</div>
            </CardContent>
          </Card>
          <Card className="border-0">
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{t("userGroups.statUsers")}</div>
              <div className="mt-1 text-2xl font-semibold">{stats.totalUsers}</div>
            </CardContent>
          </Card>
          <Card className="border-0">
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{t("userGroups.statChannels")}</div>
              <div className="mt-1 text-2xl font-semibold">{stats.totalChannels}</div>
            </CardContent>
          </Card>
          <Card className="border-0">
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{t("userGroups.statDefaultUsers")}</div>
              <div className="mt-1 text-2xl font-semibold">{stats.defaultGroupUsers}</div>
            </CardContent>
          </Card>
        </div>

        {/* 组列表 */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(groups ?? []).map((g) => (
            <Card key={g.name} className="border-0">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{g.name}</span>
                    {(g as unknown as { explicit?: boolean }).explicit && (
                      <Badge variant="outline" className="text-[10px]">{t("userGroups.explicitBadge")}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={g.name === "default" ? "secondary" : "default"}>{g.name === "default" ? "default" : "group"}</Badge>
                    {g.name !== "default" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        title={t("userGroups.deleteGroup")}
                        onClick={() => {
                          if (window.confirm(t("userGroups.deleteGroupConfirm", { name: g.name }))) {
                            deleteGroupMutation.mutate(g.name);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users2 className="h-3.5 w-3.5" />
                    {t("userGroups.memberCount", { count: g.member_count })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Link2 className="h-3.5 w-3.5" />
                    {t("userGroups.channelCount", { count: g.channel_count })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setSelectedGroup(g)}>
                    <Users2 className="h-3.5 w-3.5" />
                    {t("userGroups.manageMembers")}
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddChannelTo(g)}>
                    <Link2 className="h-3.5 w-3.5" />
                    {t("userGroups.manageChannels")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!groups || groups.length === 0) && (
            <Card className="border-0 md:col-span-2 xl:col-span-3">
              <CardContent className="p-10 text-center text-muted-foreground">
                {t("userGroups.empty")}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 组成员详情弹窗 */}
        <Dialog open={selectedGroup !== null} onOpenChange={(o) => !o && setSelectedGroup(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("userGroups.groupDetailTitle", { name: selectedGroup?.name ?? "" })}</DialogTitle>
              <DialogDescription>{t("userGroups.groupDetailDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* 组内用户 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Users2 className="h-4 w-4" />
                    {t("userGroups.members")}
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setAddUserTo(selectedGroup); setPendingUser(""); }}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {t("userGroups.addUser")}
                  </Button>
                </div>
                {groupUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3">{t("userGroups.noMembers")}</p>
                ) : (
                  <div className="divide-y divide-border/60 rounded-md border border-border/60">
                    {groupUsers.map((u) => (
                      <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{u.username}</span>
                          <span className="text-xs text-muted-foreground truncate">{u.email || "-"}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title={t("userGroups.removeUser")}
                          onClick={() => {
                            if (window.confirm(t("userGroups.removeUserConfirm", { username: u.username }))) {
                              setUserGroupMutation.mutate({ userId: u.id, group: "default" });
                            }
                          }}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 组内渠道 */}
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                  <Link2 className="h-4 w-4" />
                  {t("userGroups.channels")}
                </h4>
                {groupChannels.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3">{t("userGroups.noChannels")}</p>
                ) : (
                  <div className="divide-y divide-border/60 rounded-md border border-border/60">
                    {groupChannels.map((ch) => {
                      const cfg = parseChannelConfig(ch);
                      const explicit = cfg.groups && cfg.groups.length > 0;
                      return (
                        <div key={ch.key} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">{cfg.name || ch.key}</span>
                            <Badge variant="secondary" className="text-[10px]">{ch.key}</Badge>
                            {!explicit && (
                              <Badge variant="outline" className="text-[10px]">{t("userGroups.allGroups")}</Badge>
                            )}
                          </div>
                          {explicit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              title={t("userGroups.removeChannel")}
                              onClick={() => {
                                if (window.confirm(t("userGroups.removeChannelConfirm", { name: cfg.name || ch.key }))) {
                                  toggleChannelGroup(ch, selectedGroup!.name, true);
                                }
                              }}
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{t("userGroups.availableToAll")}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedGroup(null)}>{t("common.close")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 添加用户弹窗 */}
        <Dialog open={addUserTo !== null} onOpenChange={(o) => !o && setAddUserTo(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("userGroups.addUserTitle", { name: addUserTo?.name ?? "" })}</DialogTitle>
              <DialogDescription>{t("userGroups.addUserDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Select value={pendingUser} onChange={(e) => setPendingUser(e.target.value)}>
                <option value="">{t("userGroups.selectUser")}</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username} ({u.email || "no email"})
                  </option>
                ))}
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddUserTo(null)}>{t("common.cancel")}</Button>
              <Button
                disabled={!pendingUser || !addUserTo}
                onClick={() => {
                  setUserGroupMutation.mutate({ userId: Number(pendingUser), group: addUserTo!.name });
                  setAddUserTo(null);
                  setPendingUser("");
                }}
              >
                {t("common.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 添加渠道弹窗 */}
        <Dialog open={addChannelTo !== null} onOpenChange={(o) => !o && setAddChannelTo(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("userGroups.addChannelTitle", { name: addChannelTo?.name ?? "" })}</DialogTitle>
              <DialogDescription>{t("userGroups.addChannelDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {availableChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("userGroups.noAvailableChannels")}</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-border/60 rounded-md border border-border/60">
                  {availableChannels.map((ch) => {
                    const cfg = parseChannelConfig(ch);
                    return (
                      <button
                        key={ch.key}
                        type="button"
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50"
                        onClick={() => {
                          toggleChannelGroup(ch, addChannelTo!.name, false);
                          setAddChannelTo(null);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{cfg.name || ch.key}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{ch.key}</Badge>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddChannelTo(null)}>{t("common.close")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 新建组弹窗 */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("userGroups.createGroupTitle")}</DialogTitle>
              <DialogDescription>{t("userGroups.createGroupDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("userGroups.groupName")}</Label>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="vip / internal / beta..."
                  maxLength={32}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("userGroups.groupDescription")}</Label>
                <Input
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder={t("userGroups.groupDescriptionPlaceholder")}
                  maxLength={100}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
              <Button
                onClick={() => createGroupMutation.mutate()}
                disabled={!newGroupName.trim() || createGroupMutation.isPending}
              >
                {t("userGroups.createGroup")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageContainer>
  );
}
