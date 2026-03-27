import { useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light";

function getStored(): Theme {
  return (localStorage.getItem("ufabc-theme") as Theme) || "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStored);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ufabc-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
