import type { Component } from "svelte";
import File from "@lucide/svelte/icons/file";
import FileCode from "@lucide/svelte/icons/file-code";
import FileJson from "@lucide/svelte/icons/file-json";
import FileText from "@lucide/svelte/icons/file-text";
import FileImage from "@lucide/svelte/icons/file-image";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Settings from "@lucide/svelte/icons/settings";

const BY_EXT: Record<string, Component> = {
	ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
	rs: FileCode, go: FileCode, py: FileCode, svelte: FileCode,
	c: FileCode, h: FileCode, cpp: FileCode, java: FileCode, sh: FileCode,
	json: FileJson,
	md: FileText, txt: FileText, log: FileText,
	png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage,
	toml: Settings, yaml: Settings, yml: Settings, env: Settings, lock: Settings,
};

export function fileIcon(name: string, isDir: boolean, open = false): Component {
	if (isDir) return open ? FolderOpen : Folder;
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	return BY_EXT[ext] ?? File;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
export function isImageFile(name: string): boolean {
	return IMAGE_EXT.has(name.split(".").pop()?.toLowerCase() ?? "");
}
