import "./globals.css";

export const metadata = {
  title: "Sketching EIPE",
  description: "Educational tool for sketch interpretation and prompt estimation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
