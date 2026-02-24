import "./globals.css";

export const metadata = {
  title: "Amazon Sales Dashboard",
  description: "IQBAR analytics rebuilt in Next.js",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
