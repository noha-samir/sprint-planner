"use client";

import { HelpDocs } from "@/components/docs/HelpDocs";

/**
 * Authenticated Help page — product roles, tabs, and workflows.
 */
export default function DocsPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 overflow-hidden">
      <section className="page-card min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <HelpDocs />
      </section>
    </main>
  );
}
