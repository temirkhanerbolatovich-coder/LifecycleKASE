import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function collectMarkdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdown(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

const markdownFiles = await collectMarkdown(root);
const errors = [];

for (const markdownFile of markdownFiles) {
  const contents = await readFile(markdownFile, "utf8");
  const fenceCount = (contents.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    errors.push(`${path.relative(root, markdownFile)} has an unclosed code fence`);
  }

  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of contents.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z]+:/i.test(target)) {
      continue;
    }

    const withoutFragment = target.split("#", 1)[0];
    const decodedTarget = decodeURIComponent(withoutFragment);
    const resolvedTarget = path.resolve(path.dirname(markdownFile), decodedTarget);

    try {
      await readFile(resolvedTarget);
    } catch {
      errors.push(
        `${path.relative(root, markdownFile)} links to missing file ${target}`
      );
    }
  }
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(`PASS Markdown links and fences (${markdownFiles.length} files)`);
