import { useState, type FormEvent } from "react";
import { Activity, CheckCircle2, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { registerRequest } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Something went wrong");

function SignInForm() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(username, password);
    } catch (err) {
      setError(errorMessage(err));
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="login-username" className="text-xs">Username</Label>
        <Input id="login-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
      </div>
      <div className="space-y-1">
        <Label htmlFor="login-password" className="text-xs">Password</Label>
        <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={isSubmitting || !username.trim() || !password}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}

const EMPTY_REQUEST = { username: "", password: "", confirm: "", fullName: "", email: "" };

function RequestAccessForm() {
  const [form, setForm] = useState(EMPTY_REQUEST);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const validate = (): string | null => {
    if (!USERNAME_PATTERN.test(form.username.trim())) return "Username: 3-50 characters (letters, digits, . _ -)";
    if (form.password.length < MIN_PASSWORD_LENGTH) return `Password: at least ${MIN_PASSWORD_LENGTH} characters`;
    if (form.password !== form.confirm) return "Passwords do not match";
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) return "Email address is not valid";
    return null;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await registerRequest({
        username: form.username.trim(),
        password: form.password,
        full_name: form.fullName.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      setIsSent(true);
      setForm(EMPTY_REQUEST);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSent) {
    return (
      <div className="space-y-2 py-4 text-center text-sm">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
        <p className="font-medium">Request sent</p>
        <p className="text-xs text-muted-foreground">
          An administrator has to approve your account. You can sign in once it is approved.
        </p>
        <Button variant="outline" size="sm" onClick={() => setIsSent(false)}>Send another request</Button>
      </div>
    );
  }

  const field = (id: string, label: string, key: keyof typeof EMPTY_REQUEST, extra: { type?: string; autoComplete?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {field("req-username", "Username *", "username", { autoComplete: "username" })}
      {field("req-password", "Password *", "password", { type: "password", autoComplete: "new-password" })}
      {field("req-confirm", "Confirm password *", "confirm", { type: "password", autoComplete: "new-password" })}
      {field("req-fullname", "Full name", "fullName")}
      {field("req-email", "Email", "email", { type: "email" })}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={isSubmitting || !form.username.trim() || !form.password}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Request access
      </Button>
    </form>
  );
}

/** Οθόνη εισόδου: login για υπάρχοντες χρήστες, αίτημα πρόσβασης (εγκρίνεται από admin) για νέους. */
export default function LoginScreen() {
  const { notice } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <Activity className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">
              FASMETRICS <span className="text-red-500">Analytics</span>
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Sign in to continue</p>
          </div>
        </div>

        {notice && (
          <p role="status" className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </p>
        )}

        <Tabs defaultValue="signin">
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="signin" className="text-xs">Sign in</TabsTrigger>
            <TabsTrigger value="request" className="text-xs">Request access</TabsTrigger>
          </TabsList>
          <TabsContent value="signin"><SignInForm /></TabsContent>
          <TabsContent value="request"><RequestAccessForm /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
