# siri: Salesforce Bulk V2 API CLI Plugin

> **Named after my daughter, Siri** 🎉

[![NPM](https://img.shields.io/npm/v/siri.svg?label=siri)](https://www.npmjs.com/package/siri) [![Downloads/week](https://img.shields.io/npm/dw/siri.svg)](https://npmjs.org/package/siri) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/VenkatKoppolu/siri-cli/main/LICENSE.txt)

A production-grade Salesforce CLI plugin for efficient bulk data operations using the Salesforce Bulk API v2. Perform high-performance insert, update, upsert, delete, and query operations on large datasets with built-in progress tracking and comprehensive error handling.

## Features

### Bulk Data Operations
- **Bulk Insert** - Load thousands of records efficiently with automatic chunking for large CSV files
- **Bulk Update** - Update existing records at scale
- **Bulk Upsert** - Insert or update records using external ID lookups
- **Bulk Delete** - Remove records or hard delete (with appropriate permissions)
- **Bulk Query** - Execute SOQL queries with result streaming to CSV
- **Job Status Monitoring** - Track real-time progress of bulk operations
- **Result Retrieval** - Download success, failed, or unprocessed records
- **Smart File Handling** - Automatic splitting of large CSV files (>100MB) so no upload exceeds the Bulk API limit

### File Export
- **Multi-Source Export** - Export files from Attachments, ContentDocuments, Documents, or custom objects
- **Flexible Filtering** - Use SOQL queries to select which files to export
- **Concurrency Control** - Tune parallel downloads and cap the size of individual files
- **Cross-Platform** - Works on Windows, macOS, and Linux
- **Automatic Directory Creation** - Output directory created if it doesn't exist
- **Base64 Handling** - Automatically decodes base64-encoded file content
- **Filename Sanitization** - Removes invalid characters and prevents directory traversal

### Enterprise Quality
- **Enterprise Error Handling** - Detailed error messages with proper resource cleanup
- **Comprehensive Testing** - 80+ test cases with full production code coverage

## Installation

```bash
# Install as a Salesforce CLI plugin
sf plugins install siri@latest

# Or install a specific version
sf plugins install siri@1.0.0
```

## Quick Start

### Insert Records

```bash
sf siri data bulkv2 insert --sobjecttype Account --csvfile accounts.csv --target-org myorg@example.com
```

### Query Records

```bash
sf siri data bulkv2 query \
  --sobjecttype Account \
  --query "SELECT Id, Name FROM Account WHERE Active__c = true" \
  --outputfile results.csv \
  --target-org myorg@example.com
```

### Check Job Status

```bash
sf siri data bulkv2 status --jobid 750xx0000000044AAA --target-org myorg@example.com
```

### Retrieve Results

```bash
sf siri data bulkv2 results \
  --jobid 750xx0000000044AAA \
  --type success \
  --outputfile success_records.csv \
  --target-org myorg@example.com
```

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/VenkatKoppolu/siri-cli.git
cd siri-cli

# Install dependencies
yarn install

# Build the plugin
yarn build
```

### Development Workflow

```bash
# Run commands during development
./bin/dev data bulkv2 insert --sobjecttype Account --csvfile test.csv

# Link plugin for testing across the system
sf plugins link .

# Verify plugin is installed
sf plugins
```

### Testing

```bash
# Run all tests (80+ test cases)
yarn test

# Run tests in watch mode
yarn test -- --watch

# Run linting
yarn lint

# Run linting with auto-fix
yarn lint --fix

# Build for production
yarn prepack
```

### Project Structure

```
├── src/
│   ├── commands/siri/data/bulkv2/    # Command implementations (7 operations)
│   │   ├── insert.ts
│   │   ├── update.ts
│   │   ├── upsert.ts
│   │   ├── delete.ts
│   │   ├── query.ts
│   │   ├── status.ts
│   │   └── results.ts
│   ├── commands/siri/data/export/    # File export command
│   │   └── files.ts
│   ├── utilities/
│   │   ├── bulkv2.ts                 # Core Salesforce Bulk V2 API client
│   │   ├── fileexport.ts             # Attachment / ContentVersion / Document export
│   │   └── common.ts                 # Shared utilities
│   └── types/bulkv2.d.ts             # Type definitions
├── test/
│   ├── utilities/                    # Utility tests
│   └── commands/siri/data/           # Command tests (TestContext + MockTestOrgData)
├── messages/
│   ├── siri.data.bulkv2.md           # CLI message strings
│   └── siri.data.export.files.md
├── SECURITY.md                        # Vulnerability reporting and security model
└── README.md                          # This file
```

### Code Quality Standards

This plugin maintains enterprise-grade code quality:

- **Type Safety** - Full TypeScript strict mode with no `any` types in production code
- **Error Handling** - Comprehensive try-catch-finally patterns with guaranteed resource cleanup
- **Testing** - 80+ unit tests covering all operations and error scenarios
- **Linting** - ESLint with Salesforce plugin rules enforced on all code
- **Documentation** - See [ASSESSMENT_REPORT.md](ASSESSMENT_REPORT.md) for detailed improvements and [TEST_SUITE_DOCUMENTATION.md](TEST_SUITE_DOCUMENTATION.md) for test coverage

### Debugging

Set breakpoints in VS Code and use the included debug configuration:

```bash
# Using devhub connection
sf siri data bulkv2 insert --sobjecttype Account --csvfile test.csv --dev-suspend

# Or with local development
NODE_OPTIONS=--inspect-brk ./bin/dev data bulkv2 insert --sobjecttype Account --csvfile test.csv
```

Then attach the VS Code debugger using the "Attach to Remote" configuration.

## Commands

### `sf siri data export files`

Export files from Salesforce objects to your local machine using flexible SOQL queries.

```bash
sf siri data export files \
  --filetype attachment \
  --query "SELECT Id, Name, Body FROM Attachment WHERE ParentId = '001...'" \
  --output-dir ./exports/attachments \
  --target-org myorg@example.com
```

**Features:**
- Export Attachments, ContentDocuments (ContentVersion) or Documents
- Filter files using SOQL queries
- Creates output directory automatically
- Sanitizes filenames (path separators, `..`, control characters, Windows reserved names) so a
  malicious record name cannot write outside the output directory
- Validates write permissions before export
- Exits non-zero when any file fails so CI pipelines can detect partial exports

**Options:**
- `-o, --target-org=<string>` - Username or alias of the target org (defaults to the configured default org)
- `-t, --filetype=<string>` - (Required) File type: `attachment`, `contentdocument`, `document`
- `-q, --query=<string>` - (Required) SOQL query to select files
- `-d, --output-dir=<string>` - (Required) Local directory for exported files
- `-c, --concurrency=<integer>` - [default: 10] Parallel downloads per batch (1-50)
- `--max-file-size=<integer>` - [default: 104857600] Skip files larger than this many bytes
- `--json` - Output results as JSON

**Examples:**

Export all account attachments:
```bash
sf siri data export files \
  --filetype attachment \
  --query "SELECT Id, Name, Body FROM Attachment WHERE ParentId = '001xx000003DHP'" \
  --output-dir ./attachments
```

Export Salesforce Files (ContentDocuments):
```bash
sf siri data export files \
  --filetype contentdocument \
  --query "SELECT Id, ContentDocument.Title, VersionData FROM ContentVersion WHERE IsLatest = true" \
  --output-dir ./files
```

### `sf siri data bulkv2 insert`

Insert records using Bulk API v2.

```bash
sf siri data bulkv2 insert \
  --sobjecttype Account \
  --csvfile accounts.csv \
  --target-org myorg@example.com
```

**Options:**
- `-o, --target-org=<string>` - Username or alias of the target org (defaults to the configured default org)
- `-a, --api-version=<string>` - Override the API version used for the request
- `-s, --sobjecttype=<string>` - (Required) sObject type to insert into
- `-f, --csvfile=<string>` - (Required) Path to CSV file with data
- `-l, --lineending=<string>` - [default: LF] Line ending (LF or CRLF)
- `-d, --columndelimiter=<string>` - [default: COMMA] Delimiter (COMMA, PIPE, TAB, etc.)

All `bulkv2` commands accept `--target-org` and `--api-version`. Always pass `--target-org` explicitly when
scripting against production so a changed default org can never redirect a data load.

### `sf siri data bulkv2 update`

Update existing records using Bulk API v2.

```bash
sf siri data bulkv2 update --sobjecttype Account --csvfile updates.csv --target-org myorg@example.com
```

Same options as insert.

### `sf siri data bulkv2 upsert`

Insert or update records using an external ID field.

```bash
sf siri data bulkv2 upsert \
  --sobjecttype Account \
  --externalid External_ID__c \
  --csvfile accounts.csv \
  --target-org myorg@example.com
```

**Additional Option:**
- `-i, --externalid=<string>` - (Required) External ID field name

### `sf siri data bulkv2 delete`

Delete or hard delete records.

```bash
# Soft delete
sf siri data bulkv2 delete --sobjecttype Account --csvfile ids.csv --target-org myorg@example.com

# Hard delete
sf siri data bulkv2 delete --sobjecttype Account --csvfile ids.csv --hard --target-org myorg@example.com
```

**Additional Option:**
- `-x, --hard` - (Optional) Hard delete instead of soft delete

### `sf siri data bulkv2 query`

Execute SOQL queries and stream results to CSV.

```bash
sf siri data bulkv2 query \
  --sobjecttype Account \
  --query "SELECT Id, Name, Industry FROM Account" \
  --outputfile results.csv \
  --target-org myorg@example.com
```

**Options:**
- `-s, --sobjecttype=<string>` - (Required) sObject type for context
- `-q, --query=<string>` - (Required) SOQL query to execute
- `-f, --outputfile=<string>` - Output CSV file path; when omitted only the job is created and its ID is printed

### `sf siri data bulkv2 status`

Check the status of an in-progress or completed job.

```bash
sf siri data bulkv2 status --jobid 750xx0000000044AAA --target-org myorg@example.com
```

**Options:**
- `-i, --jobid=<string>` - (Required) Job ID to check (15 or 18 character Salesforce ID)
- `-t, --type=<string>` - [default: STATUS] `STATUS` for ingest jobs, `QUERY` for query jobs

### `sf siri data bulkv2 results`

Download results from a completed job.

```bash
sf siri data bulkv2 results \
  --jobid 750xx0000000044AAA \
  --type success \
  --outputfile results.csv \
  --target-org myorg@example.com
```

**Options:**
- `-i, --jobid=<string>` - (Required) Job ID (15 or 18 character Salesforce ID)
- `-t, --type=<string>` - [default: success] Result type (`success`, `failed`, `unprocessed`, `QUERY_RESULT`)
- `-f, --outputfile=<string>` - (Required) Output file path

## For More Help

Use the `--help` flag with any command for detailed documentation:

```bash
sf siri data bulkv2 insert --help
sf siri data bulkv2 query --help
```

## Contributing

We appreciate contributions! Please follow these steps:

1. Review our [Code of Conduct](CODE_OF_CONDUCT.md)
2. Create an issue to discuss your proposed changes
3. Fork the repository and create a feature branch
4. Ensure all tests pass and add new tests for your changes (minimum 95% coverage)
5. Submit a pull request with a clear description

### Development Requirements

- Node.js 18.0.0 or higher
- Yarn package manager
- Existing Salesforce CLI installation
- Valid Salesforce organization for testing

## Troubleshooting

### Large File Handling

Files larger than 100MB are automatically split into chunks so that no single upload exceeds the Bulk API 2.0 limit. Chunks are written to a private temporary directory (owner-only permissions) and removed when the command finishes, even on failure.

### Authentication Errors

Ensure you have authenticated with your target org:

```bash
sf org login web --alias myorg
```

### Permission Errors

Hard delete operations require the "Bulk API Hard Delete" permission in your Salesforce org.

## Security

- The plugin reuses the org authentication managed by the Salesforce CLI and never stores credentials itself.
- Access tokens are only sent to the selected org's instance URL over HTTPS and are stripped from error output.
- Job IDs are validated as Salesforce IDs before use, exported file names are sanitized, and temporary CSV
  chunks are created with owner-only permissions.
- `yarn.lock` is committed, CI installs with `--frozen-lockfile` and fails on high-severity audit findings,
  and Dependabot keeps dependencies current.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Resources

- [Salesforce Bulk API v2 Documentation](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/)
- [Salesforce CLI Documentation](https://developer.salesforce.com/docs/cli/)
- [Plugin Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_plugins.meta/sfdx_cli_plugins/cli_plugins_architecture_sf_cli.htm)

## License

This project is licensed under the BSD 3-Clause License. See [LICENSE](LICENSE.txt) for details.

## Support & Issues

Found a bug or have a feature request? Please [create an issue](https://github.com/VenkatKoppolu/siri-cli/issues) on GitHub.
