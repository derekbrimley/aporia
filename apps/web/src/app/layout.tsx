import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: env.productName, description: "Simulated deals for junior transactional associates." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* The associate's time zone, so the session's story dates match the dates their inbox shows. */}
        <script dangerouslySetInnerHTML={{ __html: `try{document.cookie="rematter_tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)+";path=/;max-age=31536000;samesite=lax"}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
