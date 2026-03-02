# pi-plan-tools

Safe file exploration tools for pi plan mode.

## Overview

This extension provides safe alternatives to bash-based file exploration tools that can be used in plan mode where bash is disabled. All tools are read-only and have bounded output to prevent overwhelming the context window.

When bash is disabled (plan mode), these tools provide safe file exploration:

1. Use `plan_ls` to explore directory structure
2. Use `plan_find` to locate files by pattern
3. Use `plan_grep` to search file contents

All tools respect the current working directory and cannot escape it for security.

## Installation

### From GitHub (Recommended)

```bash
pi install git:github.com/arcanemachine/pi-plan-tools
```

To update to the latest version:

```bash
pi update git:github.com/arcanemachine/pi-plan-tools
```

### From Local Clone

```bash
git clone https://github.com/arcanemachine/pi-plan-tools.git
cd pi-plan-tools
pi install /path/to/pi-plan-tools
```

Or use a symlink for development:

```bash
ln -s /workspace/projects/pi-plan-tools/src ~/.pi/agent/extensions/pi-plan-tools
```

## Tools

### `plan_ls`

List directory contents with file sizes and modification times.

**Parameters:**

- `path` (optional): Directory to list (default: current directory)
- `recursive` (optional): List recursively (default: false)
- `showHidden` (optional): Show hidden files starting with "." (default: false)

**Example:**

```json
{
  "path": "src",
  "recursive": true,
  "showHidden": false
}
```

### `plan_find`

Find files by name pattern using glob syntax.

**Parameters:**

- `pattern` (required): Glob pattern to match files (e.g., "_.ts", "\*\*/_.json")
- `path` (optional): Directory to search in (default: current directory)
- `exclude` (optional): Glob pattern(s) to exclude (e.g., "node_modules/\*\*")

**Example:**

```json
{
  "pattern": "**/*.ts",
  "path": "src",
  "exclude": "**/*.test.ts"
}
```

### `plan_grep`

Search file contents for regex patterns.

**Parameters:**

- `pattern` (required): Regex pattern to search for
- `path` (optional): File or directory to search (default: current directory)
- `include` (optional): Glob pattern for files to include (e.g., "\*.ts")
- `exclude` (optional): Glob pattern(s) to exclude
- `caseSensitive` (optional): Case sensitive search (default: false)

**Example:**

```json
{
  "pattern": "function\\s+\\w+",
  "path": "src",
  "include": "*.ts",
  "caseSensitive": false
}
```

## Commands

- `/plan-tools` - Show available plan mode tools

## Safety Features

- **Read-only**: All tools only read files, never modify
- **Path security**: Cannot access paths outside the current working directory
- **Output truncation**: Results are truncated to 50KB/2000 lines with temp file fallback
- **No bash execution**: Pure Node.js implementation, no shell commands
