import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Science Buddy",
  description: "Read papers with a tutor: highlight, ask by text or voice, keep every answer pinned to the text.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`} lang="en">
      <body className="h-full overflow-hidden">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  );
}
