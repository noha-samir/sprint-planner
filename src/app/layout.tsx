import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { AppProviders } from "@/components/providers/AppProviders";
import { PlannerServerSync } from "@/components/sync/PlannerServerSync";
import { COLOR_SCHEME_CLASS, COLOR_SCHEME_STORAGE_KEY } from "@/lib/ui/colorScheme";
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
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)});var dark=v==="dark"||(v!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle(${JSON.stringify(COLOR_SCHEME_CLASS)},dark);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-dvh min-h-0 overflow-hidden">
        <AppProviders>
          <PlannerServerSync />
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
