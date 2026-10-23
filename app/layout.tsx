import type { Metadata } from "next";
import "./styles/personal-board.css";
import { defaultTheme, themeBootstrap } from "../lib/theme";

export const metadata: Metadata = {
  title: "PersonalJiraBoard",
  description: "A personal task board with Jira, notes and reminders.",
  icons: { icon: { url: "/favicon.png", type: "image/png" } },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme={defaultTheme} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head><body>{children}</body></html>;
}
