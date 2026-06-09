import Bot from '@lucide/svelte/icons/bot';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Code2 from '@lucide/svelte/icons/code-2';
import type { Component } from 'svelte';

export interface AgentMeta {
	icon: Component;
	label: string;
	color: string;
}

const META: Record<string, AgentMeta> = {
	claude_code: { icon: Sparkles, label: 'Claude',   color: 'text-gruvbox-yellow' },
	claude:      { icon: Sparkles, label: 'Claude',   color: 'text-gruvbox-yellow' },
	codex:       { icon: Bot,      label: 'Codex',    color: 'text-gruvbox-aqua'   },
	open_code:   { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue'   },
	opencode:    { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue'   },
};

export function agentMeta(t: string): AgentMeta {
	return META[t] ?? { icon: Bot, label: t, color: 'text-muted-foreground' };
}
