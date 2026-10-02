import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WORLD_SIM — laboratoire d'émergence historique",
  description: "Simulations de la dispersion humaine sur une Terre réelle qui change.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,400..700&family=Spectral:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
