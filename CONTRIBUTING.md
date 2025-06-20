# Contributing to dir-analysis-tool

Thank you for your interest in contributing to dir-analysis-tool! We welcome contributions from the community and are grateful for your support.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style Guidelines](#code-style-guidelines)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended), npm, or yarn
- Git
- TypeScript knowledge (for code contributions)

### Development Setup

1. **Fork the repository**

   ```bash
   # Click the "Fork" button on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/dir-analysis-tool.git
   cd dir-analysis-tool
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Build the project**

   ```bash
   pnpm build
   ```

4. **Test the CLI**

   ```bash
   # Run in development mode
   pnpm dev --help
   
   # Or test the built version
   node bin/index.js --help
   ```

## Making Changes

### Branch Naming Convention

- `feature/description` - for new features
- `fix/description` - for bug fixes
- `docs/description` - for documentation updates
- `refactor/description` - for code refactoring
- `test/description` - for adding tests

### Workflow

1. **Create a new branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed

3. **Build and test**

   ```bash
   pnpm build
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

## Testing

### Manual Testing

Test your changes with various scenarios:

```bash
# Test basic functionality
pnpm dev /path/to/test/directory

# Test different options
pnpm dev --json --large-files --duplicates
pnpm dev --interactive
pnpm dev --tree --top-n 20
pnpm dev --html report.html
```

### Test Checklist

- [ ] Basic directory analysis works
- [ ] JSON output is valid
- [ ] Interactive mode functions correctly
- [ ] HTML report generation works
- [ ] CSV export functions properly
- [ ] Large file detection works
- [ ] Duplicate detection works
- [ ] Tree view displays correctly
- [ ] Progress bar shows during analysis
- [ ] Configuration file loading works
- [ ] Cross-platform compatibility (if possible)

## Submitting Changes

### Pull Request Process

1. **Ensure your branch is up to date**

   ```bash
   git checkout main
   git pull upstream main
   git checkout your-branch
   git rebase main
   ```

2. **Push your changes**

   ```bash
   git push origin your-branch
   ```

3. **Create a Pull Request**
   - Use the pull request template
   - Provide a clear title and description
   - Reference any related issues
   - Include screenshots for UI changes

### Pull Request Requirements

- [ ] Code builds without errors
- [ ] Manual testing completed
- [ ] Documentation updated (if applicable)
- [ ] CHANGELOG.md updated (for significant changes)
- [ ] Commit messages follow conventional format

## Code Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow existing naming conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer `const` over `let` when possible
- Use async/await over Promises where appropriate

### File Organization

```
src/
├── types.ts          # Type definitions
├── utils.ts          # Utility functions
├── analyzer.ts       # Core analysis logic
├── cli.ts           # CLI interface
├── interactive.ts   # Interactive mode
├── export.ts        # Export functionality
└── ...
```

### Error Handling

- Use proper error types
- Provide meaningful error messages
- Handle edge cases gracefully
- Log errors appropriately

### Example Code Style

```typescript
/**
 * Analyzes a directory and returns comprehensive statistics
 * @param options - Analysis configuration options
 * @returns Promise resolving to analysis results
 */
export async function analyzeDirectory(
  options: AnalysisOptions
): Promise<AnalysisResult> {
  try {
    const { path, recursive = true, excludePatterns = [] } = options;
    
    // Implementation here
    
    return {
      path,
      totalSizeBytes: totalSize,
      files: fileCount,
      // ... other properties
    };
  } catch (error) {
    throw new Error(`Failed to analyze directory: ${error.message}`);
  }
}
```

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- Operating system and version
- Node.js version
- dir-analysis-tool version
- Command that caused the issue
- Expected vs actual behavior
- Error messages (if any)
- Steps to reproduce

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

### Security Issues

For security-related issues, please email the maintainers directly instead of creating a public issue.

## Feature Requests

We welcome feature requests! Please:

- Check existing issues first
- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- Explain the use case and benefits
- Consider the scope and complexity
- Be open to discussion and alternatives

### Popular Feature Areas

- New export formats
- Additional file analysis metrics
- Performance improvements
- UI/UX enhancements
- Cross-platform compatibility
- Integration with other tools

## Documentation

### Types of Documentation

- **README.md** - Main project documentation
- **Code comments** - Inline documentation
- **JSDoc** - API documentation
- **Examples** - Usage examples

### Documentation Guidelines

- Keep documentation up to date with code changes
- Use clear, concise language
- Include practical examples
- Update the README for new features
- Add inline comments for complex logic

## Release Process

(For maintainers)

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release tag
4. Publish to npm
5. Create GitHub release

## Getting Help

- **Issues**: Open an issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact maintainers for sensitive issues

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes
- GitHub contributors page

Thank you for contributing to dir-analysis-tool! 🎉
