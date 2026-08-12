"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  isSignInAllowedEmail,
  JIRA_API_TOKEN_CREATE_URL,
  SIGN_IN_EMAIL_DOMAIN,
} from "@/constants/signIn";
import { safeCallbackUrl } from "@/lib/ui/safeCallbackUrl";

type SquadOption = { id: string; name: string; role: "em" | "editor" | "reviewer" };

const TOKEN_CREATE_FLAG = "sprint-planner:jira-token-create";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"), "/");
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [step, setStep] = useState<"credentials" | "squad">("credentials");
  const [squadOptions, setSquadOptions] = useState<SquadOption[]>([]);
  const [selectedSquadId, setSelectedSquadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [returnedFromTokenCreate, setReturnedFromTokenCreate] = useState(false);

  useEffect(() => {
    const markReturned = () => {
      try {
        if (sessionStorage.getItem(TOKEN_CREATE_FLAG) === "1") {
          setReturnedFromTokenCreate(true);
          sessionStorage.removeItem(TOKEN_CREATE_FLAG);
        }
      } catch {
        // ignore
      }
    };
    markReturned();
    window.addEventListener("focus", markReturned);
    return () => window.removeEventListener("focus", markReturned);
  }, []);

  const resetToCredentials = () => {
    setStep("credentials");
    setSquadOptions([]);
    setSelectedSquadId("");
    setError(null);
  };

  const openJiraTokenCreate = () => {
    try {
      sessionStorage.setItem(TOKEN_CREATE_FLAG, "1");
    } catch {
      // ignore
    }
    window.open(JIRA_API_TOKEN_CREATE_URL, "_blank", "noopener,noreferrer");
  };

  const completeSignIn = async (squadId: string) => {
    setPending(true);
    const result = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      apiKey,
      squadId,
      redirect: false,
      callbackUrl,
    });
    setPending(false);
    if (result?.error) {
      setError("Email or Jira API token could not be verified.");
      return;
    }
    setApiKey("");
    try {
      sessionStorage.removeItem(TOKEN_CREATE_FLAG);
    } catch {
      // ignore
    }
    window.location.href = callbackUrl;
  };

  const onCredentialsSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!isSignInAllowedEmail(normalizedEmail)) {
      setError(`Only @${SIGN_IN_EMAIL_DOMAIN} emails can sign in.`);
      return;
    }
    if (!apiKey.trim()) {
      setError("Paste your Jira API token.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/pre-sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, apiKey }),
      });
      if (!response.ok) {
        setPending(false);
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || "Email or Jira API token could not be verified.");
        return;
      }
      const data = (await response.json()) as {
        needsSquadPicker?: boolean;
        squads?: SquadOption[];
      };
      const squads = data.squads ?? [];
      if (!data.needsSquadPicker || squads.length <= 1) {
        const onlyId = squads[0]?.id ?? "";
        setPending(false);
        await completeSignIn(onlyId);
        return;
      }
      setSquadOptions(squads);
      setSelectedSquadId(squads[0]?.id ?? "");
      setStep("squad");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  const onSquadSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!selectedSquadId) {
      setError("Choose a squad.");
      return;
    }
    await completeSignIn(selectedSquadId);
  };

  return (
    <main className="sign-in-page">
      <section className="sign-in-aside" aria-label="Product">
        <div className="sign-in-aside-inner">
          <p className="sign-in-aside-name">Sprint Planner</p>
          <p className="sign-in-aside-tag">Plan FE, BE, and QC work in one sprint board.</p>
        </div>
      </section>

      <section className="sign-in-main">
        <div className={`sign-in-panel sign-in-panel-boxed${step === "squad" ? " sign-in-panel-squad" : ""}`}>
          {step === "credentials" ? (
            <>
              <header className="sign-in-header">
                <p className="sign-in-kicker">Account</p>
                <h1 className="sign-in-heading">Sign in</h1>
                <p className="sign-in-sub">
                  Use your @{SIGN_IN_EMAIL_DOMAIN} email and a personal Jira API token. Verified with Jira each time.
                </p>
              </header>

              <form onSubmit={onCredentialsSubmit} className="sign-in-form">
                {returnedFromTokenCreate ? (
                  <p className="sign-in-note" role="status">
                    Welcome back — paste your new token below.
                  </p>
                ) : null}

                <label className="sign-in-field">
                  <span className="sign-in-label">Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    className="sign-in-control"
                    placeholder={`you@${SIGN_IN_EMAIL_DOMAIN}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>

                <label className="sign-in-field">
                  <span className="sign-in-label-row">
                    <span className="sign-in-label">Jira API token</span>
                    <button type="button" className="sign-in-text-btn" onClick={() => setShowApiKey((v) => !v)}>
                      {showApiKey ? "Hide" : "Show"}
                    </button>
                  </span>
                  <input
                    type={showApiKey ? "text" : "password"}
                    autoComplete="off"
                    required
                    className="sign-in-control"
                    placeholder="Paste token"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </label>

                <div className="sign-in-token-row">
                  <span>New to Jira tokens?</span>
                  <button type="button" className="sign-in-text-btn" onClick={openJiraTokenCreate}>
                    Create one on Atlassian
                  </button>
                </div>

                {error ? <p className="sign-in-error">{error}</p> : null}

                <button type="submit" className="sign-in-primary" disabled={pending}>
                  {pending ? "Verifying…" : "Continue"}
                </button>
              </form>
            </>
          ) : (
            <>
              <header className="sign-in-header">
                <p className="sign-in-kicker">Workspace</p>
                <h1 className="sign-in-heading">Choose squad</h1>
                <p className="sign-in-sub">Open one workspace now. You can switch later from the sidebar.</p>
              </header>

              <form onSubmit={onSquadSubmit} className="sign-in-form">
                <fieldset className="sign-in-squad-list">
                  <legend className="sr-only">Squad</legend>
                  {squadOptions.map((s) => {
                    const selected = selectedSquadId === s.id;
                    return (
                      <label
                        key={s.id}
                        className={`sign-in-squad-option${selected ? " sign-in-squad-option-selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="squad"
                          className="sign-in-squad-radio"
                          checked={selected}
                          onChange={() => setSelectedSquadId(s.id)}
                        />
                        <span className="sign-in-squad-copy">
                          <span className="sign-in-squad-name">{s.name}</span>
                          <span className="sign-in-squad-role">
                            {s.role === "em" ? "Manager" : s.role === "editor" ? "Editor" : "Viewer"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                {error ? <p className="sign-in-error">{error}</p> : null}

                <div className="sign-in-row">
                  <button type="button" className="sign-in-secondary" disabled={pending} onClick={resetToCredentials}>
                    Back
                  </button>
                  <button type="submit" className="sign-in-primary" disabled={pending}>
                    {pending ? "Opening…" : "Open squad"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="sign-in-page">
          <section className="sign-in-aside" aria-hidden>
            <div className="sign-in-aside-inner">
              <p className="sign-in-aside-name">Sprint Planner</p>
            </div>
          </section>
          <section className="sign-in-main">
            <p className="sign-in-loading">Loading…</p>
          </section>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
