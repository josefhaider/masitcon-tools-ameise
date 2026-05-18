import type { Metadata } from "next";
import "./globals.css";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "AMEISE | masitcon",
  description: "AMEISE - Die Zeiterfassungs-App von masitcon.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-outfit bg-gray-50 antialiased">
        <SidebarProvider>{children}</SidebarProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
