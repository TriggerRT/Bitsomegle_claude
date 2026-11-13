import type { Metadata } from "next";

import "./globals.css";



export const metadata: Metadata = {
  title: "Incognito | Anonymous Video Chat",
  description: "Random video or Voice Chat with Random People",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body    
      >
        {children}
      </body>
    </html>
  );
}
