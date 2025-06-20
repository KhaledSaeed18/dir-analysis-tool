# Directory- 📏 **Depth Control**: Limit scanning depth for performanceAnalyzer

A powerful cross-platform command-line tool written in TypeScript that analyzes directories and provides comprehensive insights about their contents, including file classification, large file detection, duplicate analysis, and advanced reporting features.

## 🚀 Features

### Core Analysis

- 📊 **Directory Analysis**: Get total size, file count, and folder count
- 📂 **File Classification**: Automatically categorize files by type (images, videos, documents, etc.)
- 🔄 **Recursive Scanning**: Analyze nested directories with optional recursion
- 🚫 **Smart Exclusions**: Skip common directories like `node_modules`, `.git`, etc.
- � **Depth Control**: Limit scanning depth for performance

### Advanced Features (Phase 1)

- 🔍 **Large File Detection**: Identify files exceeding customizable size thresholds
- 🔄 **Duplicate File Detection**: Find identical files and calculate wasted space
- 📊 **Progress Indicators**: Real-time progress bars during analysis
- 📋 **CSV Export**: Export results, large files, and duplicates to CSV format
- ⚙️ **Configuration Files**: Save and load analysis settings from config files
- 📏 **File Size Filters**: Filter analysis by minimum/maximum file sizes
- 📅 **Date Range Filters**: Filter files by modification date ranges
- 🌳 **Tree View Output**: Beautiful directory tree visualization
- 📈 **Top N Largest Files**: Show ranking of largest files
- 📭 **Empty File Detection**: Identify and report empty files

### Interactive Features (Phase 2)

- 🎯 **Interactive Mode**: Dynamic CLI interface for exploration and analysis
- 👀 **Watch Mode**: Real-time monitoring of directory changes
- 📊 **HTML Reports**: Beautiful HTML reports with interactive charts
- 🔄 **Directory Comparison**: Compare two directories side-by-side
- 🎨 **Rich Visualizations**: Charts and graphs for better data understanding

### Output & Reporting

- 🎨 **Beautiful Terminal Output**: Colorful display with emoji icons
- 📋 **Multiple Formats**: Human-readable terminal output, JSON, CSV, or HTML
- 📈 **Detailed Statistics**: Comprehensive metrics and insights
- 🗂️ **Categorized Reports**: Separate exports for different data types

## Installation

### Using npm/pnpm globally

```bash
npm install -g dir-analyzer
# or
pnpm install -g dir-analyzer
```

### Using npx (no installation)

```bash
npx dir-analyzer [options]
```

### Local development

```bash
git clone <repository>
cd dir-analyzer
pnpm install
pnpm build
```

## Usage

### Basic usage

```bash
dir-analyzer
```

### Analyze a specific directory

```bash
dir-analyzer --path /path/to/directory
```

### Enable large file detection (100MB threshold)

```bash
dir-analyzer --large-files
```

### Custom large file threshold (50MB)

```bash
dir-analyzer --large-files 52428800
```

### Enable duplicate detection

```bash
dir-analyzer --duplicates
```

### Export to CSV

```bash
# Export general analysis
dir-analyzer --csv

# Export with custom filename
dir-analyzer --csv my-analysis.csv

# Export large files to CSV
dir-analyzer --large-files --csv-large large-files.csv

# Export duplicates to CSV
dir-analyzer --duplicates --csv-duplicates duplicates.csv
```

### Use configuration file

```bash
dir-analyzer --config ./my-config.json
```

### Combine multiple features

```bash
dir-analyzer --path /my/project --large-files --duplicates --csv --progress --max-depth 5
```

### Get JSON output

```bash
dir-analyzer --json
```

### Disable recursive scanning

```bash
dir-analyzer --no-recursive
```

### Exclude specific patterns

```bash
dir-analyzer --exclude "*.log" "temp*" "cache"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --path <path>` | Target directory to analyze | `.` (current directory) |
| `-r, --recursive` | Recursively analyze nested directories | `true` |
| `--no-recursive` | Disable recursive analysis | - |
| `-j, --json` | Output results in JSON format | `false` |
| `-t, --types` | Show file type classification summary | `true` |
| `--no-types` | Hide file type classification | - |
| `-e, --exclude <patterns...>` | Exclude file patterns or directories | `[]` |
| `-l, --large-files [threshold]` | Detect large files (default: 100MB) | `undefined` |
| `-d, --duplicates` | Enable duplicate file detection | `false` |
| `--csv [filename]` | Export results to CSV file | `undefined` |
| `--csv-large [filename]` | Export large files to CSV | `undefined` |
| `--csv-duplicates [filename]` | Export duplicates to CSV | `undefined` |
| `--progress` | Show progress bar during analysis | `true` |
| `--no-progress` | Disable progress bar | - |
| `--max-depth <depth>` | Maximum directory depth to scan | `-1` (no limit) |
| `-c, --config [path]` | Load configuration from file | `undefined` |
| `-h, --help` | Display help information | - |
| `-V, --version` | Display version number | - |

## Configuration Files

You can save analysis settings in a configuration file to avoid repeating command-line options. The tool looks for configuration files in the following order:

1. `.dir-analyzer.json` in the current directory
2. `dir-analyzer.config.json` in the current directory
3. Searches parent directories up to the root

### Configuration File Example

```json
{
  "excludePatterns": ["*.log", "temp*", ".cache"],
  "largeSizeThreshold": 52428800,
  "enableDuplicateDetection": true,
  "enableProgressBar": true,
  "outputFormat": "table",
  "maxDepth": 10
}
```

### Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `excludePatterns` | `string[]` | File patterns to exclude | `[]` |
| `largeSizeThreshold` | `number` | Large file threshold in bytes | `104857600` (100MB) |
| `enableDuplicateDetection` | `boolean` | Enable duplicate detection | `false` |
| `enableProgressBar` | `boolean` | Show progress indicators | `true` |
| `outputFormat` | `string` | Output format (`table`, `json`, `csv`) | `table` |
| `maxDepth` | `number` | Maximum scan depth (-1 = no limit) | `-1` |

## File Type Classification

The tool automatically classifies files into the following categories:

| Type | Extensions |
|------|------------|
| **Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.tiff`, `.ico` |
| **Videos** | `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.flv`, `.wmv`, `.m4v` |
| **Documents** | `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.txt`, `.doc`, `.xls`, `.ppt`, `.rtf`, `.odt`, `.ods`, `.odp` |
| **Audio** | `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.wma`, `.m4a` |
| **Code** | `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.hpp`, `.cs`, `.php`, `.rb`, `.go`, `.rs`, `.swift`, `.kt`, `.scala`, `.clj`, `.sh`, `.bat`, `.ps1`, `.sql`, `.html`, `.css`, `.scss`, `.sass`, `.less`, `.json`, `.xml`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf` |
| **Archives** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.bz2`, `.xz`, `.tar.gz`, `.tar.bz2` |
| **Other** | All other file types |

## Output Examples

### Terminal Output

```bash
🔍 Starting directory analysis...
[████████████████████████████████████████] 100% (1,247/1,247) /path/to/file.js
✅ Analysis complete!

📂 Directory: ./my-project
📦 Total Size: 124.7 MB
📁 Folders: 17
📄 Files: 328

🗂 File Types:
  📷 Images: 87
  🎬 Videos: 4
  📄 Documents: 12
  🎵 Audio: 8
  🧑‍💻 Code: 165
  🗃️ Archives: 3
  ❓ Other: 49

🚨 Large Files (Top 5):
  📁 assets/video/demo.mp4 - 45.2 MB
  📁 dist/bundle.min.js - 12.8 MB
  📁 docs/manual.pdf - 8.4 MB
  📁 src/data/dataset.json - 5.9 MB
  📁 assets/images/banner.png - 3.2 MB

🔄 Duplicate Files:
  📊 Groups: 8
  💾 Wasted Space: 156.8 MB

  Top duplicate groups:
  1. 23.4 MB each × 4 files
     📄 backup/project-v1.zip
     📄 archives/project-backup.zip
     ... and 2 more
  2. 12.8 MB each × 3 files
     📄 dist/bundle.min.js
     📄 build/main.js
     ... and 1 more
```

### JSON Output

```json
{
  "path": "./my-project",
  "totalSizeBytes": 130861056,
  "totalSizeMB": 124.7,
  "folders": 17,
  "files": 328,
  "types": {
    "images": 87,
    "videos": 4,
    "documents": 12,
    "audio": 8,
    "code": 165,
    "archives": 3,
    "other": 49
  },
  "largeFiles": [
    {
      "path": "/project/assets/video/demo.mp4",
      "size": 47430656,
      "sizeFormatted": "45.2 MB"
    }
  ],
  "duplicateGroups": [
    {
      "hash": "a1b2c3d4...",
      "size": 24543232,
      "sizeFormatted": "23.4 MB",
      "files": [
        "/project/backup/project-v1.zip",
        "/project/archives/project-backup.zip"
      ],
      "totalWastedSpace": 24543232,
      "totalWastedSpaceFormatted": "23.4 MB"
    }
  ],
  "duplicateStats": {
    "totalGroups": 8,
    "totalWastedSpace": 164470938,
    "totalWastedSpaceFormatted": "156.8 MB"
  }
}
```

### CSV Export

The tool can export data to CSV format for further analysis:

#### General Analysis CSV (`--csv`)

```csv
Type,Path,Size (Bytes),Size (Formatted),Count,Details
Summary,./my-project,130861056,124.7MB,328,Folders: 17
FileType,images,-,-,87,-
FileType,code,-,-,165,-
LargeFile,"/project/assets/video/demo.mp4",47430656,"45.2 MB",1,-
Duplicate,"/project/backup/project-v1.zip",24543232,"23.4 MB",1,"Group 1, Total files: 2, Wasted space: 23.4 MB"
```

#### Large Files CSV (`--csv-large`)

```csv
Path,Size (Bytes),Size (Formatted)
"/project/assets/video/demo.mp4",47430656,"45.2 MB"
"/project/dist/bundle.min.js",13421772,"12.8 MB"
```

#### Duplicates CSV (`--csv-duplicates`)

```csv
Group,Path,Size (Bytes),Size (Formatted),Files in Group,Wasted Space
1,"/project/backup/project-v1.zip",24543232,"23.4 MB",2,"23.4 MB"
1,"/project/archives/project-backup.zip",24543232,"23.4 MB",2,"23.4 MB"
```

## Performance & Large Directories

For optimal performance when analyzing large directories:

- Use `--max-depth` to limit scan depth
- Use `--exclude` to skip unnecessary directories
- Disable features you don't need (e.g., `--no-progress`, `--no-types`)
- Use `--no-recursive` for single-level analysis

## Default Exclusions

The following directories are excluded by default:

- `node_modules`
- `.git`
- `.svn`
- `.hg`
- `dist`
- `build`
- `.cache`

You can add custom exclusions using the `--exclude` option or configuration file.

## Phase 1 Features

### File size filtering

```bash
# Show only files between 1MB and 10MB
dir-analyzer --min-size 1048576 --max-size 10485760

# Show only files larger than 50MB
dir-analyzer --min-size 52428800
```

### Date range filtering

```bash
# Show files modified after January 1, 2024
dir-analyzer --date-from 2024-01-01

# Show files modified between two dates
dir-analyzer --date-from 2024-01-01 --date-to 2024-12-31
```

### Tree view and top files

```bash
# Display directory structure as a tree
dir-analyzer --tree

# Show top 20 largest files
dir-analyzer --top-n 20

# Detect empty files
dir-analyzer --empty-files
```

## Phase 2 Features

### Interactive mode

```bash
# Start interactive exploration mode
dir-analyzer --interactive
```

### Watch mode

```bash
# Monitor directory for changes
dir-analyzer --watch

# Watch with limited depth
dir-analyzer --watch --max-depth 3
```

### HTML reports

```bash
# Generate HTML report with charts
dir-analyzer --html

# Generate HTML report with custom filename
dir-analyzer --html my-report.html

# Full analysis with HTML report
dir-analyzer --large-files --duplicates --top-n 15 --html complete-report.html
```

## Advanced Usage Examples

### Cleanup Large Projects

```bash
# Find large files and duplicates in a project
dir-analyzer --large-files 10485760 --duplicates --csv cleanup-report.csv

# Analyze with specific exclusions
dir-analyzer --exclude "node_modules" "*.log" "tmp*" --large-files --duplicates
```

### CI/CD Integration

```bash
# Generate JSON report for automated processing
dir-analyzer --json --large-files --max-depth 3 > analysis-report.json

# Check for space usage with threshold
dir-analyzer --large-files 52428800 --csv-large large-files.csv
```

### Documentation & Reporting

```bash
# Generate comprehensive CSV reports
dir-analyzer --csv analysis.csv --csv-large large.csv --csv-duplicates dupes.csv --large-files --duplicates

# Create project documentation
dir-analyzer --path ./src --types --json > project-structure.json
```

## Requirements

- Node.js >= 18.0.0

## Development

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run in development mode
pnpm dev --path ./test-directory

# Run the built version
pnpm start --path ./test-directory
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Roadmap

### Phase 2 (Planned)

- 📈 **Advanced Analytics**: File age analysis, access patterns
- 🔍 **Search & Filter**: Find files by criteria
- 🧹 **Cleanup Tools**: Interactive duplicate removal
- 📊 **Visualization**: Charts and graphs for data representation
- ⚡ **Performance**: Multi-threading and caching improvements

### Phase 3 (Future)

- 🌐 **Web Interface**: Browser-based analysis dashboard
- 🔗 **Integration**: Git integration, cloud storage analysis
- 🤖 **AI Features**: Smart categorization and recommendations
- 📱 **Mobile**: React Native app for mobile analysis
