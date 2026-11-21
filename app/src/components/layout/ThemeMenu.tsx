// SPDX-License-Identifier: GPL-3.0-or-later
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { useTheme, type Theme } from "@/lib/theme";

export function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Colour theme">
          <Icon />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <MenuRadioItem value="light"><Sun /> Light</MenuRadioItem>
          <MenuRadioItem value="dark"><Moon /> Dark</MenuRadioItem>
          <MenuRadioItem value="system"><Monitor /> Same as system</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
