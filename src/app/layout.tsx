import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { AppProviders } from "@/components/providers/AppProviders";
import { PlannerServerSync } from "@/components/sync/PlannerServerSync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sprint Planner",
  description: "Parallel FE/BE/QC sprint scheduling",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-dvh min-h-0 antialiased`}
    >
      <body className="h-dvh min-h-0 overflow-hidden">
        <AppProviders>
          <PlannerServerSync />
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
