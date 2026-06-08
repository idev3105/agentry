import { writable } from 'svelte/store';
import type { ProfileInfo } from '$lib/types';

export const profiles = writable<ProfileInfo[]>([]);
