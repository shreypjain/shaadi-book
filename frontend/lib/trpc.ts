/**
 * tRPC vanilla client — Task 4.3
 *
 * Uses createTRPCProxyClient so admin pages can call the backend without
 * a React Query provider. The auth header is injected lazily (at request
 * time) so this module is safe to import from any client component.
 *
 * Requests go through Next.js's /api rewrite so there are no CORS issues
 * in dev (see next.config.js).
 */

import { createTRPCProxyClient, httpLink } from "@trpc/client";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { AppRouter } from "../../backend/src/index";
import { getToken } from "./auth";

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpLink({
      url: "/api/trpc",
      headers: () => {
        const token = getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export type { AppRouter };
