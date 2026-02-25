import "./globals.css";

export const metadata = {
  title: "Amazon Sales Dashboard",
  description: "IQBAR analytics rebuilt in Next.js",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
