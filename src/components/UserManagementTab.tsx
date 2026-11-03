import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Loader2, Trash2, UserPlus, Users, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth/AuthProvider";
import { approveUser, createUser, deleteUser, fetchUsers, rejectUser, resetUserPassword, type AppUser } from "@/lib/api";

const USERS_QUERY_KEY = ["users"] as const;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const EMPTY_FORM = { username: "", password: "", fullName: "", email: "" };

const validateForm = (form: typeof EMPTY_FORM): string | null => {
  if (!USERNAME_PATTERN.test(form.username.trim())) {
    return "Username: 3-50 characters (letters, digits, . _ -)";
  }
  if (form.password.length < MIN_PASSWORD_LENGTH) {
    return `Password: at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
    return "Email address is not valid";
  }
  return null;
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/** User Management tab: λίστα χρηστών + προσθήκη + διαγραφή (με επιβεβαίωση). */
export default function UserManagementTab() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: fetchUsers });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      setForm(EMPTY_FORM);
      toast({ title: "User added", description: user.username });
    },
    onError: (error: Error) => toast({ title: "Could not add user", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (user: AppUser) => deleteUser(user.id),
    onSuccess: (_result, user) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      toast({ title: "User deleted", description: user.username });
    },
    onError: (error: Error) => toast({ title: "Could not delete user", description: error.message, variant: "destructive" }),
    onSettled: () => setPendingDelete(null),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ user, accept }: { user: AppUser; accept: boolean }) =>
      accept ? approveUser(user.id) : rejectUser(user.id),
    onSuccess: (_result, { user, accept }) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      toast({ title: accept ? "Access approved" : "Request declined", description: user.username });
    },
    onError: (error: Error) => toast({ title: "Could not update request", description: error.message, variant: "destructive" }),
  });

  const closeResetDialog = () => {
    setResetTarget(null);
    setNewPassword("");
  };

  const resetMutation = useMutation({
    mutationFn: ({ user, password }: { user: AppUser; password: string }) => resetUserPassword(user.id, password),
    onSuccess: (_result, { user }) => {
      toast({ title: "Password reset", description: `${user.username} must sign in again with the new password.` });
      closeResetDialog();
    },
    onError: (error: Error) => toast({ title: "Could not reset password", description: error.message, variant: "destructive" }),
  });

  const handleResetSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (resetTarget) resetMutation.mutate({ user: resetTarget, password: newPassword });
  };

  const pendingUsers = (usersQuery.data ?? []).filter((u) => u.status === "pending");

  const formError = form.username || form.password ? validateForm(form) : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const error = validateForm(form);
    if (error) {
      toast({ title: "Invalid input", description: error, variant: "destructive" });
      return;
    }
    createMutation.mutate({
      username: form.username.trim(),
      password: form.password,
      full_name: form.fullName.trim() || undefined,
      email: form.email.trim() || undefined,
    });
  };

  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const users = usersQuery.data ?? [];
    if (!needle) return users;
    return users.filter((u) =>
      [u.username, u.full_name, u.email].some((field) => field?.toLowerCase().includes(needle)),
    );
  }, [usersQuery.data, search]);

  return (
    <div className="space-y-4">
      {pendingUsers.length > 0 && (
        <section aria-label="Access requests" className="rounded-lg border border-amber-500/40 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4 text-amber-400" /> Access requests ({pendingUsers.length})
          </h2>
          <ul className="divide-y divide-border">
            {pendingUsers.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{request.username}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {[request.full_name, request.email].filter(Boolean).join(" · ")}
                  </span>
                  <div className="text-[11px] text-muted-foreground">Requested {formatDate(request.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decisionMutation.isPending}
                    onClick={() => decisionMutation.mutate({ user: request, accept: true })}
                  >
                    <Check className="mr-1 h-4 w-4" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decisionMutation.isPending}
                    onClick={() => decisionMutation.mutate({ user: request, accept: false })}
                  >
                    <X className="mr-1 h-4 w-4" /> Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4" /> Add user <span className="text-xs font-normal text-muted-foreground">(active immediately)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="um-username" className="text-xs">Username *</Label>
            <Input
              id="um-username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              maxLength={50}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="um-password" className="text-xs">Password *</Label>
            <Input
              id="um-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="um-fullname" className="text-xs">Full name</Label>
            <Input
              id="um-fullname"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="um-email" className="text-xs">Email</Label>
            <Input
              id="um-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              maxLength={255}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={createMutation.isPending || !form.username.trim() || !form.password || !!formError}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add user
            </Button>
          </div>
        </div>
        {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
      </form>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" /> Users {usersQuery.data && `(${usersQuery.data.length})`}
          </h2>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="h-8 w-56 text-xs"
            aria-label="Search users"
          />
        </div>

        {usersQuery.isError ? (
          <div className="space-y-2 text-sm">
            <p className="text-destructive">Could not load users: {(usersQuery.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => usersQuery.refetch()}>Retry</Button>
          </div>
        ) : usersQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Full name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {usersQuery.data?.length ? "No users match the search." : "No users yet."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.username}
                      {user.is_admin && <Badge className="ml-2">admin</Badge>}
                    </TableCell>
                    <TableCell>{user.full_name ?? "—"}</TableCell>
                    <TableCell>{user.email ?? "—"}</TableCell>
                    <TableCell>
                      {user.status !== "active" && <Badge variant="secondary">{user.status}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(user.created_at)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Reset password for ${user.username}`}
                        onClick={() => setResetTarget(user)}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      {user.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${user.username}`}
                          onClick={() => setPendingDelete(user)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && closeResetDialog()}>
        <DialogContent>
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>
                Set a new password for {resetTarget?.username}. Their open sessions will be signed out.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="um-new-password" className="text-xs">New password</Label>
              <Input
                id="um-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                maxLength={MAX_PASSWORD_LENGTH}
                autoComplete="new-password"
                autoFocus
              />
              {newPassword && newPassword.length < MIN_PASSWORD_LENGTH && (
                <p className="text-xs text-destructive">At least {MIN_PASSWORD_LENGTH} characters</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeResetDialog}>Cancel</Button>
              <Button type="submit" disabled={resetMutation.isPending || newPassword.length < MIN_PASSWORD_LENGTH}>
                {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.username} will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
