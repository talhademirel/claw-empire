import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".tmp",
  "__pycache__",
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.local",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
];

const IMPORTANT_FILES = [
  "package.json",
  "tsconfig.json",
  "README.md",
  "CLAUDE.md",
  ".gitignore",
  "Dockerfile",
  "docker-compose.yml",
  "vite.config.ts",
  "next.config.js",
  "next.config.ts",
  "tailwind.config.ts",
  "tailwind.config.js",
];

interface FileTreeEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

export function buildFileTree(projectPath: string, maxDepth = 4): FileTreeEntry[] {
  const entries: FileTreeEntry[] = [];

  function walk(dir: string, depth: number, relativePath: string): void {
    if (depth > maxDepth) return;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (DEFAULT_IGNORE_PATTERNS.includes(item.name)) continue;
      if (item.name.startsWith(".") && !IMPORTANT_FILES.includes(item.name)) continue;

      const itemRelPath = relativePath ? `${relativePath}/${item.name}` : item.name;
      const itemFullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        entries.push({ path: itemRelPath, type: "directory" });
        walk(itemFullPath, depth + 1, itemRelPath);
      } else if (item.isFile()) {
        let size: number | undefined;
        try {
          size = fs.statSync(itemFullPath).size;
        } catch {
          // ignore
        }
        entries.push({ path: itemRelPath, type: "file", size });
      }
    }
  }

  walk(projectPath, 0, "");
  return entries;
}

export function formatFileTree(entries: FileTreeEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const depth = entry.path.split("/").length - 1;
    const indent = "  ".repeat(depth);
    const name = entry.path.split("/").pop() || entry.path;
    if (entry.type === "directory") {
      lines.push(`${indent}${name}/`);
    } else {
      const sizeLabel = entry.size != null ? ` (${formatSize(entry.size)})` : "";
      lines.push(`${indent}${name}${sizeLabel}`);
    }
  }
  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".cfg",
  ".ini",
  ".env.example",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".svg",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".vue",
  ".svelte",
  ".astro",
]);

export function readImportantFiles(projectPath: string, maxChars = 50000): string {
  const sections: string[] = [];
  let totalChars = 0;

  // Read important root-level files first
  for (const fileName of IMPORTANT_FILES) {
    if (totalChars >= maxChars) break;
    const filePath = path.join(projectPath, fileName);
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      const truncated = content.slice(0, Math.min(content.length, maxChars - totalChars));
      sections.push(`=== ${fileName} ===\n${truncated}`);
      totalChars += truncated.length;
    } catch {
      // ignore
    }
  }

  // Read src/ entry points
  const srcDirs = ["src", "app", "pages", "lib", "server"];
  for (const srcDir of srcDirs) {
    if (totalChars >= maxChars) break;
    const srcPath = path.join(projectPath, srcDir);
    if (!fs.existsSync(srcPath)) continue;

    try {
      const items = fs.readdirSync(srcPath, { withFileTypes: true });
      for (const item of items) {
        if (totalChars >= maxChars) break;
        if (!item.isFile()) continue;
        const ext = path.extname(item.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) continue;

        const filePath = path.join(srcPath, item.name);
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const budget = maxChars - totalChars;
          if (budget <= 0) break;
          const truncated = content.slice(0, Math.min(content.length, budget, 5000));
          sections.push(`=== ${srcDir}/${item.name} ===\n${truncated}`);
          totalChars += truncated.length;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  return sections.join("\n\n");
}

export function collectProjectContext(projectPath: string, maxChars = 60000): string {
  const tree = buildFileTree(projectPath);
  const treeStr = formatFileTree(tree);
  const files = readImportantFiles(projectPath, maxChars - treeStr.length - 200);

  return `## Project File Tree\n\`\`\`\n${treeStr}\n\`\`\`\n\n## Important Files\n${files}`;
}

const TEAM_SIGNAL_FILES = ["package.json", "README.md", "CLAUDE.md", "docker-compose.yml", "Dockerfile"];

/**
 * Lightweight context for team analysis — only file tree + key signal files.
 * Avoids sending source code; reduces prompt size from ~50k to ~5-10k chars.
 */
export function collectTeamContext(projectPath: string): string {
  const tree = buildFileTree(projectPath);
  const treeStr = formatFileTree(tree);

  const sections: string[] = [];
  let totalChars = 0;
  const maxChars = 8000;

  for (const fileName of TEAM_SIGNAL_FILES) {
    if (totalChars >= maxChars) break;
    const filePath = path.join(projectPath, fileName);
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      const budget = maxChars - totalChars;
      const truncated = content.slice(0, Math.min(content.length, budget, 4000));
      sections.push(`=== ${fileName} ===\n${truncated}`);
      totalChars += truncated.length;
    } catch {
      // ignore
    }
  }

  const filesStr = sections.join("\n\n");
  return `## Project File Tree\n\`\`\`\n${treeStr}\n\`\`\`\n\n## Key Files\n${filesStr}`;
}
