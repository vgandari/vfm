/**
 * RegistryContext.tsx
 *
 * React context for sharing a merged NormalizedRegistry across multiple
 * MarkdownRenderer components in the SPA lazy-load use case.
 *
 * Usage:
 *   // Wrap all MarkdownRenderer components in a provider:
 *   <MarkdownRegistryProvider>
 *     <MarkdownRenderer id={a} content={markdown} />
 *     <MarkdownRenderer id={b} content={markdown} />
 *   </MarkdownRegistryProvider>
 *
 *   // Each MarkdownRenderer automatically registers its entries and
 *   // re-renders when the merged registry updates.
 *
 * Static site usage (no context needed):
 *   const registries = pages.map(p => collectRegistry(p.content, p.options));
 *   const merged = mergeRegistries(registries);
 *   // pass merged as registry prop to each MarkdownRenderer
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { NormalizedRegistry } from "./registry";
import { mergeRegistries } from "./pipeline";

interface MarkdownRegistryContextValue {
  registry: NormalizedRegistry;
  registerEntries: (componentId: string, registry: NormalizedRegistry) => void;
  unregisterEntries: (componentId: string) => void;
}

const MarkdownRegistryContext =
  createContext<MarkdownRegistryContextValue | null>(null);

function isNonEmpty(r: NormalizedRegistry | null | undefined): boolean {
  return !!r && !r.keys().next().done;
}

export function MarkdownRegistryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [componentRegistries, setComponentRegistries] = useState<Map<string, NormalizedRegistry>>(new Map<string, NormalizedRegistry>());

  const mergedRegistry = useMemo(
    () => mergeRegistries(Array.from(componentRegistries.values())),
    [componentRegistries]
  );

  const registerEntries = useCallback(
    (componentId: string, registry: NormalizedRegistry) => {
      setComponentRegistries((prev) => {
        const next = new Map(prev);
        next.set(componentId, registry);
        return next;
      });
    },
    []
  );

  const unregisterEntries = useCallback((componentId: string) => {
    setComponentRegistries((prev) => {
      const next = new Map(prev);
      next.delete(componentId);
      return next;
    });
  }, []);

  return (
    <MarkdownRegistryContext.Provider
      value={{
        registry: mergedRegistry,
        registerEntries,
        unregisterEntries,
      }}
    >
      {children}
    </MarkdownRegistryContext.Provider>
  );
}

export function useMarkdownRegistry(): MarkdownRegistryContextValue | null {
  return useContext(MarkdownRegistryContext);
}
