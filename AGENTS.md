# pi-plan-tools

Safe file exploration tools for pi plan mode.

## Project Structure

```
pi-plan-tools/
├── src/
│   └── index.ts          # Main extension entry point
├── dist/
│   └── index.js          # Compiled output
├── package.json          # Package configuration
├── tsconfig.json         # TypeScript configuration
├── README.md             # Documentation
└── LICENSE.md            # MIT License
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch
```

## Tools Provided

- `plan_ls` - List directory contents
- `plan_find` - Find files by glob pattern
- `plan_grep` - Search file contents with regex

## Installation

Copy or symlink to pi extensions directory:

```bash
# Global
ln -s /workspace/projects/pi-plan-tools ~/.pi/agent/extensions/pi-plan-tools

# Project-local
ln -s /workspace/projects/pi-plan-tools /path/to/project/.pi/extensions/pi-plan-tools
```
