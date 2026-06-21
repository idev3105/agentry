import { Command } from '@tauri-apps/plugin-shell';
import type { AgentType } from '$lib/types';

export interface AgentAvailability {
	id: AgentType;
	bin: string;
	installed: boolean;
	path: string | null;
	version: string | null;
	error: string | null;
}

const PROBES: Record<AgentType, string> = {
	claude_code: 'claude',
	codex:       'codex',
	open_code:   'opencode',
	hermes:      'hermes'
};

/** Run `which <bin>` and `<bin> --version` for each agent. Returns availability map. */
export async function detectAgents(): Promise<AgentAvailability[]> {
	const ids: AgentType[] = ['claude_code', 'codex', 'open_code', 'hermes'];

	const results = await Promise.all(ids.map(async (id) => {
		const bin = PROBES[id];
		const out: AgentAvailability = { id, bin, installed: false, path: null, version: null, error: null };

		try {
			const which = await Command.create('which', [bin]).execute();
			if (which.code === 0 && which.stdout.trim()) {
				out.installed = true;
				out.path = which.stdout.trim();
			} else {
				out.error = 'not found on PATH';
				return out;
			}
		} catch (e) {
			out.error = String(e);
			return out;
		}

		try {
			const ver = await Command.create(bin, ['--version']).execute();
			if (ver.code === 0) {
				out.version = ver.stdout.trim().split('\n')[0] || ver.stderr.trim().split('\n')[0] || null;
			}
		} catch {
			// version optional — installed flag is the source of truth
		}

		return out;
	}));

	return results;
}
