import Bot from '@lucide/svelte/icons/bot';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Code2 from '@lucide/svelte/icons/code-2';
import type { Component } from 'svelte';

export interface AgentMeta {
	/** Fallback lucide icon (used when no brand SVG matches). */
	icon: Component;
	label: string;
	color: string;
	/** Local brand SVG basename under lib/assets/brands/, '' if none. Render via <BrandIcon name={brand} />. */
	brand: string;
}

const META: Record<string, AgentMeta> = {
	claude_code: { icon: Sparkles, label: 'Claude',   color: 'text-accent',        brand: 'claudecode-color' },
	claude:      { icon: Sparkles, label: 'Claude',   color: 'text-accent',        brand: 'claudecode-color' },
	codex:       { icon: Bot,      label: 'Codex',    color: 'text-gruvbox-aqua',  brand: 'codex-color' },
	open_code:   { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue',  brand: 'opencode' },
	opencode:    { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue',  brand: 'opencode' },
};

export function agentMeta(t: string): AgentMeta {
	return META[t] ?? { icon: Bot, label: t, color: 'text-muted-foreground', brand: '' };
}
