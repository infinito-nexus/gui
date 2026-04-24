"use client";

import { useLayoutEffect } from "react";

const CSRF_COOKIE_NAME = "csrf";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string) {
  const prefix = `${name}=`;
  return (
    document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
}

export default function CsrfFetchBootstrap() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    const bootstrapFlag = "__infinitoCsrfBootstrapReady";
    let csrfPrimePromise: Promise<string> | null = null;

    const ensureCsrfCookie = async () => {
      const existing = readCookie(CSRF_COOKIE_NAME);
      if (existing) {
        return existing;
      }
      if (!csrfPrimePromise) {
        csrfPrimePromise = nativeFetch("/api/workspaces", {
          cache: "no-store",
          credentials: "same-origin",
        })
          .catch(() => null)
          .then(() => {
            const nextToken = readCookie(CSRF_COOKIE_NAME);
            csrfPrimePromise = null;
            return nextToken;
          });
      }
      return (await csrfPrimePromise) || "";
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url, window.location.href);

      if (
        url.origin === window.location.origin &&
        STATE_CHANGING_METHODS.has(request.method.toUpperCase())
      ) {
        const csrfToken = (await ensureCsrfCookie()) || readCookie(CSRF_COOKIE_NAME);
        if (csrfToken) {
          const headers = new Headers(request.headers);
          headers.set("X-CSRF", csrfToken);
          return nativeFetch(new Request(request, { headers }));
        }
      }

      return nativeFetch(request);
    };
    Reflect.set(window, bootstrapFlag, true);

    return () => {
      window.fetch = nativeFetch;
      Reflect.deleteProperty(window, bootstrapFlag);
    };
  }, []);

  return null;
}
