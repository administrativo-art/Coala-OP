"use client";

import { useEffect } from "react";

/** Mesma regra do Coala Go (`timeBasedDarkTheme`): escuro das 18h às 05h59 pela hora civil do aparelho. Só visual. */
export function isNightHour(hour: number) {
  return hour < 6 || hour >= 18;
}

/**
 * Liga a paleta escura (`:root[data-ds-theme="dark"]` em globals.css) enquanto a tela estiver aberta e for noite,
 * reavaliando a cada virada de minuto; ao sair da tela o sistema volta ao claro. Use só em telas revisadas para os
 * tokens `--ds-*` (sem cor fixa clara), porque o atributo também alcança painéis e diálogos abertos por cima delas.
 */
export function ScheduledDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: number | undefined;
    const apply = () => {
      if (isNightHour(new Date().getHours())) root.dataset.dsTheme = "dark";
      else delete root.dataset.dsTheme;
      const now = new Date();
      timer = window.setTimeout(apply, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
    };
    apply();
    return () => {
      window.clearTimeout(timer);
      delete root.dataset.dsTheme;
    };
  }, []);
  return null;
}
