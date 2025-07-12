<div align="center">
  
# 📂 dir-analysis-tool
  
  **A powerful, feature-rich command-line tool for comprehensive directory analysis**
  
  [![Downloads](https://img.shields.io/npm/dm/dir-analysis-tool.svg)](https://www.npmjs.com/package/dir-analysis-tool)  

  [![NPM](https://nodei.co/npm/dir-analysis-tool.png?compact=true)](https://nodei.co/npm/dir-analysis-tool/)
</div>

## ✨ Features

- 📊 **Comprehensive Directory Analysis** - Get detailed insights into directory structure, file counts, and sizes
- 🗂️ **Smart File Classification** - Automatically categorize files by type (images, videos, documents, audio, code, archives)
- 🚨 **Large File Detection** - Identify files consuming significant disk space
- 🔄 **Duplicate File Detection** - Find and analyze duplicate files to reclaim storage
- 📈 **Interactive Mode** - Explore directories with an intuitive interactive interface
- 🌳 **Tree View Visualization** - Display directory structure in a beautiful tree format
- 📊 **HTML Reports** - Generate rich HTML reports with charts and visualizations
- 📄 **Multiple Export Formats** - Export results to JSON, CSV, or HTML
- ⚡ **Real-time Progress Tracking** - Monitor analysis progress with visual progress bars
- 👀 **Watch Mode** - Monitor directory changes in real-time
- 🎯 **Advanced Filtering** - Filter files by size, date, patterns, and more
- ⚙️ **Configurable** - Customize analysis with configuration files
- 🚀 **High Performance** - Optimized for speed and memory efficiency
- 🌍 **Cross-platform** - Works on Windows, macOS, and Linux

## 🚀 Installation

### Global Installation (Recommended)

```bash
npm install -g dir-analysis-tool
```

### Local Installation

```bash
npm install dir-analysis-tool
```

## 📖 Usage

### Basic Usage

Analyze current directory:

```bash
dir-analysis-tool
```

Analyze specific directory:

```bash
dir-analysis-tool /path/to/directory
```

### Command Line Options

```bash
dir-analysis-tool [directory] [options]
```

#### Core Options

- `-p, --path <path>` - Target directory to analyze (default: current directory)
- `-r, --recursive` - Recursively analyze nested directories (default: true)
- `--no-recursive` - Disable recursive analysis
- `-j, --json` - Output results in JSON format
- `-t, --types` - Show file type classification summary (default: true)
- `--no-types` - Hide file type classification

#### Advanced Analysis

- `-l, --large-files [threshold]` - Detect large files (default: 100MB)
- `-d, --duplicates` - Enable duplicate file detection
- `--empty-files` - Detect and show empty files
- `--top-n <number>` - Show top N largest files (default: 10)
- `--tree` - Display results in tree view format

#### Filtering Options

- `-e, --exclude <patterns...>` - Exclude file patterns or directories
- `--max-depth <depth>` - Maximum directory depth to scan
- `--min-size <size>` - Filter files by minimum size (bytes)
- `--max-size <size>` - Filter files by maximum size (bytes)
- `--date-from <date>` - Filter files modified after this date (YYYY-MM-DD)
- `--date-to <date>` - Filter files modified before this date (YYYY-MM-DD)

#### Export Options

- `--csv [filename]` - Export results to CSV file
- `--csv-large [filename]` - Export large files to CSV
- `--csv-duplicates [filename]` - Export duplicates to CSV
- `--html [filename]` - Generate HTML report with charts

#### Interactive & Monitoring

- `-i, --interactive` - Start interactive mode
- `-w, --watch` - Watch mode - monitor directory changes
- `--progress` - Show progress bar during analysis (default: true)
- `--no-progress` - Disable progress bar

#### Configuration

- `-c, --config [path]` - Load configuration from file

### 🎯 Examples

#### Basic Analysis

```bash
# Analyze current directory with file type classification
dir-analysis-tool

# Analyze specific directory
dir-analysis-tool ~/Documents

# Get JSON output
dir-analysis-tool --json ~/Downloads
```

#### Advanced Analysis

```bash
# Find large files over 50MB and duplicates
dir-analysis-tool --large-files 52428800 --duplicates ~/Pictures

# Show tree view with top 20 largest files
dir-analysis-tool --tree --top-n 20 /var/log

# Analyze with filters
dir-analysis-tool --min-size 1048576 --max-depth 3 --exclude "*.tmp" "cache*"
```

#### Export and Reports

```bash
# Generate HTML report
dir-analysis-tool --html report.html ~/Projects

# Export to CSV files
dir-analysis-tool --csv analysis.csv --csv-large large-files.csv --duplicates

# Export duplicates analysis
dir-analysis-tool --duplicates --csv-duplicates duplicates.csv
```

#### Interactive Mode

```bash
# Start interactive explorer
dir-analysis-tool --interactive

# Watch directory for changes
dir-analysis-tool --watch ~/Downloads
```

## 📋 Interactive Mode

Launch interactive mode for a guided analysis experience:

```bash
dir-analysis-tool -i
```

Interactive mode features:

- 🔍 **Guided Analysis** - Step-by-step directory analysis
- 📁 **Directory Navigation** - Easy directory switching
- 📊 **Multiple Views** - Switch between different result views
- 💾 **Export Options** - Export results in various formats
- ⚙️ **Advanced Settings** - Configure analysis options
- 🔄 **Directory Comparison** - Compare multiple directories

## ⚙️ Configuration

Create a configuration file to customize default behavior:

### `.dir-analyzer.json` or `dir-analyzer.config.json`

```json
{
  "excludePatterns": ["node_modules", ".git", "*.tmp"],
  "largeSizeThreshold": 104857600,
  "enableDuplicateDetection": false,
  "enableProgressBar": true,
  "outputFormat": "table",
  "maxDepth": -1,
  "topN": 10,
  "showEmptyFiles": false
}
```

The tool automatically searches for configuration files in the current directory and parent directories.

## 📊 Output Formats

### Console Output

Rich, colorized console output with:

- 📂 Directory summary
- 📊 File type breakdown
- 🚨 Large files list
- 🔄 Duplicate file groups
- 🌳 Tree view (optional)

### JSON Output

```json
{
  "path": "/Users/example/Documents",
  "totalSizeBytes": 1048576000,
  "totalSizeMB": 1000,
  "folders": 150,
  "files": 2500,
  "types": {
    "images": 450,
    "documents": 800,
    "code": 300,
    "other": 950
  },
  "largeFiles": [...],
  "duplicateGroups": [...]
}
```

### HTML Reports

Generate beautiful HTML reports with:

- 📊 Interactive charts
- 📈 Size distribution graphs
- 🗂️ File type breakdowns
- 📋 Detailed file listings
- 🎨 Modern, responsive design

### CSV Export

Export data to CSV for further analysis in spreadsheet applications.

## 🔧 API Usage

Use programmatically in your Node.js applications:

```javascript
import { DirectoryAnalyzer } from 'dir-analysis-tool';

const analyzer = new DirectoryAnalyzer();

const result = await analyzer.analyze({
  path: '/path/to/analyze',
  recursive: true,
  excludePatterns: ['node_modules'],
  largeSizeThreshold: 100 * 1024 * 1024, // 100MB
  enableDuplicateDetection: true,
  topN: 10
});

console.log(result);
```

## 🎯 Use Cases

- **🧹 Disk Cleanup** - Identify large files and duplicates consuming disk space
- **📊 Project Analysis** - Analyze project structure and file distributions
- **🔍 Storage Audit** - Understand storage usage patterns
- **📈 Capacity Planning** - Monitor directory growth over time
- **🚀 Performance Optimization** - Identify bottlenecks in file systems
- **📋 Documentation** - Generate reports for system documentation
- **🔄 Backup Planning** - Identify important files and directories

## 🛠️ Requirements

- **Node.js** >= 18.0.0
- **npm** or **pnpm** or **yarn**
- **Operating System**: Windows, macOS, or Linux
