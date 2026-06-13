import { writable, get } from 'svelte/store';
import type { ProjectState } from '$lib/types';

export const projects = writable<Map<string, ProjectState>>(new Map());

export function addProject(p: ProjectState) {
	projects.update((m) => {
		m.set(p.id, p);
		return m;
	});
}

export function getProject(id: string): ProjectState | undefined {
	return get(projects).get(id);
}

export function removeProject(id: string) {
	projects.update((m) => {
		m.delete(id);
		return m;
	});
}
