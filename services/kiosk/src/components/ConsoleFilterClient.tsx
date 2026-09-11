"use client";

import { useEffect } from "react";
import { installConsoleFilter } from "@/lib/consoleFilter";

/**
 * Installs the benign-WASM-log console filter once on the client.
 * Server component layout imports this so filtering is active for every page.
 */
export function ConsoleFilterClient() {
  useEffect(() => {
    installConsoleFilter();
  }, []);
  return null;
}
