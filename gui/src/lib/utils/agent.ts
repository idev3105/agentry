import Bot from '@lucide/svelte/icons/bot';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Code2 from '@lucide/svelte/icons/code-2';
import type { Component } from 'svelte';

const ICON_BASE = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/';

export interface AgentMeta {
	icon: Component;
	label: string;
	color: string;
	logoUrl: string;
}

const META: Record<string, AgentMeta> = {
	claude_code: { icon: Sparkles, label: 'Claude',   color: 'text-accent', logoUrl: ICON_BASE + 'claudecode-color.svg' },
	claude:      { icon: Sparkles, label: 'Claude',   color: 'text-accent', logoUrl: ICON_BASE + 'claudecode-color.svg' },
	codex:       { icon: Bot,      label: 'Codex',    color: 'text-gruvbox-aqua',   logoUrl: ICON_BASE + 'codex-color.svg' },
	open_code:   { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue',   logoUrl: ICON_BASE + 'opencode.svg' },
	opencode:    { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue',   logoUrl: ICON_BASE + 'opencode.svg' },
};

export function agentMeta(t: string): AgentMeta {
	return META[t] ?? { icon: Bot, label: t, color: 'text-muted-foreground', logoUrl: '' };
}

