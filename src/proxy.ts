import { auth } from "@/auth";
import { clientIpFromRequest, consumeRateLimit } from "@/lib/security/rateLimit";
import { safeCallbackUrl } from "@/lib/ui/safeCallbackUrl";

export default auth((req) => {
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/auth")) {
    if (req.method === "POST") {
      const ip = clientIpFromRequest(req);
      const limited = consumeRateLimit(`auth-post:${ip}`, 30, 60_000);
      if (!limited.ok) {
        return Response.json(
          { error: "Too many authentication attempts. Try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(limited.retryAfterSec) },
          },
        );
      }
    }
    return;
  }

  if (path === "/login") {
    const target = req.auth ? "/" : "/sign-in";
    return Response.redirect(new URL(target, req.url));
  }
  if (path === "/sign-in") {
    return;
  }

  const revoked = (req.auth as { error?: string } | null)?.error === "SessionRevoked";
  if (!req.auth || revoked) {
    if (path.startsWith("/api/")) {
      return Response.json(
        { error: revoked ? "Session revoked" : "Unauthorized" },
        { status: 401 },
      );
    }
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("callbackUrl", safeCallbackUrl(path, "/"));
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
