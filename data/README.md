# Data Directory

This directory contains the GrammarDB source files and generated database.

## Files

- `grammardb.xml` - Source XML file (included in repo)
- `grammardb.sqlite` - Generated SQLite database (~650MB, not in repo)
- `grammardb/*.xml` - Generated XML files by part of speech (not in repo)

## Building the Database

Run this command after cloning the repository:

```bash
bun run build:db
```

This will:
1. Parse the source `grammardb.xml` file
2. Split it into separate XML files by part of speech
3. Create a SQLite database with 240,000+ Belarusian words
4. Enable fast accent marking for the generated sentences

The build process takes about 1-2 minutes depending on your system.