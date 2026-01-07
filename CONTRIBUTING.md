# Contributing to EnvMem

First off, thanks for taking the time to contribute! 🎉

EnvMem is an open-source project, and we love to receive contributions from our community — you! There are many ways to contribute, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests, or writing code which can be incorporated into EnvMem itself.

## Code of Conduct

This project and everyone participating in it is governed by the [EnvMem Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

- **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/samihalawa/envmem-mcp/issues).
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/samihalawa/envmem-mcp/issues/new). Be sure to include a **title and clear description**, as much relevant information as possible, and a code sample or an executable test case demonstrating the expected behavior that is not occurring.

### Suggesting Enhancements

- Open a new issue in the repository and clearly describe the enhancement.
- Explain why this enhancement would be useful to other users.

### Pull Requests

1.  **Fork** the repo on GitHub.
2.  **Clone** the project to your own machine.
3.  **Create a branch** for your feature or fix.
4.  **Commit** changes to your own branch.
5.  **Push** your work back up to your fork.
6.  Submit a **Pull Request** so that we can review your changes.

NOTE: Be sure to merge the latest from "upstream" before making a pull request!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/samihalawa/envmem-mcp.git
cd envmem-mcp

# Install dependencies
npm install

# Run locally (requires Cloudflare Wrangler)
npm run dev
```

## Testing

Please ensure that your changes pass all tests and linting checks.

```bash
# Run type checking
npm run type-check
```

## License

By contributing, you agree that your contributions will be licensed under its ISC License.