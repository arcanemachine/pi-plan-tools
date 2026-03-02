/**
 * pi-plan-tools
 * Safe file exploration tools for pi plan mode
 *
 * Provides safe alternatives to bash-based file exploration:
 * - plan_find: Find files by name pattern (no bash needed)
 * - plan_ls: List directory contents with details
 * - plan_grep: Search file contents with patterns
 *
 * These tools are safe for plan mode because they:
 * - Only read files, never modify
 * - Have bounded output (truncation)
 * - Don't execute arbitrary commands
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { readdir, readFile } from "node:fs/promises";
import { stat, access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Output truncation helper
async function truncateOutput(
  content: string,
  totalLines: number
): Promise<{ text: string; truncated: boolean; tempFile?: string }> {
  const result = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!result.truncated) {
    return { text: result.content, truncated: false };
  }

  // Write full output to temp file
  const tempFile = `/tmp/pi-plan-tools-${Date.now()}.txt`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(tempFile, content, "utf-8");

  const truncatedText =
    result.content +
    `\n\n[Output truncated: ${result.outputLines} of ${totalLines} lines ` +
    `(${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). ` +
    `Full output saved to: ${tempFile}]`;

  return { text: truncatedText, truncated: true, tempFile };
}

// Check if path is within cwd (security)
function isPathSafe(targetPath: string, cwd: string): boolean {
  const resolved = resolve(targetPath);
  const resolvedCwd = resolve(cwd);
  return resolved === resolvedCwd || resolved.startsWith(resolvedCwd + "/");
}

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

// Format date
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

// Simple glob matching function
function matchGlob(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexPattern = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  
  // Handle brace expansion like {ts,js}
  regexPattern = regexPattern.replace(/\{([^}]+)\}/g, (_match, inner) => {
    return `(${inner.split(",").join("|")})`;
  });

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

export default function planToolsExtension(pi: ExtensionAPI) {
  // Register plan_ls tool
  pi.registerTool({
    name: "plan_ls",
    label: "List Directory",
    description:
      "List directory contents with file sizes and types. " +
      "Safe read-only alternative to bash ls. " +
      "Shows files, directories, sizes, and modification times.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: "Directory to list (default: current directory)",
        })
      ),
      recursive: Type.Optional(
        Type.Boolean({
          description: "List recursively (default: false)",
        })
      ),
      showHidden: Type.Optional(
        Type.Boolean({
          description: "Show hidden files (default: false)",
        })
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const targetPath = params.path ? resolve(cwd, params.path) : cwd;

      // Security check
      if (!isPathSafe(targetPath, cwd)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Path '${params.path}' is outside the current working directory`,
            },
          ],
          details: { error: "Path outside cwd" },
          isError: true,
        };
      }

      try {
        // Check if path exists
        await access(targetPath);
        const pathStat = await stat(targetPath);

        // If it's a file, show file info
        if (!pathStat.isDirectory()) {
          const relPath = relative(cwd, targetPath);
          const size = formatFileSize(pathStat.size);
          const mtime = formatDate(pathStat.mtime);
          return {
            content: [
              {
                type: "text" as const,
                text: `${relPath}\n  Size: ${size}\n  Modified: ${mtime}\n  Type: file`,
              },
            ],
            details: {
              path: relPath,
              type: "file",
              size: pathStat.size,
              mtime: pathStat.mtime,
            },
          };
        }

        // Collect entries
        const entries: Array<{
          name: string;
          path: string;
          type: "file" | "directory" | "other";
          size?: number;
          mtime?: Date;
          depth: number;
        }> = [];

        async function collect(dirPath: string, depth: number) {
          if (signal?.aborted) return;

          const items = await readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            if (!params.showHidden && item.name.startsWith(".")) continue;

            const fullPath = join(dirPath, item.name);
            const relPath = relative(cwd, fullPath);

            if (item.isDirectory()) {
              entries.push({
                name: item.name,
                path: relPath,
                type: "directory",
                depth,
              });

              if (params.recursive) {
                await collect(fullPath, depth + 1);
              }
            } else if (item.isFile()) {
              const s = await stat(fullPath);
              entries.push({
                name: item.name,
                path: relPath,
                type: "file",
                size: s.size,
                mtime: s.mtime,
                depth,
              });
            } else {
              entries.push({
                name: item.name,
                path: relPath,
                type: "other",
                depth,
              });
            }
          }
        }

        await collect(targetPath, 0);

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });

        // Format output
        const lines: string[] = [];
        const baseName = relative(cwd, targetPath) || ".";
        lines.push(`${baseName}/`);

        for (const entry of entries) {
          const indent = "  ".repeat(entry.depth + 1);
          if (entry.type === "directory") {
            lines.push(`${indent}${entry.name}/`);
          } else if (entry.type === "file" && entry.size !== undefined) {
            const size = formatFileSize(entry.size);
            const mtime = entry.mtime ? formatDate(entry.mtime) : "";
            lines.push(`${indent}${entry.name} (${size}, ${mtime})`);
          } else {
            lines.push(`${indent}${entry.name}`);
          }
        }

        const totalLines = lines.length;
        const output = lines.join("\n");

        const { text, truncated } = await truncateOutput(output, totalLines);

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path: baseName,
            entries: entries.map((e) => ({
              name: e.name,
              type: e.type,
              path: e.path,
            })),
            truncated,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // Register plan_find tool
  pi.registerTool({
    name: "plan_find",
    label: "Find Files",
    description:
      "Find files by name pattern. Safe read-only alternative to bash find. " +
      "Supports glob patterns like '*.ts', '**/*.json', 'src/**/*.{ts,js}'. " +
      "Returns matching file paths relative to cwd.",
    parameters: Type.Object({
      pattern: Type.String({
        description: "Glob pattern to match files (e.g., '*.ts', '**/*.json')",
      }),
      path: Type.Optional(
        Type.String({
          description: "Directory to search in (default: current directory)",
        })
      ),
      exclude: Type.Optional(
        Type.Union([
          Type.String({
            description: "Glob pattern to exclude (e.g., 'node_modules/**')",
          }),
          Type.Array(
            Type.String({
              description: "Glob patterns to exclude",
            })
          ),
        ])
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const searchPath = params.path ? resolve(cwd, params.path) : cwd;

      // Security check
      if (!isPathSafe(searchPath, cwd)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Path '${params.path}' is outside the current working directory`,
            },
          ],
          details: { error: "Path outside cwd" },
          isError: true,
        };
      }

      try {
        // Check if directory exists
        await access(searchPath);
        const stats = await stat(searchPath);
        if (!stats.isDirectory()) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: '${params.path}' is not a directory`,
              },
            ],
            details: { error: "Not a directory" },
            isError: true,
          };
        }

        // Build exclude patterns
        const excludePatterns: string[] = ["node_modules", ".git"];
        if (params.exclude) {
          if (Array.isArray(params.exclude)) {
            excludePatterns.push(...params.exclude.map((p) => p.replace(/\*\*\//g, "").replace(/\/$/g, "")));
          } else {
            excludePatterns.push(params.exclude.replace(/\*\*\//g, "").replace(/\/$/g, ""));
          }
        }

        // Collect matching files
        const matches: string[] = [];

        async function search(dirPath: string) {
          if (signal?.aborted) return;

          const items = await readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            if (item.name.startsWith(".")) continue;
            if (excludePatterns.some((p) => item.name === p || item.name.includes(p))) continue;

            const fullPath = join(dirPath, item.name);
            const relPath = relative(cwd, fullPath);

            if (item.isDirectory()) {
              await search(fullPath);
            } else if (item.isFile()) {
              if (matchGlob(item.name, params.pattern)) {
                matches.push(relPath);
              }
            }
          }
        }

        await search(searchPath);

        // Sort results
        matches.sort();

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No files found matching '${params.pattern}' in ${relative(cwd, searchPath) || "."}`,
              },
            ],
            details: { pattern: params.pattern, matches: [], count: 0 },
          };
        }

        // Format output
        const totalLines = matches.length;
        const output = matches.join("\n");

        const { text, truncated } = await truncateOutput(output, totalLines);

        return {
          content: [{ type: "text" as const, text }],
          details: {
            pattern: params.pattern,
            matches,
            count: matches.length,
            truncated,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // Register plan_grep tool
  pi.registerTool({
    name: "plan_grep",
    label: "Grep Files",
    description:
      "Search file contents for patterns. Safe read-only alternative to bash grep. " +
      "Supports regex patterns and searches within the current working directory. " +
      "Returns matching lines with file paths and line numbers.",
    parameters: Type.Object({
      pattern: Type.String({
        description: "Regex pattern to search for (e.g., 'function', 'class\\s+\\w+')",
      }),
      path: Type.Optional(
        Type.String({
          description: "File or directory to search in (default: current directory)",
        })
      ),
      include: Type.Optional(
        Type.String({
          description: "Glob pattern for files to include (e.g., '*.ts', '*.js')",
        })
      ),
      exclude: Type.Optional(
        Type.Union([
          Type.String({
            description: "Glob pattern to exclude (e.g., 'node_modules/**')",
          }),
          Type.Array(
            Type.String({
              description: "Glob patterns to exclude",
            })
          ),
        ])
      ),
      caseSensitive: Type.Optional(
        Type.Boolean({
          description: "Case sensitive search (default: false, case insensitive)",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const targetPath = params.path ? resolve(cwd, params.path) : cwd;

      // Security check
      if (!isPathSafe(targetPath, cwd)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Path '${params.path}' is outside the current working directory`,
            },
          ],
          details: { error: "Path outside cwd" },
          isError: true,
        };
      }

      try {
        // Compile regex
        const flags = params.caseSensitive ? "g" : "gi";
        const regex = new RegExp(params.pattern, flags);

        // Build exclude patterns
        const excludePatterns: string[] = ["node_modules", ".git"];
        if (params.exclude) {
          if (Array.isArray(params.exclude)) {
            excludePatterns.push(...params.exclude.map((p) => p.replace(/\*\*\//g, "").replace(/\/$/g, "")));
          } else {
            excludePatterns.push(params.exclude.replace(/\*\*\//g, "").replace(/\/$/g, ""));
          }
        }

        // Collect search results
        const results: Array<{
          path: string;
          line: number;
          content: string;
        }> = [];

        async function searchFile(filePath: string, relPath: string) {
          if (signal?.aborted) return;

          try {
            const content = await readFile(filePath, "utf-8");
            const lines = content.split("\n");

            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push({
                  path: relPath,
                  line: i + 1,
                  content: lines[i].trim().slice(0, 200), // Limit line length
                });
              }
              // Reset regex lastIndex for global matches
              regex.lastIndex = 0;
            }
          } catch {
            // Skip files that can't be read (binary, permissions, etc.)
          }
        }

        async function searchDir(dirPath: string) {
          if (signal?.aborted) return;

          const items = await readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            if (item.name.startsWith(".")) continue;
            if (excludePatterns.some((p) => item.name === p || item.name.includes(p))) continue;

            const fullPath = join(dirPath, item.name);
            const relPath = relative(cwd, fullPath);

            if (item.isDirectory()) {
              await searchDir(fullPath);
            } else if (item.isFile()) {
              // Check include pattern if specified
              if (params.include && !matchGlob(item.name, params.include)) {
                continue;
              }
              await searchFile(fullPath, relPath);
            }
          }
        }

        // Check if target is file or directory
        const targetStat = await stat(targetPath);
        if (targetStat.isFile()) {
          await searchFile(targetPath, relative(cwd, targetPath));
        } else {
          await searchDir(targetPath);
        }

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No matches found for '${params.pattern}'`,
              },
            ],
            details: { pattern: params.pattern, matches: [], count: 0 },
          };
        }

        // Format output
        const lines = results.map((r) => `${r.path}:${r.line}: ${r.content}`);
        const totalLines = lines.length;
        const output = lines.join("\n");

        const { text, truncated } = await truncateOutput(output, totalLines);

        return {
          content: [{ type: "text" as const, text }],
          details: {
            pattern: params.pattern,
            matches: results,
            count: results.length,
            truncated,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // Register a command to show available plan tools
  pi.registerCommand("plan-tools", {
    description: "Show available plan mode tools",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "Plan tools available: plan_ls, plan_find, plan_grep",
        "info"
      );
    },
  });
}
