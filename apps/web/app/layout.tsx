import "bootstrap/dist/css/bootstrap.min.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Infinito.Nexus Store",
  description: "Software on your infrastructure. Data under your control.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const csrfBootstrapScript = `
(() => {
  if (window.__infinitoCsrfBootstrapReady) return;
  const CSRF_COOKIE_NAME = "csrf";
  const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const nativeFetch = window.fetch.bind(window);
  const readCookie = (name) => {
    const prefix = name + "=";
    return (
      document.cookie
        .split(";")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(prefix))
        ?.slice(prefix.length) || ""
    );
  };

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.href);

    if (
      url.origin === window.location.origin &&
      STATE_CHANGING_METHODS.has(request.method.toUpperCase())
    ) {
      const csrfToken = readCookie(CSRF_COOKIE_NAME);
      if (csrfToken) {
        const headers = new Headers(request.headers);
        headers.set("X-CSRF", csrfToken);
        return nativeFetch(new Request(request, { headers }));
      }
    }

    return nativeFetch(request);
  };

  window.__infinitoCsrfBootstrapReady = true;
})();
`.trim();

  return (
    <html lang="en">
      <body className="deployer-body">
        <script
          data-infinito-csp-bootstrap="true"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: "window.__infinitoCspBootstrap = true;",
          }}
        />
        <script
          data-infinito-csrf-bootstrap="true"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: csrfBootstrapScript,
          }}
        />
        {children}
      </body>
    </html>
  );
}
